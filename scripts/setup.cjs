#!/usr/bin/env node

/**
 * setup.cjs — first-run onboarding for a fresh calsuite checkout.
 *
 * Installs the post-commit git hook (which lives outside the tracked tree),
 * optionally seeds config/targets.json from the example, and runs a smoke
 * test of the installer against a throwaway temp project.
 *
 * Idempotent: re-running detects what's already in place and only fills gaps.
 * Safe on existing setups — refuses to overwrite a non-calsuite post-commit
 * hook without --force, and never touches targets.json if one already exists.
 *
 * Usage:
 *   node scripts/setup.cjs              # interactive: prompt for each step
 *   node scripts/setup.cjs --yes        # accept defaults, no prompts (CI)
 *   node scripts/setup.cjs --hook-only  # just install the post-commit hook
 *   node scripts/setup.cjs --no-smoke   # skip the smoke test (offline use)
 *   node scripts/setup.cjs --force      # overwrite existing non-calsuite hook
 *
 * Exit codes:
 *   0  setup completed (everything in place or filled in)
 *   1  refused — would overwrite a non-calsuite post-commit hook without --force
 *   2  smoke test failed
 *   3  not a git tree (refuse to install hook outside calsuite)
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');
const { execFileSync, spawnSync } = require('node:child_process');

const CONFIG_REPO = path.resolve(__dirname, '..');
const POST_COMMIT_TEMPLATE = path.join(CONFIG_REPO, 'scripts', 'git-hooks', 'post-commit');
const TARGETS_JSON = path.join(CONFIG_REPO, 'config', 'targets.json');
const TARGETS_EXAMPLE = path.join(CONFIG_REPO, 'config', 'targets.example.json');
const CALSUITE_HOOK_MARKER = 'Syncing calsuite to targets'; // identifies a calsuite-managed hook

const flags = {
  yes: false,
  hookOnly: false,
  noSmoke: false,
  force: false,
};
for (const arg of process.argv.slice(2)) {
  if (arg === '--yes' || arg === '-y') flags.yes = true;
  else if (arg === '--hook-only') flags.hookOnly = true;
  else if (arg === '--no-smoke') flags.noSmoke = true;
  else if (arg === '--force') flags.force = true;
  else {
    console.error(`Unknown flag: ${arg}`);
    console.error('Usage: node scripts/setup.cjs [--yes] [--hook-only] [--no-smoke] [--force]');
    process.exit(1);
  }
}

function log(msg)  { console.log(msg); }
function ok(msg)   { console.log(`  ✓ ${msg}`); }
function warn(msg) { console.log(`  ⚠ ${msg}`); }
function fail(msg) { console.error(`  ✗ ${msg}`); }

async function prompt(question, defaultYes = true) {
  if (flags.yes) return defaultYes;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultYes ? '[Y/n]' : '[y/N]';
  return new Promise((resolve) => {
    rl.question(`  ${question} ${suffix} `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (!a) return resolve(defaultYes);
      resolve(a === 'y' || a === 'yes');
    });
  });
}

// 1. Verify we're inside calsuite (a git tree containing scripts/configure-claude.js)
function verifyEnvironment() {
  log('\n--- Pre-flight ---');
  if (!fs.existsSync(path.join(CONFIG_REPO, 'scripts', 'configure-claude.js'))) {
    fail(`Not a calsuite checkout: ${CONFIG_REPO}`);
    fail('Run this script from inside a cloned calsuite repo.');
    process.exit(3);
  }
  let commonDir;
  try {
    commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: CONFIG_REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    fail('git rev-parse failed — is git installed and is this a git tree?');
    process.exit(3);
  }
  const absCommonDir = path.resolve(CONFIG_REPO, commonDir);
  ok(`calsuite checkout: ${CONFIG_REPO}`);
  ok(`canonical .git:    ${absCommonDir}`);
  return { absCommonDir };
}

// 2. Install the post-commit hook from the tracked template
function installPostCommitHook(absCommonDir) {
  log('\n--- Post-commit hook ---');
  const hookPath = path.join(absCommonDir, 'hooks', 'post-commit');

  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf8');
    if (existing.includes(CALSUITE_HOOK_MARKER)) {
      // It's our hook (or a previous version of it) — overwrite to pick up template updates
      fs.copyFileSync(POST_COMMIT_TEMPLATE, hookPath);
      fs.chmodSync(hookPath, 0o755);
      ok(`Refreshed existing calsuite post-commit hook at ${hookPath}`);
      return;
    }
    if (!flags.force) {
      fail(`A non-calsuite post-commit hook already exists at ${hookPath}.`);
      fail('Refusing to overwrite. Re-run with --force to replace it.');
      process.exit(1);
    }
    warn(`Overwriting existing post-commit hook at ${hookPath} (--force).`);
  }

  fs.mkdirSync(path.dirname(hookPath), { recursive: true });
  fs.copyFileSync(POST_COMMIT_TEMPLATE, hookPath);
  fs.chmodSync(hookPath, 0o755);
  ok(`Installed post-commit hook → ${hookPath}`);
}

// 3. Seed config/targets.json from the example if missing
async function seedTargetsJson() {
  log('\n--- Target list (config/targets.json) ---');
  if (fs.existsSync(TARGETS_JSON)) {
    ok('config/targets.json already exists — leaving as-is.');
    return;
  }
  const wantsTargets = await prompt('Configure target repos for --sync now?', true);
  if (!wantsTargets) {
    warn('Skipped. Copy config/targets.example.json to config/targets.json and edit when ready.');
    return;
  }
  if (!fs.existsSync(TARGETS_EXAMPLE)) {
    fail(`Example file missing: ${TARGETS_EXAMPLE}`);
    return;
  }
  fs.copyFileSync(TARGETS_EXAMPLE, TARGETS_JSON);
  ok(`Copied targets.example.json → targets.json`);
  log(`    Edit ${TARGETS_JSON} to list your target repos before /sync will fan out.`);
}

// 4. Smoke test: run the installer against a throwaway dir
function smokeTest() {
  if (flags.noSmoke) {
    log('\n--- Smoke test skipped (--no-smoke) ---');
    return;
  }
  log('\n--- Smoke test ---');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'calsuite-setup-'));
  try {
    spawnSync('git', ['init', '-q'], { cwd: tmpRoot, stdio: 'ignore' });
    const result = spawnSync(
      'node',
      [path.join(CONFIG_REPO, 'scripts', 'configure-claude.js'), tmpRoot],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    if (result.status !== 0) {
      fail(`Smoke test failed (exit ${result.status}).`);
      if (result.stderr) console.error(result.stderr.split('\n').slice(0, 10).join('\n'));
      process.exit(2);
    }
    // Verify a few expected outputs
    const settingsLocal = path.join(tmpRoot, '.claude', 'settings.local.json');
    if (!fs.existsSync(settingsLocal)) {
      fail('Installer ran but no .claude/settings.local.json was produced.');
      process.exit(2);
    }
    const parsed = JSON.parse(fs.readFileSync(settingsLocal, 'utf8'));
    const hookCount = Object.values(parsed.hooks || {}).flat().length;
    ok(`Installer produced ${hookCount} hook group(s) in settings.local.json`);
    ok(`Smoke test passed (target: ${tmpRoot})`);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// 5. Done — print a short next-steps block
function printNextSteps() {
  log('\n--- Setup complete ---');
  if (fs.existsSync(TARGETS_JSON)) {
    log('  Next: run `node scripts/configure-claude.js /path/to/target-repo` per target,');
    log('        or `node scripts/configure-claude.js --sync` to fan out to all configured targets.');
  } else {
    log('  Next: copy config/targets.example.json to config/targets.json and list your target repos.');
    log('        Then `node scripts/configure-claude.js --sync` will fan out to them.');
  }
  log('');
}

async function main() {
  log('calsuite setup');
  const { absCommonDir } = verifyEnvironment();
  installPostCommitHook(absCommonDir);
  if (flags.hookOnly) {
    log('\n--- Hook-only mode: skipping targets seed + smoke test ---');
    return;
  }
  await seedTargetsJson();
  smokeTest();
  printNextSteps();
}

main().catch((err) => {
  fail(`Setup failed: ${err.message}`);
  process.exit(1);
});
