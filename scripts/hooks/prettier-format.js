#!/usr/bin/env node

/**
 * PostToolUse hook: Auto-format JS/TS files with Prettier after edits.
 * Fires on Edit tool calls targeting .ts/.tsx/.js/.jsx files.
 *
 * stdin: JSON with tool_input.file_path
 * stdout: pass-through (PostToolUse pattern)
 */

const { execFileSync } = require('child_process');
const fs = require('fs');

let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const filePath = input.tool_input?.file_path;

    if (filePath && fs.existsSync(filePath)) {
      try {
        execFileSync('npx', ['prettier', '--write', filePath], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (e) {
        // Prettier not available or failed — not blocking
      }
    }
  } catch (e) {
    // fail-open
  }

  console.log(data);
});
