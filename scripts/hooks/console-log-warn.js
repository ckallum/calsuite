#!/usr/bin/env node

/**
 * PostToolUse hook: Warn about console.log statements after editing JS/TS files.
 * Fires on Edit tool calls targeting .ts/.tsx/.js/.jsx files.
 *
 * stdin: JSON with tool_input.file_path
 * stdout: pass-through (PostToolUse pattern)
 * stderr: warnings about console.log statements
 */

const fs = require('fs');

let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const filePath = input.tool_input?.file_path;

    if (filePath && fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      const matches = [];

      lines.forEach((line, idx) => {
        if (/console\.log/.test(line)) {
          matches.push(`${idx + 1}: ${line.trim()}`);
        }
      });

      if (matches.length) {
        console.error(`[Hook] WARNING: console.log found in ${filePath}`);
        matches.slice(0, 5).forEach(m => console.error(m));
        console.error('[Hook] Remove console.log before committing');
      }
    }
  } catch (e) {
    // fail-open
  }

  console.log(data);
});
