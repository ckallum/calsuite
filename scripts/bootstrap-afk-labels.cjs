#!/usr/bin/env node
'use strict';
/**
 * bootstrap-afk-labels.cjs — idempotently create the AFK label state-machine
 * labels on a GitHub repo. Run once per repo before enabling the AFK loops.
 *
 * The label IS the state-machine spine: exactly one loop owns an item at a time.
 * Issues flow through afk* ; PRs flow through auto:* .
 *
 * Usage: node scripts/bootstrap-afk-labels.cjs <owner/repo> [--dry-run]
 *
 * Node built-ins only; shells out to `gh` (uses --force so re-runs are safe).
 */
const { execFileSync } = require('node:child_process');

const LABELS = [
  { name: 'afk', color: '0E8A16', description: 'AFK: eligible for autonomous execution (issue)' },
  { name: 'afk:building', color: 'FBCA04', description: 'AFK: execute loop is building this — in-flight claim' },
  { name: 'afk:blocked', color: 'B60205', description: 'AFK: needs human — execute could not proceed' },
  { name: 'auto:needs-review', color: '1D76DB', description: 'AFK: PR awaiting the review loop' },
  { name: 'auto:reviewing', color: '5319E7', description: 'AFK: review loop is reviewing this — in-flight claim' },
  { name: 'auto:needs-fixes', color: 'FBCA04', description: 'AFK: review found actionable items; fix loop owns it' },
  { name: 'auto:fixing', color: '5319E7', description: 'AFK: fix loop is addressing feedback — in-flight claim' },
  { name: 'auto:ready', color: '0E8A16', description: 'AFK: clean; merge/gate loop owns it' },
  { name: 'auto:needs-human', color: 'D93F0B', description: 'AFK: needs human — the inbox, owned by nobody' },
];

const repo = process.argv[2];
const dry = process.argv.includes('--dry-run');

if (!repo || repo.startsWith('--')) {
  console.error('usage: node scripts/bootstrap-afk-labels.cjs <owner/repo> [--dry-run]');
  process.exit(2);
}
if (!/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/.test(repo)) {
  console.error(`✗ invalid repo "${repo}" — expected owner/repo`);
  process.exit(2);
}

console.log(`bootstrap-afk-labels: ${repo}${dry ? ' (dry-run)' : ''}`);
let ok = 0;
let failed = 0;
for (const l of LABELS) {
  if (dry) {
    console.log(`  + would ensure ${l.name} (#${l.color})`);
    ok++;
    continue;
  }
  try {
    execFileSync(
      'gh',
      ['label', 'create', l.name, '--repo', repo, '--color', l.color, '--description', l.description, '--force'],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    console.log(`  + ${l.name}`);
    ok++;
  } catch (e) {
    failed++;
    const msg = String((e && e.stderr) || (e && e.message) || e).trim().split('\n')[0];
    console.log(`  ! ${l.name} — ${msg}`);
  }
}
console.log(`\ndone: ${ok} ensured, ${failed} failed.`);
if (failed) process.exitCode = 1;
