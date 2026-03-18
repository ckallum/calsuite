#!/usr/bin/env node

/**
 * babysit-pr-daemon — Detached background process that babysits a PR to completion.
 *
 * Lifecycle:
 *   1. Poll CI checks (ETag-based, zero rate-limit cost on 304)
 *   2. On failure → retry flaky CI once (gh run rerun --failed)
 *   3. On all pass → notify human to merge (merging is always manual)
 *   4. Poll for merge conflicts → notify user
 *   5. On merge → notify user, exit
 *   6. On persistent failure → notify user, exit
 *
 * Notifications: macOS native (osascript) + status file at /tmp/claude-babysit-<pr>.json
 *
 * Usage: node babysit-pr-daemon.js <owner/repo> <prNumber>
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ownerRepo = process.argv[2];
const prNumber = process.argv[3];

if (!ownerRepo || !/^\d+$/.test(prNumber ?? '')) process.exit(1);

const POLL_INTERVAL_MS = 30_000;       // 30 seconds
const MAX_DURATION_MS = 60 * 60_000;   // 60 minutes
const MAX_RETRIES = 1;                 // retry flaky CI once
const STATUS_FILE = path.join(os.tmpdir(), `claude-babysit-${prNumber}.json`);
const LOG_FILE = path.join(os.tmpdir(), `claude-babysit-${prNumber}.log`);

let retriesUsed = 0;
let notifiedReady = false;
let notifiedConflict = false;
let notifiedFailure = false;

// --- Helpers ---

function gh(args) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
  });
  return { ok: result.status === 0, stdout: result.stdout?.trim(), stderr: result.stderr?.trim() };
}

function ghApi(endpoint, jq) {
  const args = ['api', endpoint];
  if (jq) args.push('--jq', jq);
  return gh(args);
}

function getGhToken() {
  const result = gh(['auth', 'token']);
  return result.ok ? result.stdout : null;
}

function notify(title, message) {
  // macOS native notification
  try {
    spawnSync('osascript', ['-e',
      `display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`
    ], { stdio: 'ignore' });
  } catch { /* best-effort */ }

  // Also append to log file
  const ts = new Date().toISOString();
  fs.appendFileSync(LOG_FILE, `[${ts}] ${title}: ${message}\n`);
}

