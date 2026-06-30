'use strict';

const fs = require('fs');
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

/**
 * Resolve the absolute path to the canonical calsuite checkout on this machine.
 * Order: $CALSUITE_DIR env var → git-common-dir auto-detect (from baseDir) → baseDir.
 *
 * Pass the calling script's calsuite root as `baseDir` — `path.resolve(__dirname, '..')`
 * from any script under scripts/. The git step is the load-bearing one: from any
 * worktree, `git rev-parse --git-common-dir` returns the canonical .git directory
 * (a worktree holds a .git FILE pointing back to it), and its parent is the canonical
 * checkout root — so the result outlives any ephemeral worktree, with no hardcoded
 * `~/Projects/calsuite` assumption. The final fallback (baseDir) covers a non-git tree
 * (tarball) or git missing from PATH. The return value is always absolute.
 *
 * Single source of truth: configure-claude.js and install-afk-routines.cjs both bind
 * this to their own checkout root. The resolution ORDER is a load-bearing
 * fresh-clone-test invariant (see CLAUDE.md) — keep it here, never hand-duplicated.
 */
function resolveCalsuiteDir(baseDir) {
  if (process.env.CALSUITE_DIR) return path.resolve(process.env.CALSUITE_DIR);
  try {
    const { execFileSync } = require('node:child_process');
    const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: baseDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const canonical = path.dirname(path.resolve(baseDir, commonDir));
    if (fs.existsSync(canonical)) return canonical;
  } catch {
    // git not on PATH, or baseDir isn't a git tree (tarball) — fall through
  }
  return baseDir;
}

module.exports = { destToCalsuiteRel, deriveTargetName, resolveCalsuiteDir };

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

  // resolveCalsuiteDir: $CALSUITE_DIR env override wins over git/baseDir
  const prevEnv = process.env.CALSUITE_DIR;
  process.env.CALSUITE_DIR = j('', 'tmp', 'cal-override');
  assert.strictEqual(
    resolveCalsuiteDir(j('', 'anything')),
    path.resolve(j('', 'tmp', 'cal-override')),
    'CALSUITE_DIR env override wins'
  );
  if (prevEnv === undefined) delete process.env.CALSUITE_DIR;
  else process.env.CALSUITE_DIR = prevEnv;

  console.log('path-helpers.cjs: all tests passed');
}
