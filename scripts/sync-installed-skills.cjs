#!/usr/bin/env node
'use strict';
/**
 * Keeps calsuite's git-tracked installed copies in step with their sources:
 *   .claude/skills/<name>/**  <-  skills/<name>/**
 *   .claude/scripts/lib/*     <-  scripts/lib/*
 *
 * - Calsuite gitignores `.claude/`, so a fresh clone or worktree contains only the force-added
 *   copies, and `--sync` never refreshes calsuite itself (it is the source, not a target).
 *   Anything running in an isolated worktree — the AFK fix loop — sees these copies and nothing else.
 * - "Same" is `normalizeForCompare` equality, the installer's own definition, so `_origin`
 *   stamps and auto-added frontmatter never count as drift.
 *
 * Usage: node scripts/sync-installed-skills.cjs [--fix] [skill ...]
 *   (default)  report drift; exit 1 if any
 *   --fix      rewrite stale or missing copies from source
 *   skill ...  also mirror these skills (prints the `git add -f` needed to start tracking them)
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { normalizeForCompare, stampOrigin, readOrigin } = require('./lib/origin-protocol.cjs');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const FIX = args.includes('--fix');
const extraSkills = args.filter(a => !a.startsWith('--'));

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });
const tracked = rel => git('ls-files', '-z', '--', rel).split('\0').filter(Boolean);
const abs = rel => path.join(ROOT, rel);

const profiles = JSON.parse(fs.readFileSync(abs('config/profiles.json'), 'utf8')).profiles;
const distributed = new Set(Object.values(profiles).flatMap(p => p.skills || []));

// [installedRel, sourceRel, skillName|null]
const pairs = [];
const orphans = [];

const trackedInstalled = tracked('.claude/skills');
const skillNames = new Set([
  ...trackedInstalled.map(f => f.split('/')[2]),
  ...extraSkills,
]);
for (const name of [...skillNames].sort()) {
  const sources = tracked(`skills/${name}`);
  if (sources.length === 0) {
    console.error(`✗ .claude/skills/${name} has no source at skills/${name}`);
    process.exitCode = 1;
    continue;
  }
  const expected = new Set();
  for (const src of sources) {
    const inst = `.claude/${src}`;
    expected.add(inst);
    pairs.push([inst, src, name]);
  }
  for (const inst of trackedInstalled) {
    if (inst.startsWith(`.claude/skills/${name}/`) && !expected.has(inst)) orphans.push(inst);
  }
}
for (const inst of tracked('.claude/scripts/lib')) {
  const src = inst.slice('.claude/'.length);
  if (fs.existsSync(abs(src))) pairs.push([inst, src, null]);
  else orphans.push(inst);
}

function same(instRel, srcRel) {
  const a = fs.readFileSync(abs(instRel), 'utf8');
  const b = fs.readFileSync(abs(srcRel), 'utf8');
  return srcRel.endsWith('.md')
    ? normalizeForCompare(a) === normalizeForCompare(b)
    : a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');
}

/**
 * Markdown copies keep the installer's `_origin` convention: stamped when the existing copy is
 * stamped, or when it is new and the skill is distributed. The stamp names the last commit that
 * touched the source, so `configure-claude.js .` run against calsuite finds content-at-sha equal
 * to the copy and treats it as current instead of user-diverged.
 */
function render(instRel, srcRel, name) {
  const src = fs.readFileSync(abs(srcRel), 'utf8');
  if (!srcRel.endsWith('.md')) return src;
  const existing = fs.existsSync(abs(instRel)) ? fs.readFileSync(abs(instRel), 'utf8') : null;
  const stamp = existing !== null ? Boolean(readOrigin(existing)) : Boolean(name && distributed.has(name));
  if (!stamp) return src;
  const sha = git('log', '-1', '--format=%h', '--', srcRel).trim();
  return sha ? stampOrigin(src, `calsuite@${sha}`) : src;
}

const stale = pairs.filter(([inst, src]) => !fs.existsSync(abs(inst)) || !same(inst, src));
// A copy that matches on disk but isn't committed is absent from every fresh checkout, so it
// counts as drift here too — otherwise a local run passes where CI's clean checkout fails.
const isTracked = new Set(tracked('.claude'));
const untracked = pairs.map(([inst]) => inst).filter(inst => !isTracked.has(inst));

if (!FIX) {
  for (const [inst, src] of stale) {
    console.log(`  ${fs.existsSync(abs(inst)) ? 'stale    ' : 'missing  '}${inst}  (source: ${src})`);
  }
  const staleSet = new Set(stale.map(([inst]) => inst));
  for (const u of untracked) if (!staleSet.has(u)) console.log(`  untracked ${u}  (matches source but not committed)`);
  for (const o of orphans) console.log(`  orphan   ${o}  (no source)`);
  const n = new Set([...stale.map(([i]) => i), ...untracked, ...orphans]).size;
  if (n) {
    console.log(`\n✗ ${n} installed cop${n === 1 ? 'y' : 'ies'} out of step with source — run: node scripts/sync-installed-skills.cjs --fix, then commit (it prints the \`git add -f\` for new copies)`);
    process.exitCode = 1;
  } else if (!process.exitCode) {
    console.log(`✓ ${pairs.length} installed copies match source`);
  }
  return;
}

for (const [inst, src, name] of stale) {
  const isNew = !fs.existsSync(abs(inst));
  fs.mkdirSync(path.dirname(abs(inst)), { recursive: true });
  fs.writeFileSync(abs(inst), render(inst, src, name));
  console.log(`  ${isNew ? 'created' : 'updated'}  ${inst}`);
}
for (const o of orphans) {
  console.log(`  orphan   ${o}  — no source; remove with: git rm ${o}`);
  process.exitCode = 1;
}
if (untracked.length) console.log(`\n.claude/ is gitignored — start tracking with:\n  git add -f ${untracked.join(' ')}`);
if (!stale.length && !untracked.length && !orphans.length) console.log(`✓ ${pairs.length} installed copies already match source`);