function writeStatus(state, detail) {
  const status = {
    pr: parseInt(prNumber),
    repo: ownerRepo,
    url: `https://github.com/${ownerRepo}/pull/${prNumber}`,
    pid: process.pid,
    state,    // watching | checks-passed | checks-failed | retrying | ready | merged | conflict | error
    detail,
    retriesUsed,
    notifiedReady,
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
  return status;
}

function fetchCheckRuns(sha, token, etag) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'claude-babysit-pr',
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (etag) headers['If-None-Match'] = etag;

    const req = https.request({
      hostname: 'api.github.com',
      path: `/repos/${ownerRepo}/commits/${sha}/check-runs`,
      method: 'GET',
      headers
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          etag: res.headers['etag'] || null,
          body: res.statusCode === 200 ? JSON.parse(body) : null
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function getHeadSha() {
  const result = ghApi(`repos/${ownerRepo}/pulls/${prNumber}`, '.head.sha');
  return result.ok ? result.stdout : null;
}

function getPrState() {
  const result = ghApi(`repos/${ownerRepo}/pulls/${prNumber}`,
    '{state: .state, mergeable: .mergeable, mergeStateStatus: .merge_commit_sha, merged: .merged, mergeableState: .mergeable_state}');
  if (!result.ok) return null;
  try { return JSON.parse(result.stdout); } catch { return null; }
}

function retryFailedRuns(headSha) {
  // Find workflow runs for the current head SHA that failed
  const result = gh([
    'run', 'list', '--commit', headSha,
    '--status', 'failure', '--json', 'databaseId', '--limit', '5',
    '-R', ownerRepo
  ]);
  if (!result.ok) return false;

  try {
    const runs = JSON.parse(result.stdout);
    let retried = false;
    for (const run of runs) {
      const rerun = gh(['run', 'rerun', String(run.databaseId), '--failed', '-R', ownerRepo]);
      if (rerun.ok) retried = true;
    }
    return retried;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// --- Main loop ---

async function run() {
  const token = getGhToken();
  if (!token) {
    writeStatus('error', 'Could not get GitHub token');
    process.exit(1);
  }

  writeStatus('watching', 'Monitoring CI checks...');
  notify(`PR #${prNumber}`, 'Babysitter started — monitoring CI checks');

  let etag = null;
  let lastSha = null;
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_DURATION_MS) {
    try {
      // Check if PR is already merged or closed
      const prState = getPrState();
      if (prState?.merged || prState?.state === 'closed') {
        const msg = prState.merged ? 'PR merged successfully!' : 'PR was closed.';
        writeStatus(prState.merged ? 'merged' : 'closed', msg);
        notify(`PR #${prNumber}`, msg);
        process.exit(0);
      }

      // Check for merge conflicts
      if (prState?.mergeableState === 'dirty') {
        writeStatus('conflict', 'PR has merge conflicts — needs manual resolution');
        if (!notifiedConflict) {
          notifiedConflict = true;
          notify(`PR #${prNumber}`, 'Merge conflicts detected — manual resolution needed');
        }
        await sleep(POLL_INTERVAL_MS);
        continue;
      } else if (notifiedConflict) {
        notifiedConflict = false; // reset if conflicts resolved
      }

      // Get head SHA (may change if user pushes new commits)
      const sha = getHeadSha();
      if (!sha) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      // Reset ETag if SHA changed (new commits pushed)
      if (sha !== lastSha) {
        etag = null;
        lastSha = sha;
        retriesUsed = 0; // reset retries for new commits
        notifiedReady = false;
        notifiedFailure = false;
      }

      // Poll check runs with ETag
      const response = await fetchCheckRuns(sha, token, etag);

      if (response.status === 304) {
        // Not modified — zero cost, continue
      } else if (response.status !== 200) {
        // API error — log it but keep polling (may be transient)
        writeStatus('watching', `GitHub API returned ${response.status} — will retry`);
        notify(`PR #${prNumber}`, `GitHub API error (${response.status}) — check gh auth status`);
      } else if (response.body) {
        etag = response.etag;
        const checks = response.body.check_runs || [];

        if (checks.length === 0) {
          // No checks yet, keep waiting
          writeStatus('watching', 'Waiting for CI checks to appear...');
        } else if (checks.every(c => c.status === 'completed')) {
          const failed = checks.filter(c => c.conclusion !== 'success' && c.conclusion !== 'skipped');

          if (failed.length === 0) {
            // All passed — notify human to merge
            writeStatus('ready', `All ${checks.length} checks passed — ready for human merge`);

            if (!notifiedReady) {
              notifiedReady = true;
              notify(`PR #${prNumber}`, `All ${checks.length} checks passed — ready to merge: https://github.com/${ownerRepo}/pull/${prNumber}`);
            }

            // Keep polling to detect the actual merge
          } else {
            // Some checks failed
            const failNames = failed.map(c => c.name).join(', ');

            if (retriesUsed < MAX_RETRIES) {
              retriesUsed++; // always count the attempt
              writeStatus('retrying', `Retrying failed checks: ${failNames}`);
              notify(`PR #${prNumber}`, `CI failed (${failNames}) — retrying...`);
              const retried = retryFailedRuns(sha);
              if (retried) {
                etag = null; // force re-poll after retry
              } else {
                writeStatus('checks-failed', `Retry failed for: ${failNames}`);
                notify(`PR #${prNumber}`, `CI failed and retry failed: ${failNames}`);
                notifiedFailure = true;
              }
            } else if (!notifiedFailure) {
              notifiedFailure = true;
              writeStatus('checks-failed', `CI failed after ${retriesUsed} retry(s): ${failNames}`);
              notify(`PR #${prNumber}`, `CI failed after retry: ${failNames} — needs attention`);
              // Don't exit — keep watching in case user pushes a fix
            }
          }
        } else {
          // Checks still running
          const completed = checks.filter(c => c.status === 'completed').length;
          writeStatus('watching', `CI running: ${completed}/${checks.length} complete`);
        }
      }
    } catch {
      // Network error — continue
    }

    await sleep(POLL_INTERVAL_MS);
  }

  // Timeout
  writeStatus('timeout', `Babysitter timed out after ${MAX_DURATION_MS / 60000} minutes`);
  notify(`PR #${prNumber}`, 'Babysitter timed out');
  process.exit(0);
}

run().catch((err) => {
  writeStatus('error', err.message);
  process.exit(1);
});
