#!/usr/bin/env node

/**
 * CI Monitor — PostToolUse hook that spawns a background poller after
 * `gh pr create` to watch CI check status using ETag-based conditional requests.
 * Writes results to a temp file when checks complete.
 * Fail-open: errors are silently ignored.
 */

const path = require('path');
const { spawn } = require('child_process');
const { readStdinJson, log } = require('../lib/utils');

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

  log(`[CI Monitor] Spawning background poller for PR #${prNumber}...`);

  // Spawn detached poller
  const pollerScript = path.join(__dirname, 'ci-monitor-poller.js');
  const child = spawn('node', [pollerScript, ownerRepo, prNumber], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env }
  });
  child.unref();
}

main().catch(() => {});
