#!/usr/bin/env node

/**
 * PostToolUse hook: Run ESLint on edited JS/TS files and report violations.
 * Agent-directed: violations are reported to stderr so Claude sees them
 * and can self-correct before the next edit.
 *
 * Fires on Edit/Write tool calls targeting .ts/.tsx/.js/.jsx files.
 * Fail-open: if ESLint is not installed or fails, silently passes through.
 *
 * stdin: JSON with tool_input.file_path
 * stdout: pass-through (PostToolUse pattern)
 * stderr: ESLint violations for the edited file
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const filePath = input.tool_input?.file_path;

    if (filePath && fs.existsSync(filePath) && /\.(ts|tsx|js|jsx)$/.test(filePath)) {
      // Walk up to find eslint config
      let dir = path.dirname(filePath);
      let hasConfig = false;
      while (dir !== path.dirname(dir)) {
        if (
          fs.existsSync(path.join(dir, '.eslintrc.json')) ||
          fs.existsSync(path.join(dir, '.eslintrc.js')) ||
          fs.existsSync(path.join(dir, '.eslintrc.cjs')) ||
          fs.existsSync(path.join(dir, '.eslintrc.yaml')) ||
          fs.existsSync(path.join(dir, '.eslintrc.yml')) ||
          fs.existsSync(path.join(dir, 'eslint.config.js')) ||
          fs.existsSync(path.join(dir, 'eslint.config.mjs')) ||
          fs.existsSync(path.join(dir, 'eslint.config.cjs'))
        ) {
          hasConfig = true;
          break;
        }
        dir = path.dirname(dir);
      }

      if (hasConfig) {
        try {
          execFileSync('npx', ['eslint', '--no-error-on-unmatched-pattern', '--format', 'stylish', filePath], {
            cwd: dir,
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 15000,
          });
        } catch (e) {
          // ESLint returns exit code 1 when there are violations
          const output = (e.stdout || '').toString().trim();
          if (output) {
            const lines = output.split('\n').slice(0, 20);
            console.error('[ESLint] Violations found:');
            console.error(lines.join('\n'));
          }
        }
      }
    }
  } catch (e) {
    // fail-open
  }

  console.log(data);
});
