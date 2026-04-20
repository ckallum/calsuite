'use strict';

const path = require('path');

const CLAUDE_MARKER = path.sep + '.claude' + path.sep;

/**
 * Given a destination file inside a target's .claude/skills or .claude/agents,
 * return the calsuite-relative path to the same file (skills/<name>/...
 * or agents/<name>.md). Returns null if the path isn't under a recognized
 * managed dir.
 *
 * Uses lastIndexOf so nested `.claude/` directories (e.g. calsuite's own
 * worktrees at `calsuite/.claude/worktrees/<id>/.claude/skills/...`) resolve
 * against the innermost `.claude/` rather than the outer one.
 */
function destToCalsuiteRel(destPath) {
  const idx = destPath.lastIndexOf(CLAUDE_MARKER);
  if (idx === -1) return null;
  const afterClaude = destPath.slice(idx + CLAUDE_MARKER.length);
  const first = afterClaude.split(path.sep)[0];
  if (first === 'skills' || first === 'agents') {
    return afterClaude.split(path.sep).join('/');
  }
  return null;
}

function deriveTargetName(destPath) {
  const idx = destPath.lastIndexOf(CLAUDE_MARKER);
  if (idx === -1) return 'local';
  const targetDir = destPath.slice(0, idx);
  return path.basename(targetDir);
}

module.exports = { destToCalsuiteRel, deriveTargetName };

if (require.main === module) {
  const assert = require('assert');
  const sep = path.sep;
  const j = (...parts) => parts.join(sep);

  // destToCalsuiteRel: flat target path
  assert.strictEqual(
    destToCalsuiteRel(j('', 'Users', 'x', 'proj', '.claude', 'skills', 'plan', 'SKILL.md')),
    'skills/plan/SKILL.md',
    'flat skills path'
  );
  assert.strictEqual(
    destToCalsuiteRel(j('', 'Users', 'x', 'proj', '.claude', 'agents', 'reviewer.md')),
    'agents/reviewer.md',
    'flat agents path'
  );

  // destToCalsuiteRel: nested .claude (calsuite worktree scenario)
  const nested = j('', 'Users', 'x', 'Projects', 'calsuite', '.claude', 'worktrees', 'charming-buck-afc54a', '.claude', 'skills', 'plan', 'SKILL.md');
  assert.strictEqual(
    destToCalsuiteRel(nested),
    'skills/plan/SKILL.md',
    'nested .claude resolves against innermost'
  );
  const nestedAgent = j('', 'Users', 'x', 'Projects', 'calsuite', '.claude', 'worktrees', 'foo', '.claude', 'agents', 'r.md');
  assert.strictEqual(
    destToCalsuiteRel(nestedAgent),
    'agents/r.md',
    'nested .claude agents path'
  );

  // destToCalsuiteRel: rejects unknown first segment
  assert.strictEqual(
    destToCalsuiteRel(j('', 'x', '.claude', 'settings.json')),
    null,
    'non-managed dir returns null'
  );
  assert.strictEqual(
    destToCalsuiteRel(j('', 'x', 'no-claude-here', 'skills', 'plan.md')),
    null,
    'missing .claude returns null'
  );

  // deriveTargetName: flat
  assert.strictEqual(
    deriveTargetName(j('', 'Users', 'x', 'my-repo', '.claude', 'skills', 'plan', 'SKILL.md')),
    'my-repo',
    'flat target name'
  );

  // deriveTargetName: nested — innermost .claude wins, so target is the worktree dir
  assert.strictEqual(
    deriveTargetName(nested),
    'charming-buck-afc54a',
    'nested target name is innermost parent'
  );

  // deriveTargetName: no .claude
  assert.strictEqual(
    deriveTargetName(j('', 'x', 'y', 'z.md')),
    'local',
    'no .claude returns local'
  );

  console.log('path-helpers.cjs: all tests passed');
}
