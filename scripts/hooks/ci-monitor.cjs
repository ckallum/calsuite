#!/usr/bin/env node

/**
 * CI Monitor — PostToolUse hook that spawns babysit-pr-daemon after
 * `gh pr create` to watch CI, retry flaky checks, and notify when ready to merge.
 * Fail-open: errors are silently ignored.
 */

const path = require('path');
const { spawn } = require('child_process');
const { readStdinJson, log } = require(path.join(__dirname, '..', 'lib', 'utils.cjs'));

async function main() {
  const input = await readStdinJson();

  // Pass through stdin to stdout (required for PostToolUse)
  console.log(JSON.stringify(input));

  const command = input.tool_input?.command || '';
  const output = input.tool_output?.output || '';

  // Only trigger on gh pr create
  if (!/gh\s+pr\s+create/.test(command)) return;

  // Extract PR URL from output
  const prMatch = output.match(/https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (!prMatch) return;

  const ownerRepo = prMatch[1];
  const prNumber = prMatch[2];

  log(`[Babysit PR] Spawning background daemon for PR #${prNumber}...`);
  log(`[Babysit PR] Will monitor CI, retry failures, and notify when ready to merge.`);
  log(`[Babysit PR] Status: /tmp/claude-babysit-${prNumber}.json`);

  // Spawn detached daemon
  const daemonScript = path.join(__dirname, 'babysit-pr-daemon.cjs');
  const child = spawn('node', [daemonScript, ownerRepo, prNumber], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env }
  });
  child.unref();
}

main().catch(() => {});
