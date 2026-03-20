#!/usr/bin/env node

/**
 * PostToolUse hook: Log PR URL and review command after `gh pr create`.
 * Fires on all Bash tool calls, checks if the command was `gh pr create`,
 * and if so extracts the PR URL from the output.
 *
 * stdin: JSON with tool_input.command and tool_output.output
 * stdout: pass-through (PostToolUse pattern)
 * stderr: informational messages for the user
 */

let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const cmd = input.tool_input?.command || '';

    if (/gh pr create/.test(cmd)) {
      const output = input.tool_output?.output || '';
      const match = output.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/);

      if (match) {
        const url = match[0];
        const repo = url.replace(/https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+/, '$1');
        const pr = url.replace(/.*\/pull\/(\d+)/, '$1');

        console.error(`[Hook] PR created: ${url}`);
        console.error(`[Hook] To review: gh pr review ${pr} --repo ${repo}`);
      }
    }
  } catch (e) {
    // fail-open
  }

  // PostToolUse: pass-through stdin to stdout
  console.log(data);
});
