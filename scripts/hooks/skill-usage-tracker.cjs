#!/usr/bin/env node
/**
 * Skill Usage Tracker — PreToolUse hook
 *
 * Logs when a Skill tool is invoked. Appends to
 * ~/.claude/analytics/skill-usage.jsonl with timestamp, skill name, session ID.
 *
 * Fail-open: any error exits 0 so it never blocks the user.
 */

const fs = require('fs');
const path = require('path');
const { readStdinJson } = require(path.join(__dirname, '..', 'lib', 'utils.cjs'));

async function main() {
  const data = await readStdinJson();

  const skillName = data.tool_input?.skill || 'unknown';
  const sessionId = process.env.CLAUDE_SESSION_ID || 'unknown';

  const entry = {
    ts: new Date().toISOString(),
    skill: skillName,
    session: sessionId,
    args: data.tool_input?.args || null
  };

  const analyticsDir = path.join(
    process.env.HOME || process.env.USERPROFILE || '/tmp',
    '.claude', 'analytics'
  );

  fs.mkdirSync(analyticsDir, { recursive: true });
  fs.appendFileSync(
    path.join(analyticsDir, 'skill-usage.jsonl'),
    JSON.stringify(entry) + '\n'
  );

  process.exit(0);
}

main().catch(() => process.exit(0));
