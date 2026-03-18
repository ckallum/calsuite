#!/usr/bin/env node

/**
 * Merged Branch Guard — PreToolUse hook that blocks git push, commit, rebase,
 * and merge on branches that already have a merged PR.
 * Uses a session-scoped file cache to avoid repeated gh API calls.
 * Fail-open: if anything goes wrong, exits 0 (allows).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { readStdinJson, log, getSessionIdShort } = require('../lib/utils');

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCachePath() {
  return path.join(os.tmpdir(), `claude-merged-cache-${getSessionIdShort()}.json`);
}

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(getCachePath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeCache(cache) {
  try {
    fs.writeFileSync(getCachePath(), JSON.stringify(cache), 'utf8');
  } catch {
    // Best-effort
  }
}

function getCurrentBranch() {
  const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function checkMergedPR(branch) {
  const result = spawnSync('gh', [
    'pr', 'list', '--state', 'merged', '--head', branch,
    '--json', 'number', '--limit', '1'
  ], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

  if (result.status !== 0) return null; // gh failed, fail-open

  try {
    const prs = JSON.parse(result.stdout);
    return prs.length > 0 ? prs[0].number : false;
  } catch {
    return null;
  }
}

async function main() {
  const input = await readStdinJson();
  const command = input.tool_input?.command || '';

  // Only intercept git push/commit/rebase/merge
  if (!/git\s+(push|commit|rebase|merge)(\s|$)/.test(command)) {
    process.exit(0);
  }

  const branch = getCurrentBranch();
  if (!branch || branch === 'main' || branch === 'master' || branch === 'HEAD') {
    process.exit(0);
  }

  // Check cache first
  const cache = readCache();
  const cached = cache[branch];
  if (cached && (Date.now() - cached.checkedAt) < CACHE_TTL_MS) {
    if (cached.merged) {
      log('');
      log(`[Merged Branch Guard] BLOCKED — branch "${branch}" has a merged PR (#${cached.prNumber}).`);
      log(`[Merged Branch Guard] Create a new branch instead: git checkout -b <new-branch>`);
      log('');
      process.exit(1);
    }
    process.exit(0);
  }

  // Query GitHub
  const prNumber = checkMergedPR(branch);
  if (prNumber === null) {
    // gh failed — fail-open
    process.exit(0);
  }

  // Update cache
  cache[branch] = { merged: !!prNumber, prNumber: prNumber || null, checkedAt: Date.now() };
  writeCache(cache);

  if (prNumber) {
    log('');
    log(`[Merged Branch Guard] BLOCKED — branch "${branch}" has a merged PR (#${prNumber}).`);
    log(`[Merged Branch Guard] Create a new branch instead: git checkout -b <new-branch>`);
    log('');
    process.exit(1);
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
