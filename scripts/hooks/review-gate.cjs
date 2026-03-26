#!/usr/bin/env node

/**
 * Review Gate — PreToolUse hook that blocks git commits without prior code review.
 * Checks .claude/.last-review for a matching SHA-256 hash of the staged diff.
 * Fail-open: if anything goes wrong, exits 0 (allows).
 */

const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { readStdinJson, runCommand, readFile, log } = require(path.join(__dirname, '..', 'lib', 'utils.cjs'));

const REVIEW_FILE = path.join(process.cwd(), '.claude', '.last-review');

async function main() {
  const input = await readStdinJson();

  // Only intercept git commit commands
  const command = input.tool_input?.command || '';
  if (!/git\s+commit(\s|$)/.test(command)) {
    process.exit(0);
  }

  // Extract commit message from -m "...", --message="...", or heredoc
  const msgMatch = command.match(/(?:-m\s+|--message(?:=|\s+))(?:"([^"]*(?:\\.[^"]*)*)"|'([^']*)'|(\S+))/);
  const heredocMatch = command.match(/<<\s*'?EOF'?\s*\n([\s\S]*?)\nEOF/);
  const commitMsg = msgMatch ? (msgMatch[1] || msgMatch[2] || msgMatch[3] || '') : (heredocMatch ? heredocMatch[1] : '');

  // Skip conditions based on commit message
  if (/\[skip-review\]/i.test(commitMsg)) {
    process.exit(0);
  }
  if (/^(docs|chore|style):/i.test(commitMsg.trim())) {
    process.exit(0);
  }

  // Get staged files
  const stagedResult = runCommand('git diff --cached --name-only');
  if (!stagedResult.success || !stagedResult.output.trim()) {
    process.exit(0); // No staged files
  }

  // Skip if all staged files are markdown
  const stagedFiles = stagedResult.output.trim().split('\n');
  if (stagedFiles.every(f => f.endsWith('.md'))) {
    process.exit(0);
  }

  // Hash the staged diff (use spawnSync directly to get raw output matching the agent's execSync)
  const diffProc = spawnSync('git', ['diff', '--cached'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  if (diffProc.status !== 0 || !diffProc.stdout) {
    process.exit(0); // Empty diff
  }
  const diffHash = crypto.createHash('sha256').update(diffProc.stdout).digest('hex');

  // Check .last-review for matching hash
  const reviewData = readFile(REVIEW_FILE);
  if (reviewData) {
    try {
      const review = JSON.parse(reviewData);
      if (review.diffHash === diffHash) {
        process.exit(0); // Review matches current diff
      }
    } catch (e) {
      log(`[Review Gate] Warning: corrupt .last-review file (${e.message}) — ignoring`);
    }
  }

  // Block the commit
  log('');
  log('[Review Gate] Commit blocked — code review required.');
  log('[Review Gate] Run: @code-reviewer to review staged changes.');
  log('[Review Gate] Or add [skip-review] to your commit message to bypass.');
  log('');
  process.exit(1);
}

main().catch(() => process.exit(0));
