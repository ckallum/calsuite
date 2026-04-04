#!/usr/bin/env node
/**
 * Flow Trace — PreToolUse hook
 *
 * Captures Skill and Agent tool invocations as JSONL trace entries.
 * Used by /flow to generate Mermaid diagrams of the development workflow.
 *
 * Writes to: .claude/flow-trace-{CLAUDE_SESSION_ID}.jsonl (project-local)
 * Each entry: {"ts":"ISO","type":"skill|agent","name":"...","description":"..."}
 *
 * Fail-open: any error exits 0 so it never blocks the user.
 * Target: < 50ms added latency.
 */

const fs = require('fs');
const path = require('path');
const { readStdinJson } = require(path.join(__dirname, '..', 'lib', 'utils.js'));

async function main() {
  const input = await readStdinJson();
  if (!input || !input.tool_name) {
    process.exit(0);
  }

  const tool = input.tool_name || input.tool;
  const toolInput = input.tool_input || {};

  let entry;

  if (tool === 'Skill') {
    entry = {
      ts: new Date().toISOString(),
      type: 'skill',
      name: toolInput.skill || 'unknown',
      args: toolInput.args || null
    };
  } else if (tool === 'Agent') {
    const rawName = toolInput.subagent_type || toolInput.description || 'unknown';
    entry = {
      ts: new Date().toISOString(),
      type: 'agent',
      name: rawName.split('\n')[0].slice(0, 50),
      description: toolInput.description || null
    };
  } else {
    process.exit(0);
  }

  // Sanitize session ID to prevent path traversal
  const sessionId = (process.env.CLAUDE_SESSION_ID || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const traceFile = path.join(
    projectDir,
    '.claude',
    `flow-trace-${sessionId}.jsonl`
  );

  // Append entry — seq is omitted; /flow derives ordering from timestamps
  fs.mkdirSync(path.dirname(traceFile), { recursive: true });
  fs.appendFileSync(traceFile, JSON.stringify(entry) + '\n');

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write('[flow-trace] ' + err.message + '\n');
  process.exit(0);
});
