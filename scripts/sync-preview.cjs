#!/usr/bin/env node

/**
 * sync-preview.cjs
 *
 * Read-only preview of what `configure-claude.js --sync` would do across
 * every target in config/targets.json. Walks each target's installed
 * .claude/skills + .claude/agents markdown and calls decideFileAction on
 * each; aggregates the results into per-target and grand-total buckets.
 *
 * Writes NOTHING. Safe to run any time. Intended companion to /sync-preview
 * skill and to /reconcile-targets when you want a quick divergence snapshot
 * before committing to an agentic pass.
 *
 * Usage:
 *   node scripts/sync-preview.cjs          # all targets in config/targets.json
 *   node scripts/sync-preview.cjs --target <name>   # filter to one target by basename
 *   node scripts/sync-preview.cjs --json   # machine-readable output
 *
 * Exit codes:
 *   0 — ran to completion (regardless of divergence count)
 *   1 — fatal error (missing targets.json, missing calsuite, etc.)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CALSUITE_DIR = path.resolve(__dirname, '..');
const originProtocol = require(path.join(CALSUITE_DIR, 'scripts/lib/origin-protocol.cjs'));

const HOME = os.homedir();
const TARGETS_JSON = path.join(CALSUITE_DIR, 'config/targets.json');
const EXAMPLE_JSON = path.join(CALSUITE_DIR, 'config/targets.example.json');
const SKILLS_DIR = path.join(CALSUITE_DIR, 'skills');
const AGENTS_DIR = path.join(CALSUITE_DIR, 'agents');

function parseArgv() {
  const args = process.argv.slice(2);
  const flags = { json: false, target: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') flags.json = true;
    else if (args[i] === '--target') flags.target = args[++i];
    else if (args[i].startsWith('--')) {
      console.error(`✗ Unknown flag: ${args[i]}`);
      process.exit(1);
    }
  }
  return flags;
}

function expandHome(p) {
  return p.startsWith('~') ? path.join(HOME, p.slice(1)) : p;
}

function walkMd(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMd(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function destToCalsuiteRel(destPath) {
  const marker = path.sep + '.claude' + path.sep;
  const idx = destPath.indexOf(marker);
  if (idx === -1) return null;
  const after = destPath.slice(idx + marker.length);
  const first = after.split(path.sep)[0];
  if (first !== 'skills' && first !== 'agents') return null;
  return after.split(path.sep).join('/');
}

function previewTarget(targetPath) {
  const rel = p => path.relative(targetPath, p);
  const buckets = {
    'write-new': [],
    'write-update': [],
    'migrate': [],
    'skip-diverged': [],
    'skip-unknown': [],
    'skip-claimed': [],
  };

  const installed = [
    ...walkMd(path.join(targetPath, '.claude/skills')),
    ...walkMd(path.join(targetPath, '.claude/agents')),
  ];

  for (const destPath of installed) {
    const calsuiteRel = destToCalsuiteRel(destPath);
    if (!calsuiteRel) continue;
    const srcFile = path.join(CALSUITE_DIR, calsuiteRel);
    if (!fs.existsSync(srcFile)) continue; // target-side-only file
    const decision = originProtocol.decideFileAction(destPath, calsuiteRel, CALSUITE_DIR);
    buckets[decision.action].push({ path: rel(destPath), reason: decision.reason });
  }

  // Enumerate calsuite sources missing from the target — those are write-new
  // candidates. Profile filtering happens at real sync time; this overcounts
  // slightly for targets on narrow profiles, but the preview's job is to
  // reveal max divergence, not reproduce the installer's profile resolver.
  const srcMd = [...walkMd(SKILLS_DIR), ...walkMd(AGENTS_DIR)];
  const installedRel = new Set(installed.map(destToCalsuiteRel).filter(Boolean));
  for (const srcFile of srcMd) {
    const calsuiteRel = path.relative(CALSUITE_DIR, srcFile).split(path.sep).join('/');
    if (installedRel.has(calsuiteRel)) continue;
    const wouldLand = path.join(targetPath, '.claude', calsuiteRel);
    buckets['write-new'].push({ path: rel(wouldLand), reason: 'not present at target' });
  }

  return { label: path.basename(targetPath), targetPath, buckets };
}

function summariseBuckets(buckets) {
  return Object.fromEntries(
    Object.entries(buckets).map(([k, v]) => [k, v.length])
  );
}

function printHumanTarget(report) {
  const { label, targetPath, buckets } = report;
  const totals = summariseBuckets(buckets);
  console.log('');
  console.log(`=== ${label} (${targetPath}) ===`);
  console.log(`  write-new:     ${totals['write-new']}`);
  console.log(`  write-update:  ${totals['write-update']}`);
  console.log(`  migrate:       ${totals['migrate']}`);
  console.log(`  skip-diverged: ${totals['skip-diverged']}   ← would stay stuck without --reconcile/--force-adopt/--claim`);
  console.log(`  skip-unknown:  ${totals['skip-unknown']}    ← pre-protocol or stale; same resolution`);
  console.log(`  skip-claimed:  ${totals['skip-claimed']}    ← user-owned, working as designed`);

  for (const action of ['skip-diverged', 'skip-unknown', 'skip-claimed']) {
    if (!buckets[action].length) continue;
    console.log(`\n  [${action}]`);
    for (const { path: p, reason } of buckets[action]) {
      console.log(`    • ${p}${reason ? ` — ${reason}` : ''}`);
    }
  }

  // Only show write-new detail when small enough to be readable.
  if (buckets['write-new'].length) {
    const cap = 8;
    const header = buckets['write-new'].length > cap
      ? `[write-new — first ${cap} of ${buckets['write-new'].length}]`
      : `[write-new]`;
    console.log(`\n  ${header}`);
    for (const { path: p } of buckets['write-new'].slice(0, cap)) {
      console.log(`    • ${p}`);
    }
  }
  return totals;
}

function main() {
  const flags = parseArgv();

  let targets;
  try {
    targets = JSON.parse(fs.readFileSync(TARGETS_JSON, 'utf8')).targets;
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`✗ config/targets.json not found.`);
      console.error(`  Copy ${path.relative(CALSUITE_DIR, EXAMPLE_JSON)} to config/targets.json and add your target repo paths.`);
      process.exit(1);
    }
    throw err;
  }

  if (flags.target) {
    targets = targets.filter(t => path.basename(expandHome(t.path)) === flags.target);
    if (!targets.length) {
      console.error(`✗ No target named "${flags.target}" in config/targets.json`);
      process.exit(1);
    }
  }

  const currentSha = originProtocol.currentCalsuiteSha(CALSUITE_DIR);
  const reports = [];
  for (const t of targets) {
    const tp = path.resolve(expandHome(t.path));
    if (!fs.existsSync(tp)) {
      reports.push({ label: path.basename(tp), targetPath: tp, missing: true });
      continue;
    }
    reports.push(previewTarget(tp));
  }

  if (flags.json) {
    const out = {
      calsuiteSha: currentSha,
      targetCount: targets.length,
      targets: reports.map(r => r.missing
        ? { label: r.label, targetPath: r.targetPath, missing: true }
        : {
            label: r.label,
            targetPath: r.targetPath,
            totals: summariseBuckets(r.buckets),
            files: r.buckets,
          }),
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return;
  }

  console.log(`Calsuite HEAD: ${currentSha}`);
  console.log(`Targets: ${targets.length}`);

  const grand = {
    'write-new': 0, 'write-update': 0, 'migrate': 0,
    'skip-diverged': 0, 'skip-unknown': 0, 'skip-claimed': 0,
  };
  for (const report of reports) {
    if (report.missing) {
      console.log(`\n=== ${report.label} (${report.targetPath}) ===\n  ⚠ not found — skipping`);
      continue;
    }
    const totals = printHumanTarget(report);
    for (const k of Object.keys(grand)) grand[k] += totals[k];
  }

  console.log('\n────────────────────────────────────────');
  console.log('Totals across all targets:');
  for (const [k, v] of Object.entries(grand)) {
    console.log(`  ${k.padEnd(14)} ${v}`);
  }
  console.log('────────────────────────────────────────');

  const blocking = grand['skip-diverged'] + grand['skip-unknown'];
  if (blocking > 0) {
    console.log(`\n${blocking} file(s) would be skipped pending reconciliation.`);
    console.log('Resolve per-file with: --reconcile <path> / --force-adopt <path> / --claim <path>');
    console.log('Or invoke /reconcile-targets for agentic cross-target handling.');
  } else {
    console.log('\nNo reconciliation needed — all installed files are clean.');
  }
}

try {
  main();
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
