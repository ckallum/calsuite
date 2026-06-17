#!/usr/bin/env node
'use strict';
/**
 * install-afk-routines.cjs — symlink calsuite-owned AFK orchestration artifacts
 * into the global ~/.claude/ tree so Desktop scheduled tasks (and any repo's
 * session) can resolve them by name.
 *
 * Idempotent symlinks:
 *   <calsuite>/workflows/afk-NAME.js              -> ~/.claude/workflows/afk-NAME.js
 *   <calsuite>/skills/afk-NAME                    -> ~/.claude/skills/afk-NAME
 *   <calsuite>/scheduled-tasks/afk-NAME/SKILL.md  -> ~/.claude/scheduled-tasks/afk-NAME/SKILL.md
 *
 * The Desktop task's schedule / folder / enabled binding is NOT a file. Set it
 * once per machine via the scheduled-tasks MCP (create_scheduled_task) or the
 * Routines UI. This script manages only the prompt / skill / workflow files.
 *
 * Calsuite root resolves canonically ($CALSUITE_DIR -> git-common-dir ->
 * __dirname/..) so the global symlinks point at the real checkout, never an
 * ephemeral worktree (see the fresh-clone test in CLAUDE.md). Node built-ins only.
 *
 * Usage: node scripts/install-afk-routines.cjs [--dry-run]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('node:child_process');

// Mirror resolveCalsuiteDir() in configure-claude.js. A bare path.resolve(__dirname,
// '..') would pin the symlinks to a worktree when this is run from one — and these
// symlinks must outlive any worktree, so resolve the canonical checkout instead.
function resolveCalsuiteDir() {
  if (process.env.CALSUITE_DIR) return path.resolve(process.env.CALSUITE_DIR);
  const here = path.resolve(__dirname, '..');
  try {
    const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: here,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const canonical = path.dirname(path.resolve(here, commonDir));
    if (fs.existsSync(canonical)) return canonical;
  } catch {
    // git not on PATH, or not a git tree (tarball) — fall through to __dirname/..
  }
  return here;
}

const CALSUITE = resolveCalsuiteDir();
const CLAUDE = path.join(os.homedir(), '.claude');
const DRY = process.argv.includes('--dry-run');

let linked = 0;
let already = 0;
let conflicts = 0;
let failed = 0;

function link(src, dest, label) {
  // A source that listAfk() enumerated but that is now missing is an anomaly,
  // not normal control flow — surface it rather than skipping silently and
  // still reporting success.
  if (!fs.existsSync(src)) {
    failed++;
    console.log(`  ? ${label}: source missing at ${src} — skipping`);
    return;
  }
  if (!DRY) fs.mkdirSync(path.dirname(dest), { recursive: true });

  let cur = null;
  try {
    cur = fs.lstatSync(dest);
  } catch (e) {
    // ENOENT genuinely means "dest absent" (the common case). Any other error
    // (EACCES, ENOTDIR on a parent) must be surfaced — treating it as "absent"
    // would fall through to symlinkSync and crash the whole run uncaught.
    if (e.code !== 'ENOENT') {
      failed++;
      console.log(`  ! ${label}: cannot stat ${dest} (${e.code}) — skipping`);
      return;
    }
  }

  let stale = false;
  if (cur) {
    if (cur.isSymbolicLink()) {
      const target = path.resolve(path.dirname(dest), fs.readlinkSync(dest));
      if (target === path.resolve(src)) {
        already++;
        console.log(`  = ${label}: already linked`);
        return;
      }
      stale = true;
      console.log(`  ~ ${label}: replacing stale symlink (was -> ${target})`);
    } else {
      conflicts++;
      console.log(`  ! ${label}: a real file/dir exists at ${dest} — leaving it; resolve manually`);
      return;
    }
  }

  if (DRY) {
    console.log(`  + ${label}: would link ${dest} -> ${src}`);
    linked++;
    return;
  }

  // Guard the mutating calls so one item's EACCES/EPERM/EEXIST (Windows often
  // needs privilege to symlink) is logged and counted, not thrown uncaught —
  // otherwise it would abort every later artifact in this and later sections.
  try {
    if (stale) fs.unlinkSync(dest);
    fs.symlinkSync(src, dest);
  } catch (e) {
    failed++;
    console.log(`  ! ${label}: link failed (${e.code || e.message}) — skipping`);
    return;
  }
  console.log(`  + ${label}: ${dest} -> ${src}`);
  linked++;
}

function listAfk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.startsWith('afk-'));
}

console.log(`install-afk-routines: calsuite=${CALSUITE}${DRY ? ' (dry-run)' : ''}`);

console.log('workflows:');
for (const f of listAfk(path.join(CALSUITE, 'workflows')).filter((n) => n.endsWith('.js'))) {
  link(path.join(CALSUITE, 'workflows', f), path.join(CLAUDE, 'workflows', f), f);
}

console.log('skills:');
for (const d of listAfk(path.join(CALSUITE, 'skills'))) {
  link(path.join(CALSUITE, 'skills', d), path.join(CLAUDE, 'skills', d), d);
}

console.log('scheduled-tasks:');
for (const d of listAfk(path.join(CALSUITE, 'scheduled-tasks'))) {
  // Link only SKILL.md, not the whole dir: the Desktop app owns
  // ~/.claude/scheduled-tasks/<name>/ (schedule/folder/enabled metadata lives
  // there) — calsuite owns only the prompt. link() surfaces a missing SKILL.md
  // as a failure (a task dir without one is malformed), so don't pre-skip silently.
  link(path.join(CALSUITE, 'scheduled-tasks', d, 'SKILL.md'), path.join(CLAUDE, 'scheduled-tasks', d, 'SKILL.md'), `${d}/SKILL.md`);
}

console.log(`\ndone: ${linked} linked, ${already} already-linked, ${conflicts} conflict(s), ${failed} failed.`);
if (conflicts || failed) process.exitCode = 1;
