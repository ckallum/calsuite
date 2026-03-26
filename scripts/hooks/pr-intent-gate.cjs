#!/usr/bin/env node

/**
 * PR Intent Gate — PreToolUse hook that blocks `gh pr create` unless the
 * PR body contains a "## Why" section explaining business intent.
 * Fail-open: if anything goes wrong, exits 0 (allows).
 */

const path = require('path');
const { readStdinJson, log } = require(path.join(__dirname, '..', 'lib', 'utils.cjs'));

async function main() {
  const input = await readStdinJson();
  const command = input.tool_input?.command || '';

  // Only intercept gh pr create
  if (!/gh\s+pr\s+create/.test(command)) {
    process.exit(0);
  }

  // Check if --body contains a ## Why section
  // Handle: --body "...", --body '...', and heredoc --body "$(cat <<'EOF'...EOF)"
  const bodyMatch = command.match(/--body\s+(?:"([\s\S]*?)(?:(?<!\\)")|'([\s\S]*?)')/);
  const bodyContent = bodyMatch ? (bodyMatch[1] || bodyMatch[2] || '') : '';

  if (/##\s*why/i.test(bodyContent)) {
    process.exit(0);
  }

  // Block — tell Claude to ask for intent
  log('');
  log('[PR Intent Gate] Blocked — missing "## Why" section in PR body.');
  log('[PR Intent Gate] Before creating this PR, ask the user:');
  log('[PR Intent Gate]   "Why are we shipping this? What business problem does it solve?"');
  log('[PR Intent Gate] Then add a ## Why section to the PR body with their answer.');
  log('');
  process.exit(1);
}

main().catch(() => process.exit(0));
