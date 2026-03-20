#!/usr/bin/env node

/**
 * PostToolUse hook: Run TypeScript type-check after editing .ts/.tsx files.
 * Walks up from the edited file to find tsconfig.json, runs `tsc --noEmit`,
 * and reports errors scoped to the edited file.
 *
 * stdin: JSON with tool_input.file_path
 * stdout: pass-through (PostToolUse pattern)
 * stderr: TypeScript errors for the edited file
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const filePath = input.tool_input?.file_path;

    if (filePath && fs.existsSync(filePath)) {
      // Walk up to find tsconfig.json
      let dir = path.dirname(filePath);
      while (dir !== path.dirname(dir) && !fs.existsSync(path.join(dir, 'tsconfig.json'))) {
        dir = path.dirname(dir);
      }

      if (fs.existsSync(path.join(dir, 'tsconfig.json'))) {
        try {
          const result = execSync('npx tsc --noEmit --pretty false 2>&1', {
            cwd: dir,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          const lines = result.split('\n').filter(l => l.includes(filePath)).slice(0, 10);
          if (lines.length) console.error(lines.join('\n'));
        } catch (e) {
          const lines = (e.stdout || '').split('\n').filter(l => l.includes(filePath)).slice(0, 10);
          if (lines.length) console.error(lines.join('\n'));
        }
      }
    }
  } catch (e) {
    // fail-open
  }

  console.log(data);
});
