#!/usr/bin/env node

/**
 * CI Monitor Poller — Detached background process spawned by ci-monitor.js.
 * Polls GitHub check-runs using ETag-based conditional requests (304 = zero cost).
 * Writes results to /tmp/claude-ci-<prNumber>.json when checks complete.
 *
 * Usage: node ci-monitor-poller.js <owner/repo> <prNumber>
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ownerRepo = process.argv[2];
const prNumber = process.argv[3];

if (!ownerRepo || !prNumber) process.exit(1);

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const MAX_POLL_MS = 30 * 60_000; // 30 minutes
const RESULT_FILE = path.join(os.tmpdir(), `claude-ci-${prNumber}.json`);

function getHeadSha() {
  const result = spawnSync('gh', [
    'api', `repos/${ownerRepo}/pulls/${prNumber}`, '--jq', '.head.sha'
  ], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  return result.status === 0 ? result.stdout.trim() : null;
}

function getGhToken() {
  const result = spawnSync('gh', ['auth', 'token'], {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function fetchCheckRuns(sha, token, etag) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'claude-ci-monitor',
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

function writeResult(sha, status, checks) {
  const result = {
    pr: parseInt(prNumber),
    url: `https://github.com/${ownerRepo}/pull/${prNumber}`,
    sha,
    status,
    checks: checks.map(c => ({
      name: c.name,
      status: c.status,
      conclusion: c.conclusion
    })),
    completedAt: new Date().toISOString()
  };
  fs.writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2));
}

async function poll() {
  const sha = getHeadSha();
  if (!sha) process.exit(1);

  const token = getGhToken();
  if (!token) process.exit(1);

  let etag = null;
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_POLL_MS) {
    try {
      const response = await fetchCheckRuns(sha, token, etag);

      if (response.status === 304) {
        // Not modified — zero API cost, continue polling
      } else if (response.status === 200 && response.body) {
        etag = response.etag;
        const checks = response.body.check_runs || [];

        if (checks.length > 0 && checks.every(c => c.status === 'completed')) {
          const allPassed = checks.every(c => c.conclusion === 'success' || c.conclusion === 'skipped');
          const status = allPassed ? 'pass' : 'fail';
          writeResult(sha, status, checks);

          // Log to a file Claude's hooks can pick up
          const summary = allPassed
            ? `All ${checks.length} checks passed`
            : `${checks.filter(c => c.conclusion !== 'success' && c.conclusion !== 'skipped').length} check(s) failed`;
          const logFile = path.join(os.tmpdir(), `claude-ci-${prNumber}.log`);
          fs.writeFileSync(logFile, `[CI Monitor] PR #${prNumber}: ${summary}\n`);
          process.exit(0);
        }
      }
    } catch {
      // Network error — continue polling
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  // Timeout — write pending result
  writeResult(sha, 'timeout', []);
  process.exit(0);
}

poll().catch(() => process.exit(1));
