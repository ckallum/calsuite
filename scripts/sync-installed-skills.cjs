#!/usr/bin/env node
'use strict';
/**
 * Keeps calsuite's git-tracked installed copies ("mirrors") in step with their sources:
 *   .claude/skills/<name>/**  <-  skills/<name>/**
 *   .claude/scripts/lib/*     <-  scripts/lib/*
 *
 * - Calsuite gitignores `.claude/`, so a fresh clone or worktree contains only the force-added
 *   mirrors, and `--sync` never refreshes calsuite itself (it is the source, not a target).
 *   Anything running in an isolated worktree — the AFK fix loop — sees these and nothing else.
 * - Content equality is `normalizeForCompare`, the installer's own definition, so `_origin` lines
 *   and auto-added frontmatter never count as content drift.
 * - Markdown mirrors carry `_origin: calsuite-mirror`. The installer reads any non-`calsuite@`
 *   origin as a claim and skips the file without reporting it, so `configure-claude.js .` on
 *   calsuite never rewrites a mirror. A `calsuite@<sha>` stamp can't serve here: no commit carrying
 *   the new content exists until the change merges, and squash-merging discards branch shas.
 *
 * Usage: node scripts/sync-installed-skills.cjs [--fix] [skill ...]
 *   (default)  report drift; exit 1 if any
 *   --fix      rewrite drifted mirrors from source and stage them (`git add -f`) for commit
 *   skill ...  also mirror these skills
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { normalizeForCompare, stampOrigin, readOrigin } = require('./lib/origin-protocol.cjs');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const FIX = args.includes('--fix');
const extraSkills = args.filter(a => !a.startsWith('--'));
const CLAIM = 'calsuite-mirror';

// Mirrored unconditionally because the AFK fix loop reads them from its isolated worktree:
// - review, receiving-pr-feedback: the dependencies skills/afk-fix/SKILL.md's preconditions check
//   (keep both lists in step)
// - ship: receiving-pr-feedback --publish-only reads .claude/skills/ship/pr-template.md
// - pr-body-parser.cjs: required by receiving-pr-feedback --publish-only
const REQUIRED_SKILLS = ['review', 'receiving-pr-feedback', 'ship'];
const REQUIRED_LIB = ['pr-body-parser.cjs'];

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });
const tracked = rel => git('ls-files', '-z', '--', rel).split('\0').filter(Boolean);
const abs = rel => path.join(ROOT, rel);

// [mirrorRel, sourceRel]
const pairs = [];
const orphans = [];

const trackedMirrors = tracked('.claude/skills');
const skillNames = new Set([
  ...trackedMirrors.map(f => f.split('/')[2]),
  ...REQUIRED_SKILLS,
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
    expected.add(`.claude/${src}`);
    pairs.push([`.claude/${src}`, src]);
  }
  for (const m of trackedMirrors) {
    if (m.startsWith(`.claude/skills/${name}/`) && !expected.has(m)) orphans.push(m);
  }
}
const libMirrors = new Set([
  ...tracked('.claude/scripts/lib'),
  ...REQUIRED_LIB.map(f => `.claude/scripts/lib/${f}`),
]);
for (const m of [...libMirrors].sort()) {
  const src = m.slice('.claude/'.length);
  if (fs.existsSync(abs(src))) pairs.push([m, src]);
  else orphans.push(m);
}

if (pairs.length === 0) {
  console.error('✗ no mirrors found to check — is .claude/ checked out?');
  process.exit(1);
}

const isMd = rel => rel.endsWith('.md');
const read = rel => fs.readFileSync(abs(rel), 'utf8');
const lf = s => s.replace(/\r\n/g, '\n');

/** First reason a mirror needs rewriting, or null when it is current. */
function problem(m, src) {
  if (!fs.existsSync(abs(m))) return 'missing';
  const a = read(m), b = read(src);
  if (isMd(src) ? normalizeForCompare(a) !== normalizeForCompare(b) : lf(a) !== lf(b)) return 'stale';
  if (isMd(src) && readOrigin(a) !== CLAIM) return 'unclaimed';
  return null;
}

const isTracked = new Set(tracked('.claude'));
const drift = pairs.map(([m, src]) => [m, src, problem(m, src)]).filter(([, , p]) => p);
// Current on disk but not committed = absent from every fresh checkout, so it is drift too.
const untracked = pairs.map(([m]) => m).filter(m => !isTracked.has(m) && !drift.some(([d]) => d === m));

const NOTE = {
  missing: 'no mirror',
  stale: 'differs from source',
  unclaimed: `lacks _origin: ${CLAIM}, so configure-claude.js may rewrite it`,
};

if (!FIX) {
  for (const [m, src, p] of drift) console.log(`  ${p.padEnd(9)} ${m}  (${NOTE[p]}; source: ${src})`);
  for (const m of untracked) console.log(`  untracked ${m}  (current but not committed)`);
  for (const o of orphans) console.log(`  orphan    ${o}  (no source)`);
  const n = drift.length + untracked.length + orphans.length;
  if (n) {
    console.log(`\n✗ ${n} mirror${n === 1 ? '' : 's'} out of step — run: node scripts/sync-installed-skills.cjs --fix, then commit`);
    process.exitCode = 1;
  } else if (!process.exitCode) {
    console.log(`✓ ${pairs.length} mirrors match source`);
  }
  return;
}

const staged = [];
for (const [m, src, p] of drift) {
  fs.mkdirSync(path.dirname(abs(m)), { recursive: true });
  fs.writeFileSync(abs(m), isMd(src) ? stampOrigin(read(src), CLAIM) : read(src));
  console.log(`  ${p === 'missing' ? 'created' : 'updated'}   ${m}`);
  staged.push(m);
}
staged.push(...untracked);
if (staged.length) {
  git('add', '-f', '--', ...staged);
  console.log(`\nstaged ${staged.length} mirror${staged.length === 1 ? '' : 's'} (git add -f) — commit them with the source change`);
}
for (const o of orphans) {
  console.log(`  orphan    ${o}  — no source; remove with: git rm ${o}`);
  process.exitCode = 1;
}
if (!staged.length && !orphans.length) console.log(`✓ ${pairs.length} mirrors already match source`);
