#!/usr/bin/env node

/**
 * configure-claude.js
 *
 * Installs Claude Code hooks, scripts, and config into a target project's .claude/ directory.
 * Auto-detects project type (typescript, python, frontend, backend, monorepo) and installs
 * only relevant plugins, skills, agents, and templates per profile.
 *
 * Usage: node configure-claude.js [target-directory]
 *   target-directory defaults to cwd
 *
 * Flags:
 *   --only skill1,skill2,...     Install only specific skills (skips hooks/plugins/settings)
 *   --agents agent1,agent2,...   Install only specific agents (use with --only)
 *   --install-ccstatusline       Install ccstatusline config only
 *   --sync                       Re-run install against all targets in config/targets.json
 *   --force-adopt <path>         Overwrite a target skill/agent file with calsuite's
 *                                current version. Discards local edits. Stamps fresh
 *                                `_origin: calsuite@<sha>`. Prompts for confirmation;
 *                                pass --yes (or -y) to skip the prompt.
 *   --claim <path>               Mark a target skill/agent file as user-owned. Stamps
 *                                `_origin: <target-name>` in frontmatter, preserves
 *                                content. Subsequent syncs never touch it.
 *   --reconcile <path>           Interactive three-way merge helper for divergent
 *                                skill/agent files. Shows calsuite-current, calsuite
 *                                at install sha, and target-current side-by-side, then
 *                                offers keep / adopt / merge-in-$EDITOR / skip. Requires
 *                                a TTY.
 *   --yes, -y                    Skip confirmation prompts for destructive operations.
 */

const fs = require('fs');
const path = require('path');
const originProtocol = require('./lib/origin-protocol.cjs');

const CONFIG_REPO = path.resolve(__dirname, '..');
const HOOKS_JSON = path.join(CONFIG_REPO, 'hooks', 'hooks.json');
const GLOBAL_MANIFEST = path.join(CONFIG_REPO, 'config', 'global-settings.json');
const PROFILES_JSON = path.join(CONFIG_REPO, 'config', 'profiles.json');
const SKILLS_DIR = path.join(CONFIG_REPO, 'skills');
const AGENTS_DIR = path.join(CONFIG_REPO, 'agents');
const TEMPLATES_DIR = path.join(CONFIG_REPO, 'templates');
const LINT_CONFIGS_DIR = path.join(CONFIG_REPO, 'config', 'lint-configs');
const TARGETS_JSON = path.join(CONFIG_REPO, 'config', 'targets.json');
const HOME_DIR = require('os').homedir();
const HOME_SETTINGS = path.join(HOME_DIR, '.claude', 'settings.json');
const HOME_SETTINGS_LOCAL = path.join(HOME_DIR, '.claude', 'settings.local.json');
const HOME_MCP_JSON = path.join(HOME_DIR, '.mcp.json');
const KNOWN_MARKETPLACES = path.join(HOME_DIR, '.claude', 'plugins', 'known_marketplaces.json');
// Skills that only make sense in the config repo itself — never export to target repos
const INTERNAL_SKILLS = new Set(['configure-claude', 'skill-builder']);

/**
 * Resolve the absolute path to the calsuite checkout on this machine.
 * Order: $CALSUITE_DIR env var → ~/Projects/calsuite → installer's parent.
 * The resolved path is written literally into target's settings.local.json —
 * Claude Code's hook runner does not shell-expand hook commands, so embedded
 * $VAR syntax would not work at runtime.
 */
function resolveCalsuiteDir() {
  if (process.env.CALSUITE_DIR) return path.resolve(process.env.CALSUITE_DIR);
  const defaultPath = path.join(HOME_DIR, 'Projects', 'calsuite');
  if (fs.existsSync(defaultPath)) return defaultPath;
  return CONFIG_REPO;
}

/**
 * Substitute every occurrence of the ${CALSUITE_DIR} placeholder in a
 * parsed hooks config with the resolved absolute path. Operates on the
 * JSON-stringified form so it catches the placeholder regardless of which
 * nested field it appears in.
 */
function substituteCalsuiteDir(hooksObj, calsuiteDir) {
  const json = JSON.stringify(hooksObj);
  const safeDir = calsuiteDir.replace(/\\/g, '\\\\');
  return JSON.parse(json.replace(/\$\{CALSUITE_DIR\}/g, () => safeDir));
}

// Actions that should result in (re)writing the destination file.
const WRITE_ACTIONS = new Set(['write-new', 'write-update', 'migrate']);
// Actions that indicate a file was skipped and needs user reconciliation.
const BLOCKING_SKIP_ACTIONS = new Set(['skip-diverged', 'skip-unknown']);

// Fresh counters for every action installProtectedFile can emit.
function makeInstallStats() {
  return {
    'write-new': 0,
    'write-update': 0,
    'migrate': 0,
    'skip-diverged': 0,
    'skip-unknown': 0,
    'skip-claimed': 0,
    'skip-exists': 0,
  };
}

// Aggregate a stats object into the three numbers used in log lines.
function summarizeInstallStats(stats) {
  return {
    written: stats['write-new'] + stats['write-update'] + stats['migrate'],
    skipped: stats['skip-diverged'] + stats['skip-unknown'],
    preserved: stats['skip-claimed'] + stats['skip-exists'],
  };
}

/**
 * Install one calsuite-managed file into a target, respecting the
 * `_origin` safe-overwrite protocol for markdown files. Non-markdown
 * files use copy-no-overwrite semantics (simpler; can be promoted to
 * sidecar-`.origin` tracking later if it matters).
 *
 * Mutates `stats` (an object with per-action counters) and `divergences`
 * (an array of { destPath, action, reason }) so the caller can aggregate
 * across many files.
 */
function installProtectedFile({ srcFile, destFile, calsuiteDir, currentSha, stats, divergences }) {
  fs.mkdirSync(path.dirname(destFile), { recursive: true });

  if (!srcFile.endsWith('.md')) {
    // Non-markdown files inside a skill dir use copy-no-overwrite semantics
    // (they can't host YAML frontmatter, so the _origin protocol doesn't
    // apply). A pre-existing file at dest means "leave alone" — this is
    // not the same as user-claimed; separate counter to avoid confusing logs.
    if (fs.existsSync(destFile)) {
      stats['skip-exists']++;
      return;
    }
    fs.copyFileSync(srcFile, destFile);
    stats['write-new']++;
    return;
  }

  const calsuiteRelPath = path.relative(calsuiteDir, srcFile);
  const decision = originProtocol.decideFileAction(destFile, calsuiteRelPath, calsuiteDir);
  stats[decision.action]++;

  if (WRITE_ACTIONS.has(decision.action)) {
    const srcContent = fs.readFileSync(srcFile, 'utf8');
    const stamped = originProtocol.stampOrigin(srcContent, `calsuite@${currentSha}`);
    fs.writeFileSync(destFile, stamped);
    return;
  }

  if (BLOCKING_SKIP_ACTIONS.has(decision.action)) {
    divergences.push({ destPath: destFile, action: decision.action, reason: decision.reason });
  }
}

/**
 * If a directory exists and every entry in it is a symbolic link whose target
 * lives inside `calsuiteDir`, remove the whole directory. No-op otherwise —
 * any real file or symlink-to-elsewhere signals user content to preserve.
 *
 * Cleans up the pre-refactor installer's `.claude/scripts/hooks/` and
 * `.claude/scripts/lib/` dirs. Those directories are no longer populated;
 * hook commands in settings.local.json reference calsuite directly.
 */
function removeIfAllCalsuiteSymlinks(dir, calsuiteDir) {
  if (!fs.existsSync(dir)) return false;
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory()) return false;

  const entries = fs.readdirSync(dir);
  if (entries.length === 0) {
    fs.rmdirSync(dir);
    return true;
  }

  for (const name of entries) {
    const entryPath = path.join(dir, name);
    const entryStat = fs.lstatSync(entryPath);
    if (!entryStat.isSymbolicLink()) return false;
    const linkTarget = fs.readlinkSync(entryPath);
    const resolved = path.resolve(dir, linkTarget);
    if (!resolved.startsWith(calsuiteDir + path.sep) && resolved !== calsuiteDir) {
      return false;
    }
  }

  for (const name of entries) {
    fs.unlinkSync(path.join(dir, name));
  }
  fs.rmdirSync(dir);
  return true;
}

/**
 * Ensure a `.gitignore` file in `dir` contains `.claude/settings.local.json`.
 * Additive only — preserves any existing content and never removes entries.
 * Returns true if the file was modified, false if the entry was already there.
 */
function ensureGitignoreEntry(dir) {
  const gitignorePath = path.join(dir, '.gitignore');
  const entry = '.claude/settings.local.json';
  let existing = '';
  if (fs.existsSync(gitignorePath)) {
    existing = fs.readFileSync(gitignorePath, 'utf8');
    const lines = existing.split(/\r?\n/).map(l => l.trim());
    if (lines.includes(entry)) return false;
  }
  const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
  const block = `${prefix}\n# calsuite (personal harness) — never commit\n${entry}\n`;
  fs.writeFileSync(gitignorePath, existing + block);
  return true;
}

/**
 * Print a one-block end-of-sync summary of files that couldn't be safely
 * auto-updated. skip-claimed entries aren't included — those are working
 * as designed (user-owned files).
 */
function printDivergenceSummary(divergences) {
  const blocking = divergences.filter(d => BLOCKING_SKIP_ACTIONS.has(d.action));
  if (blocking.length === 0) return;
  console.log('');
  console.log('  ───────────────────────────────────────────────────────────────');
  console.log(`  ${blocking.length} file(s) skipped pending reconciliation:`);
  for (const d of blocking) {
    console.log(`    • ${d.destPath}`);
    console.log(`      ${d.action}: ${d.reason}`);
  }
  console.log('');
  console.log('  Resolve with:');
  console.log('    node scripts/configure-claude.js --force-adopt <path>   # overwrite with calsuite current');
  console.log('    node scripts/configure-claude.js --claim <path>         # stamp _origin=<target>, keep local');
  console.log('    node scripts/configure-claude.js --reconcile <path>     # (issue #42) three-way merge');
  console.log('  ───────────────────────────────────────────────────────────────');
}

/**
 * Recursively list every file under a directory as absolute paths.
 * Skips `.claude/` and any dot-prefixed directories.
 */
function listFilesRecursive(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Copy a directory, but only if destination files don't already exist.
 * Preserves existing files (never overwrites).
 */
function copyDirSyncNoOverwrite(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSyncNoOverwrite(srcPath, destPath);
    } else if (!fs.existsSync(destPath)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function mergeHooks(existingHooks, newHooks) {
  const merged = {};
  const allEvents = new Set([...Object.keys(existingHooks || {}), ...Object.keys(newHooks || {})]);

  for (const event of allEvents) {
    const existing = existingHooks?.[event] || [];
    const incoming = newHooks?.[event] || [];
    // Keep project-specific hooks (no _origin or _origin !== "calsuite")
    const projectHooks = existing.filter(h => !h._origin || h._origin !== 'calsuite');
    // Calsuite hooks come first, then project-specific
    merged[event] = [...incoming, ...projectHooks];
  }

  return merged;
}

/**
 * Read and parse a JSON file. Returns null if the file is missing (ENOENT)
 * — a common and benign case — so callers can idiom `readJsonSync(...) || {}`.
 * THROWS on parse errors; silently returning null for malformed JSON would
 * let the installer rebuild the file from scratch, wiping user content.
 */
function readJsonSync(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`Failed to read ${filePath}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `${filePath} is not valid JSON (${err.message}).\n` +
      `Refusing to overwrite — fix or delete the file manually, then re-run the installer.`
    );
  }
}

// --- Profile detection ---

function detectProfiles(targetDir) {
  const profilesConfig = readJsonSync(PROFILES_JSON);
  if (!profilesConfig) return ['base'];

  const signals = profilesConfig.signals;
  const matched = [];

  for (const [name, signal] of Object.entries(signals)) {
    if (matchesSignal(targetDir, signal)) {
      matched.push(name);
    }
  }

  return matched.length > 0 ? matched : ['base'];
}

function matchesSignal(targetDir, signal) {
  // Check file existence
  if (signal.files) {
    for (const file of signal.files) {
      if (fs.existsSync(path.join(targetDir, file))) return true;
    }
  }

  // Check package.json dependencies
  if (signal.packageDeps) {
    const pkg = readJsonSync(path.join(targetDir, 'package.json'));
    if (pkg) {
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const dep of signal.packageDeps) {
        if (allDeps[dep]) return true;
      }
    }
  }

  // Check package.json fields (must be non-empty)
  if (signal.packageFields) {
    const pkg = readJsonSync(path.join(targetDir, 'package.json'));
    if (pkg) {
      for (const field of signal.packageFields) {
        const val = pkg[field];
        if (val == null) continue;
        if (Array.isArray(val) && val.length > 0) return true;
        if (typeof val === 'string' && val.trim().length > 0) return true;
        if (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length > 0) return true;
      }
    }
  }

  // Check subdirectory existence (any match triggers)
  if (signal.dirs) {
    for (const dir of signal.dirs) {
      const dirPath = path.join(targetDir, dir);
      if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) return true;
    }
  }

  return false;
}

function resolveProfile(profileNames, profilesConfig) {
  const profiles = profilesConfig.profiles;
  const resolved = { plugins: new Set(), skills: new Set(), agents: new Set(), templates: new Set() };

  for (const name of profileNames) {
    mergeProfile(name, profiles, resolved, new Set());
  }

  return {
    plugins: [...resolved.plugins],
    skills: [...resolved.skills],
    agents: [...resolved.agents],
    templates: [...resolved.templates],
  };
}

function mergeProfile(name, profiles, resolved, visited) {
  if (visited.has(name)) return;
  visited.add(name);

  const profile = profiles[name];
  if (!profile) return;

  // Resolve parent first
  if (profile.extends) {
    mergeProfile(profile.extends, profiles, resolved, visited);
  }

  if (profile.plugins) profile.plugins.forEach(p => resolved.plugins.add(p));
  if (profile.skills) profile.skills.forEach(s => resolved.skills.add(s));
  if (profile.agents) profile.agents.forEach(a => resolved.agents.add(a));
  if (profile.templates) profile.templates.forEach(t => resolved.templates.add(t));
}

function findWorkspaces(targetDir) {
  const workspaces = [];

  // Check for backend/ and frontend/ subdirs
  for (const name of ['backend', 'frontend']) {
    const wsPath = path.join(targetDir, name);
    if (fs.existsSync(wsPath) && fs.statSync(wsPath).isDirectory()) {
      workspaces.push({ name, path: wsPath });
    }
  }

  // Also check package.json workspaces field for additional dirs
  const pkg = readJsonSync(path.join(targetDir, 'package.json'));
  if (pkg?.workspaces) {
    const wsPatterns = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces.packages || [];
    for (const pattern of wsPatterns) {
      const isGlob = /\/\*+$/.test(pattern);
      const dir = pattern.replace(/\/\*+$/, '');
      const wsPath = path.join(targetDir, dir);

      if (!fs.existsSync(wsPath) || !fs.statSync(wsPath).isDirectory()) continue;

      if (isGlob) {
        // Enumerate children of the glob parent as individual workspaces
        for (const child of fs.readdirSync(wsPath, { withFileTypes: true })) {
          if (!child.isDirectory()) continue;
          const childPath = path.join(wsPath, child.name);
          if (!workspaces.find(w => w.path === childPath)) {
            workspaces.push({ name: child.name, path: childPath });
          }
        }
      } else {
        if (!workspaces.find(w => w.path === wsPath)) {
          workspaces.push({ name: dir, path: wsPath });
        }
      }
    }
  }

  return workspaces;
}

// --- Installation ---

function installForProfile(targetDir, resolvedProfile, label, opts = {}) {
  const claudeDir = path.join(targetDir, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');
  const calsuiteDir = resolveCalsuiteDir();
  const currentSha = originProtocol.currentCalsuiteSha(calsuiteDir);

  console.log(`\n--- Installing: ${label} (${targetDir}) ---\n`);

  // 0. Clean up pre-refactor stale dirs: .claude/scripts/hooks and .claude/scripts/lib.
  //    These were populated with symlinks to calsuite before the hook-refactor.
  //    Safe to remove iff every entry is still a calsuite symlink (user-added
  //    scripts are preserved).
  const staleHooks = path.join(claudeDir, 'scripts', 'hooks');
  const staleLib = path.join(claudeDir, 'scripts', 'lib');
  const removedHooks = removeIfAllCalsuiteSymlinks(staleHooks, calsuiteDir);
  const removedLib = removeIfAllCalsuiteSymlinks(staleLib, calsuiteDir);
  if (removedHooks || removedLib) {
    const parts = [];
    if (removedHooks) parts.push('scripts/hooks');
    if (removedLib) parts.push('scripts/lib');
    console.log(`  ✓ Removed stale pre-refactor ${parts.join(', ')} dir(s) (were all calsuite symlinks)`);
    // Remove the now-empty scripts dir too if nothing else is in it
    const scriptsDir = path.join(claudeDir, 'scripts');
    if (fs.existsSync(scriptsDir) && fs.readdirSync(scriptsDir).length === 0) {
      fs.rmdirSync(scriptsDir);
    }
  }


  // 1. Create .claude/ directory (and targetDir itself if missing)
  fs.mkdirSync(claudeDir, { recursive: true });
  console.log(`  ✓ Ensured ${claudeDir} exists`);

  // 1b. Ensure `.claude/settings.local.json` is gitignored in the target.
  //     Has to run after targetDir exists (the .claude mkdir above creates it
  //     via { recursive: true }).
  if (ensureGitignoreEntry(targetDir)) {
    console.log(`  ✓ Added .claude/settings.local.json to ${path.join(targetDir, '.gitignore')}`);
  }

  // 2. Hook scripts (scripts/hooks/, scripts/lib/) are NOT copied or symlinked
  //    into target/.claude/. Hook commands in settings.local.json reference them
  //    directly from $CALSUITE_DIR, so there's no target-side footprint to manage.

  // 2b. Copy guardian rules config
  const guardianSrc = path.join(CONFIG_REPO, 'config', 'guardian-rules.json');
  const guardianDest = path.join(claudeDir, 'config', 'guardian-rules.json');
  if (fs.existsSync(guardianSrc)) {
    fs.mkdirSync(path.join(claudeDir, 'config'), { recursive: true });
    if (!fs.existsSync(guardianDest)) {
      fs.copyFileSync(guardianSrc, guardianDest);
      console.log(`  ✓ Seeded guardian rules → ${guardianDest}`);
    }
  }

  // 2c. Copy agent lint rules config (no-overwrite — user is expected to tune)
  const agentRulesSrc = path.join(LINT_CONFIGS_DIR, 'agent-rules.json');
  const agentRulesDest = path.join(claudeDir, 'config', 'agent-rules.json');
  if (fs.existsSync(agentRulesSrc)) {
    fs.mkdirSync(path.join(claudeDir, 'config'), { recursive: true });
    if (!fs.existsSync(agentRulesDest)) {
      fs.copyFileSync(agentRulesSrc, agentRulesDest);
      console.log(`  ✓ Seeded agent lint rules → ${agentRulesDest}`);
    }
  }

  // 2d. Copy ESLint base configs (no-overwrite — respect existing project configs)
  const lintConfigDest = path.join(targetDir, '.eslintrc.json');
  const hasExistingEslintConfig =
    fs.existsSync(lintConfigDest) ||
    fs.existsSync(path.join(targetDir, '.eslintrc.js')) ||
    fs.existsSync(path.join(targetDir, '.eslintrc.cjs')) ||
    fs.existsSync(path.join(targetDir, 'eslint.config.js')) ||
    fs.existsSync(path.join(targetDir, 'eslint.config.mjs'));
  if (!hasExistingEslintConfig) {
    // Determine which config to install based on detected profiles
    const isTypescript = fs.existsSync(path.join(targetDir, 'tsconfig.json'));
    const configSrc = isTypescript
      ? path.join(LINT_CONFIGS_DIR, 'typescript.eslintrc.json')
      : path.join(LINT_CONFIGS_DIR, 'base.eslintrc.json');
    if (fs.existsSync(configSrc)) {
      // For typescript config, also copy the base config it extends
      if (isTypescript) {
        const baseDest = path.join(targetDir, '.eslintrc.base.json');
        if (!fs.existsSync(baseDest)) {
          fs.copyFileSync(path.join(LINT_CONFIGS_DIR, 'base.eslintrc.json'), baseDest);
        }
      }
      fs.copyFileSync(configSrc, lintConfigDest);
      console.log(`  ✓ Installed ESLint config → ${lintConfigDest} (${isTypescript ? 'typescript' : 'base'})`);
    }
  } else {
    console.log(`  ✓ ESLint config already exists (skipped)`);
  }

  // 3. Install skills via the _origin safe-overwrite protocol.
  //    Every markdown file under each profile-listed skill dir is copied
  //    with `_origin: calsuite@<sha>` stamped into its frontmatter.
  //    Existing files with local edits are detected and preserved.
  const destSkills = path.join(claudeDir, 'skills');
  const skillStats = makeInstallStats();
  const divergences = opts.divergences || [];
  for (const skillName of resolvedProfile.skills) {
    if (INTERNAL_SKILLS.has(skillName)) continue;
    const srcSkill = path.join(SKILLS_DIR, skillName);
    if (!fs.existsSync(srcSkill) || !fs.statSync(srcSkill).isDirectory()) continue;
    for (const srcFile of listFilesRecursive(srcSkill)) {
      const relFromSkills = path.relative(SKILLS_DIR, srcFile);
      const destFile = path.join(destSkills, relFromSkills);
      installProtectedFile({ srcFile, destFile, calsuiteDir, currentSha, stats: skillStats, divergences });
    }
  }
  const skillSummary = summarizeInstallStats(skillStats);
  const preservedBreakdown = [];
  if (skillStats['skip-claimed']) preservedBreakdown.push(`${skillStats['skip-claimed']} user-claimed`);
  if (skillStats['skip-exists']) preservedBreakdown.push(`${skillStats['skip-exists']} non-md kept`);
  console.log(`  ✓ Skills: ${skillSummary.written} written (${skillStats['write-new']} new / ${skillStats['write-update']} updated / ${skillStats['migrate']} migrated), ${skillSummary.skipped} skipped${skillSummary.preserved ? `, ${preservedBreakdown.join(' / ')}` : ''}`);

  // 4. Install agents via the same protocol (agent files are single .md each)
  if (resolvedProfile.agents.length > 0) {
    const destAgents = path.join(claudeDir, 'agents');
    const agentStats = makeInstallStats();
    for (const agentName of resolvedProfile.agents) {
      const srcAgent = path.join(AGENTS_DIR, `${agentName}.md`);
      if (!fs.existsSync(srcAgent)) continue;
      const destAgent = path.join(destAgents, `${agentName}.md`);
      installProtectedFile({ srcFile: srcAgent, destFile: destAgent, calsuiteDir, currentSha, stats: agentStats, divergences });
    }
    const agentSummary = summarizeInstallStats(agentStats);
    console.log(`  ✓ Agents: ${agentSummary.written} written, ${agentSummary.skipped} skipped${agentStats['skip-claimed'] ? `, ${agentStats['skip-claimed']} user-claimed` : ''}`);
  }

  // 5. Copy templates (never overwrite existing)
  if (resolvedProfile.templates.includes('specs')) {
    // Copy spec templates → .claude/specs/
    const destSpecs = path.join(claudeDir, 'specs');
    copyDirSyncNoOverwrite(path.join(TEMPLATES_DIR, 'specs'), destSpecs);
    console.log(`  ✓ Copied spec templates → ${destSpecs} (no overwrite)`);

    // Copy SPECLOG.md and CHANGELOG.md → project root
    for (const file of ['SPECLOG.md', 'CHANGELOG.md']) {
      const destFile = path.join(targetDir, file);
      if (!fs.existsSync(destFile)) {
        fs.copyFileSync(path.join(TEMPLATES_DIR, file), destFile);
        console.log(`  ✓ Created ${file}`);
      } else {
        console.log(`  ✓ ${file} already exists (skipped)`);
      }
    }

    // Copy docs/ template → project root docs/
    const destDocs = path.join(targetDir, 'docs');
    if (!fs.existsSync(destDocs)) {
      copyDirSyncNoOverwrite(path.join(TEMPLATES_DIR, 'docs'), destDocs);
      console.log(`  ✓ Created docs/ folder`);
    } else {
      console.log(`  ✓ docs/ already exists (skipped)`);
    }
  }

  // 6. Read hooks.json from config repo
  const hooksConfig = readJsonSync(HOOKS_JSON);
  if (!hooksConfig) {
    console.error('  ✗ Could not read hooks.json from config repo');
    process.exit(1);
  }

  if (!hooksConfig.hooks) {
    console.error('  ✗ hooks.json is missing "hooks" key');
    process.exit(1);
  }

  // Substitute ${CALSUITE_DIR} with the literal absolute path. Claude Code's
  // hook runner does not shell-expand command strings, so $VAR syntax cannot
  // resolve at runtime — the installer must resolve it now.
  const resolvedHooks = substituteCalsuiteDir(hooksConfig.hooks, calsuiteDir);

  // 7. Write calsuite hooks into settings.local.json (gitignored, per-user).
  //    settings.json is team-shared and must never contain per-machine paths.
  const settingsLocalPath = path.join(claudeDir, 'settings.local.json');
  const existingLocal = readJsonSync(settingsLocalPath) || {};
  const mergedLocalHooks = mergeHooks(existingLocal.hooks, resolvedHooks);
  const projectHookCount = Object.values(mergedLocalHooks)
    .flat()
    .filter(h => !h._origin || h._origin !== 'calsuite').length;
  const calsuiteHookCount = Object.values(mergedLocalHooks)
    .flat()
    .filter(h => h._origin === 'calsuite').length;
  const mergedLocal = {
    ...existingLocal,
    hooks: mergedLocalHooks,
  };
  fs.writeFileSync(settingsLocalPath, JSON.stringify(mergedLocal, null, 2) + '\n');
  console.log(`  ✓ Wrote ${calsuiteHookCount} calsuite hook(s) to ${settingsLocalPath}${projectHookCount > 0 ? ` (preserved ${projectHookCount} project-specific hook(s))` : ''}`);

  // 8. Update target settings.json with plugins + guardian permissions only.
  //    Migration: strip any legacy calsuite-origin hooks that earlier versions
  //    of this installer wrote into settings.json; those now belong in
  //    settings.local.json and would otherwise be duplicated.
  const existingSettings = readJsonSync(settingsPath) || {};
  const legacyHooks = existingSettings.hooks || {};
  const cleanedHooks = {};
  let migratedCount = 0;
  for (const [event, entries] of Object.entries(legacyHooks)) {
    const kept = Array.isArray(entries)
      ? entries.filter(e => e._origin !== 'calsuite')
      : entries;
    if (Array.isArray(entries)) {
      migratedCount += entries.length - kept.length;
    }
    if (!Array.isArray(entries) || kept.length > 0) {
      cleanedHooks[event] = kept;
    }
  }
  if (migratedCount > 0) {
    console.log(`  ✓ Removed ${migratedCount} legacy calsuite hook(s) from ${settingsPath} (now in settings.local.json)`);
  }

  const pluginsToEnable = {};
  for (const plugin of resolvedProfile.plugins) {
    pluginsToEnable[plugin] = true;
  }

  const merged = {
    ...existingSettings,
    ...(hooksConfig.$schema ? { $schema: hooksConfig.$schema } : {}),
    enabledPlugins: { ...existingSettings.enabledPlugins, ...pluginsToEnable },
  };
  if (Object.keys(cleanedHooks).length > 0) {
    merged.hooks = cleanedHooks;
  } else {
    delete merged.hooks;
  }

  // Derive permissions from guardian-rules.json (single source of truth).
  // On re-install, this replaces the entire allow list to prevent drift.
  const guardianConfig = readJsonSync(guardianDest);
  if (guardianConfig?.permissions) {
    const mode = guardianConfig.mode || 'supervised';
    const modePerms = guardianConfig.permissions[mode];
    if (modePerms?.allow) {
      merged.permissions = {
        ...merged.permissions,
        allow: modePerms.allow,
      };
      console.log(`  ✓ Set guardian permissions from "${mode}" mode (${modePerms.allow.length} allow entries)`);
    }
  }

  fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n');
  console.log(`  ✓ Updated ${settingsPath} (plugins + permissions; no hooks/paths)`);
}

function installCcstatuslineConfig(manifest) {
  const ccstatuslineDir = path.join(require('os').homedir(), '.config', 'ccstatusline');
  const ccstatuslinePath = path.join(ccstatuslineDir, 'settings.json');
  const existing = readJsonSync(ccstatuslinePath);

  if (existing) {
    const backupPath = ccstatuslinePath + '.bak';
    fs.copyFileSync(ccstatuslinePath, backupPath);
    console.log(`  ✓ Backed up existing config → ${backupPath}`);
  }

  fs.mkdirSync(ccstatuslineDir, { recursive: true });
  fs.writeFileSync(ccstatuslinePath, JSON.stringify(manifest.ccstatusline, null, 2) + '\n');
  console.log(`  ✓ Installed ccstatusline config (v${manifest.ccstatusline.version}) → ${ccstatuslinePath}`);
}

/**
 * --only mode: Install specific skills/agents only, without touching hooks or settings.
 * Usage: node configure-claude.js <target> --only review,qa,ship
 *        node configure-claude.js <target> --only review,qa --agents code-reviewer
 */
function installOnly(targetDir, onlySkills, onlyAgents, outerDivergences = null) {
  const claudeDir = path.join(targetDir, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  const calsuiteDir = resolveCalsuiteDir();
  const currentSha = originProtocol.currentCalsuiteSha(calsuiteDir);
  const missing = [];
  const divergences = outerDivergences || [];

  // Install specified skills (routed through the _origin safe-overwrite
  // protocol so explicit --only installs never silently clobber local edits).
  if (onlySkills.length > 0) {
    const destSkills = path.join(claudeDir, 'skills');
    const stats = makeInstallStats();
    let count = 0;
    for (const skillName of onlySkills) {
      if (INTERNAL_SKILLS.has(skillName)) {
        console.log(`  ⊘ Skipped internal skill: ${skillName}`);
        continue;
      }
      const srcSkill = path.join(SKILLS_DIR, skillName);
      if (fs.existsSync(srcSkill) && fs.statSync(srcSkill).isDirectory()) {
        for (const srcFile of listFilesRecursive(srcSkill)) {
          const relFromSkills = path.relative(SKILLS_DIR, srcFile);
          const destFile = path.join(destSkills, relFromSkills);
          installProtectedFile({ srcFile, destFile, calsuiteDir, currentSha, stats, divergences });
        }
        count++;
        console.log(`  ✓ Processed skill: ${skillName}`);
      } else {
        console.log(`  ✗ Skill not found: ${skillName}`);
        missing.push(`skill:${skillName}`);
      }
    }
    const summary = summarizeInstallStats(stats);
    console.log(`  → ${count} skill(s): ${summary.written} files written, ${summary.skipped} skipped, ${summary.preserved} preserved`);
  }

  // Install specified agents through the same protocol.
  if (onlyAgents.length > 0) {
    const destAgents = path.join(claudeDir, 'agents');
    const stats = makeInstallStats();
    let count = 0;
    for (const agentName of onlyAgents) {
      const srcAgent = path.join(AGENTS_DIR, `${agentName}.md`);
      if (fs.existsSync(srcAgent)) {
        const destAgent = path.join(destAgents, `${agentName}.md`);
        installProtectedFile({ srcFile: srcAgent, destFile: destAgent, calsuiteDir, currentSha, stats, divergences });
        count++;
        console.log(`  ✓ Processed agent: ${agentName}`);
      } else {
        console.log(`  ✗ Agent not found: ${agentName}`);
        missing.push(`agent:${agentName}`);
      }
    }
    const summary = summarizeInstallStats(stats);
    console.log(`  → ${count} agent(s): ${summary.written} written, ${summary.skipped} skipped`);
  }

  // Also install into workspaces if monorepo
  const detectedProfiles = detectProfiles(targetDir);
  if (detectedProfiles.includes('monorepo')) {
    const workspaces = findWorkspaces(targetDir);
    for (const ws of workspaces) {
      console.log(`\n  Workspace: ${ws.name}`);
      const wsMissing = installOnly(ws.path, onlySkills, onlyAgents, divergences);
      missing.push(...wsMissing);
    }
  }

  // Top-level callers print the divergence summary once; if invoked without an
  // outer list we're the top-level — print here.
  if (!outerDivergences) {
    printDivergenceSummary(divergences);
  }
  return missing;
}

function installTarget(targetDir, profilesConfig, opts = {}) {
  const detectedProfiles = detectProfiles(targetDir);
  if (opts.logProfiles) {
    console.log(`  Detected profiles: ${detectedProfiles.join(', ')}`);
  }

  const isMonorepo = detectedProfiles.includes('monorepo');

  if (isMonorepo) {
    const rootProfileNames = detectedProfiles.filter(p => p !== 'monorepo').concat('monorepo-root');
    const rootResolved = resolveProfile(rootProfileNames, profilesConfig);
    installForProfile(targetDir, rootResolved, `monorepo root [${rootProfileNames.join(', ')}]`, opts);

    const workspaces = findWorkspaces(targetDir);
    for (const ws of workspaces) {
      const wsProfiles = detectProfiles(ws.path);
      if (opts.logProfiles) {
        console.log(`\n  Workspace "${ws.name}" profiles: ${wsProfiles.join(', ')}`);
      }
      const wsResolved = resolveProfile(wsProfiles, profilesConfig);
      installForProfile(ws.path, wsResolved, `workspace: ${ws.name} [${wsProfiles.join(', ')}]`, opts);

      if (opts.copyWorkspaceDocs && rootResolved.templates.includes('specs')) {
        const wsDocs = path.join(ws.path, 'docs');
        if (!fs.existsSync(wsDocs)) {
          copyDirSyncNoOverwrite(path.join(TEMPLATES_DIR, 'docs'), wsDocs);
          console.log(`  ✓ Created ${ws.name}/docs/ folder`);
        }
      }
    }

    return { detectedProfiles, isMonorepo, rootProfileNames };
  }

  const resolved = resolveProfile(detectedProfiles, profilesConfig);
  installForProfile(targetDir, resolved, detectedProfiles.join(', '), opts);
  return { detectedProfiles, isMonorepo };
}

/**
 * Given a destination file inside a target's .claude/skills or .claude/agents,
 * return the calsuite-relative path to the same file (skills/<name>/...
 * or agents/<name>.md). Returns null if the path isn't under a recognized
 * managed dir.
 */
function destToCalsuiteRel(destPath) {
  const marker = path.sep + '.claude' + path.sep;
  const idx = destPath.indexOf(marker);
  if (idx === -1) return null;
  const afterClaude = destPath.slice(idx + marker.length);
  const first = afterClaude.split(path.sep)[0];
  if (first === 'skills' || first === 'agents') {
    // Normalize to forward-slashes so the path matches calsuite's git-tracked layout on Windows too.
    return afterClaude.split(path.sep).join('/');
  }
  return null;
}

function deriveTargetName(destPath) {
  const marker = path.sep + '.claude' + path.sep;
  const idx = destPath.indexOf(marker);
  if (idx === -1) return 'local';
  const targetDir = destPath.slice(0, idx);
  return path.basename(targetDir);
}

function promptYesNo(question) {
  // Sync stdin read — no readline dep. Returns true iff the user typed y/yes.
  // Non-TTY stdin (scripts, CI) returns false unless `--yes` already bypassed this.
  if (!process.stdin.isTTY) return false;
  process.stdout.write(`${question} [y/N] `);
  const buf = Buffer.alloc(16);
  let bytesRead = 0;
  try {
    bytesRead = fs.readSync(0, buf, 0, 16, null);
  } catch {
    return false;
  }
  const answer = buf.slice(0, bytesRead).toString('utf8').trim().toLowerCase();
  return answer === 'y' || answer === 'yes';
}

function handleForceAdopt(targetPath, { assumeYes = false } = {}) {
  const destPath = path.resolve(targetPath);
  const calsuiteRel = destToCalsuiteRel(destPath);
  if (!calsuiteRel) {
    console.error(`  ✗ ${destPath} is not under a target's .claude/skills or .claude/agents`);
    process.exit(1);
  }
  const calsuiteDir = resolveCalsuiteDir();
  const srcFile = path.join(calsuiteDir, calsuiteRel);
  if (!fs.existsSync(srcFile)) {
    console.error(`  ✗ Calsuite has no matching source file: ${srcFile}`);
    process.exit(1);
  }

  if (!assumeYes) {
    const destExists = fs.existsSync(destPath);
    const warning = destExists
      ? `Overwrite ${destPath} with calsuite's current version? Any local edits will be lost.`
      : `Write calsuite's current content to ${destPath}?`;
    if (!promptYesNo(warning)) {
      console.log('  ⊘ Aborted. Re-run with --yes to skip the prompt.');
      process.exit(1);
    }
  }

  const currentSha = originProtocol.currentCalsuiteSha(calsuiteDir);
  const content = fs.readFileSync(srcFile, 'utf8');
  const stamped = originProtocol.stampOrigin(content, `calsuite@${currentSha}`);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, stamped);
  console.log(`  ✓ Force-adopted ${destPath} ← calsuite@${currentSha}`);
}

function handleClaim(targetPath) {
  const destPath = path.resolve(targetPath);
  if (!fs.existsSync(destPath)) {
    console.error(`  ✗ ${destPath} does not exist`);
    process.exit(1);
  }
  // Guard: stampOrigin unconditionally prepends YAML frontmatter, which would
  // corrupt JSON/non-markdown files. Match the scope handleForceAdopt enforces
  // and the scope the --claim docblock advertises: skill/agent markdown only.
  const calsuiteRel = destToCalsuiteRel(destPath);
  if (!calsuiteRel || !destPath.endsWith('.md')) {
    console.error(`  ✗ --claim only supports markdown files under a target's .claude/skills or .claude/agents`);
    console.error(`    got: ${destPath}`);
    process.exit(1);
  }
  const targetName = deriveTargetName(destPath);
  const content = fs.readFileSync(destPath, 'utf8');
  const stamped = originProtocol.stampOrigin(content, targetName);
  fs.writeFileSync(destPath, stamped);
  console.log(`  ✓ Claimed ${destPath} → _origin: ${targetName}`);
  console.log(`    Subsequent --sync will leave this file alone.`);
}

function handleReconcile(targetPath) {
  const destPath = path.resolve(targetPath);
  if (!fs.existsSync(destPath)) {
    console.error(`  ✗ ${destPath} does not exist`);
    process.exit(1);
  }
  const calsuiteRel = destToCalsuiteRel(destPath);
  if (!calsuiteRel) {
    console.error(`  ✗ --reconcile only supports files under a target's .claude/skills or .claude/agents`);
    console.error(`    got: ${destPath}`);
    process.exit(1);
  }
  if (!destPath.endsWith('.md')) {
    console.error(`  ✗ --reconcile only supports markdown files (got ${destPath})`);
    process.exit(1);
  }
  const calsuiteDir = resolveCalsuiteDir();
  const srcFile = path.join(calsuiteDir, calsuiteRel);
  if (!fs.existsSync(srcFile)) {
    console.error(`  ✗ Calsuite has no matching source file: ${srcFile}`);
    process.exit(1);
  }

  const destContent = fs.readFileSync(destPath, 'utf8');
  const origin = originProtocol.readOrigin(destContent);

  // Claimed-elsewhere short-circuit: nothing to reconcile against calsuite.
  if (origin && !origin.startsWith('calsuite@')) {
    console.log(`  ⊘ File is claimed (_origin: ${origin}). Use --force-adopt to overwrite, or leave it.`);
    return;
  }

  const calsuiteCurrent = fs.readFileSync(srcFile, 'utf8');
  const currentSha = originProtocol.currentCalsuiteSha(calsuiteDir);

  let installSha = null;
  let ancestorContent = null;
  if (origin && origin.startsWith('calsuite@')) {
    installSha = origin.slice('calsuite@'.length);
    ancestorContent = originProtocol.contentAtSha(calsuiteRel, installSha, calsuiteDir);
  }

  // Three-pane diff view
  const hr = '─'.repeat(60);
  console.log('');
  console.log(hr);
  console.log(`=== calsuite current (as of ${currentSha}) ===`);
  console.log(hr);
  console.log(calsuiteCurrent);
  console.log('');
  console.log(hr);
  if (installSha && ancestorContent !== null) {
    console.log(`=== calsuite at install sha (${installSha}) ===`);
    console.log(hr);
    console.log(ancestorContent);
  } else if (installSha && ancestorContent === null) {
    console.log(`=== calsuite at install sha (${installSha}) ===`);
    console.log(hr);
    console.log(`<unavailable: sha ${installSha} has no record of ${calsuiteRel}>`);
  } else {
    console.log(`=== calsuite at install sha (<unavailable: file has no _origin marker>) ===`);
    console.log(hr);
    console.log(`<unavailable: file has no _origin marker>`);
  }
  console.log('');
  console.log(hr);
  console.log(`=== target current (${destPath}) ===`);
  console.log(hr);
  console.log(destContent);
  console.log('');

  if (!process.stdin.isTTY) {
    console.error(`  ✗ --reconcile requires an interactive TTY`);
    process.exit(1);
  }

  console.log('Resolution options:');
  console.log(`  [k] Keep target's version (stamp _origin: ${deriveTargetName(destPath)})`);
  console.log(`  [a] Adopt calsuite's current version (overwrite)`);
  console.log(`  [m] Three-way merge in $EDITOR`);
  console.log(`  [s] Skip (leave file flagged)`);
  process.stdout.write('Choice [k/a/m/s]: ');

  const buf = Buffer.alloc(16);
  let bytesRead = 0;
  try {
    bytesRead = fs.readSync(0, buf, 0, 16, null);
  } catch {
    console.error(`  ✗ Unable to read choice from stdin`);
    process.exit(1);
  }
  const choice = buf.slice(0, bytesRead).toString('utf8').trim().toLowerCase();

  if (choice === 'k' || choice === 'keep') {
    const targetName = deriveTargetName(destPath);
    const stamped = originProtocol.stampOrigin(destContent, targetName);
    fs.writeFileSync(destPath, stamped);
    console.log(`  ✓ Kept target's version. Stamped ${destPath} → _origin: ${targetName}`);
    console.log(`    Subsequent --sync will leave this file alone.`);
    return;
  }

  if (choice === 'a' || choice === 'adopt') {
    const stamped = originProtocol.stampOrigin(calsuiteCurrent, `calsuite@${currentSha}`);
    fs.writeFileSync(destPath, stamped);
    console.log(`  ✓ Adopted calsuite's current version. ${destPath} ← calsuite@${currentSha}`);
    return;
  }

  if (choice === 's' || choice === 'skip') {
    console.log(`  ⊘ Skipped. File remains flagged. Re-run --reconcile to resolve later.`);
    return;
  }

  if (choice !== 'm' && choice !== 'merge') {
    console.error(`  ✗ Unrecognized choice: ${choice || '<empty>'}. Expected one of k/a/m/s.`);
    process.exit(1);
  }

  // [m] three-way merge in $EDITOR.
  const destBody = originProtocol.parseFrontmatter(destContent).body;
  const calsuiteBody = originProtocol.parseFrontmatter(calsuiteCurrent).body;
  const ancestorBody =
    ancestorContent !== null
      ? originProtocol.parseFrontmatter(ancestorContent).body
      : null;

  const ancestorLabel = installSha || 'unknown';
  const middleBlock =
    ancestorBody !== null
      ? ancestorBody
      : '<no ancestor — file had no _origin marker>\n';

  const conflictMarked =
    `<<<<<<< target (${destPath})\n` +
    `${destBody}${destBody.endsWith('\n') ? '' : '\n'}` +
    `||||||| calsuite at install sha (${ancestorLabel})\n` +
    `${middleBlock}${middleBlock.endsWith('\n') ? '' : '\n'}` +
    `=======\n` +
    `${calsuiteBody}${calsuiteBody.endsWith('\n') ? '' : '\n'}` +
    `>>>>>>> calsuite current (${currentSha})\n`;

  const tmpDir = require('os').tmpdir();
  const tmpFile = path.join(
    tmpDir,
    `calsuite-reconcile-${Date.now()}-${process.pid}-${path.basename(destPath)}`
  );
  fs.writeFileSync(tmpFile, conflictMarked);

  const editor = process.env.EDITOR || process.env.VISUAL || 'vi';
  console.log(`  → Opening ${editor} on ${tmpFile}`);
  console.log(`    Resolve all conflict markers, then save & quit.`);
  const { spawnSync } = require('child_process');
  const result = spawnSync(editor, [tmpFile], { stdio: 'inherit' });

  if (result.status !== 0) {
    console.error(`  ✗ Editor exited with status ${result.status}. ${destPath} left untouched.`);
    console.error(`    Conflict-marked file preserved at ${tmpFile}`);
    process.exit(1);
  }

  const resolved = fs.readFileSync(tmpFile, 'utf8');
  // Check for any remaining conflict markers at line start.
  const markerRe = /^(?:<{7}|\|{7}|={7}|>{7})(?:\s|$)/m;
  if (markerRe.test(resolved)) {
    console.error(`  ✗ Conflict markers still present in ${tmpFile}. ${destPath} left untouched.`);
    console.error(`    Edit and resolve, then re-run --reconcile.`);
    process.exit(1);
  }

  // Strip any leading frontmatter the user may have left in the resolved body —
  // stampOrigin will prepend a fresh one. This prevents a double-frontmatter block.
  const resolvedParsed = originProtocol.parseFrontmatter(resolved);
  const bodyForStamp = resolvedParsed.hasFrontmatter ? resolvedParsed.body : resolved;
  const stamped = originProtocol.stampOrigin(bodyForStamp, `calsuite@${currentSha}`);
  fs.writeFileSync(destPath, stamped);
  try {
    fs.unlinkSync(tmpFile);
  } catch {
    /* non-fatal */
  }
  console.log(`  ✓ Merged. ${destPath} ← calsuite@${currentSha} (user-resolved)`);
}

function parseArgv() {
  const args = process.argv.slice(2);
  const flags = {};
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--only') {
      const next = args[i + 1];
      if (!next || next.startsWith('--')) {
        console.error('  ✗ --only requires a comma-separated list of skills');
        process.exit(1);
      }
      flags.only = args[++i].split(',').map(s => s.trim()).filter(Boolean);
    } else if (args[i] === '--agents') {
      const next = args[i + 1];
      if (!next || next.startsWith('--')) {
        console.error('  ✗ --agents requires a comma-separated list of agents');
        process.exit(1);
      }
      flags.agents = args[++i].split(',').map(s => s.trim()).filter(Boolean);
    } else if (args[i] === '--install-ccstatusline') {
      flags.installCcstatusline = true;
    } else if (args[i] === '--sync') {
      flags.sync = true;
    } else if (args[i] === '--yes' || args[i] === '-y') {
      flags.yes = true;
    } else if (args[i] === '--force-adopt') {
      const next = args[i + 1];
      if (!next || next.startsWith('--')) {
        console.error('  ✗ --force-adopt requires a path argument');
        process.exit(1);
      }
      flags.forceAdopt = next;
      i++;
    } else if (args[i] === '--claim') {
      const next = args[i + 1];
      if (!next || next.startsWith('--')) {
        console.error('  ✗ --claim requires a path argument');
        process.exit(1);
      }
      flags.claim = next;
      i++;
    } else if (args[i] === '--reconcile') {
      const next = args[i + 1];
      if (!next || next.startsWith('--')) {
        console.error('  ✗ --reconcile requires a path argument');
        process.exit(1);
      }
      flags.reconcile = next;
      i++;
    } else if (args[i].startsWith('--')) {
      console.error(`  ✗ Unknown flag: ${args[i]}`);
      process.exit(1);
    } else {
      positional.push(args[i]);
    }
  }

  if (flags.agents && !flags.only) {
    console.error('  ✗ --agents can only be used with --only');
    process.exit(1);
  }

  return { flags, positional };
}

function main() {
  const { flags, positional } = parseArgv();

  // Handle --force-adopt and --claim early — they touch a single file
  // and shouldn't trigger a full install.
  if (flags.forceAdopt) {
    handleForceAdopt(flags.forceAdopt, { assumeYes: flags.yes });
    return;
  }
  if (flags.claim) {
    handleClaim(flags.claim);
    return;
  }
  if (flags.reconcile) {
    handleReconcile(flags.reconcile);
    return;
  }

  // Handle --install-ccstatusline flag
  if (flags.installCcstatusline) {
    const manifest = readJsonSync(GLOBAL_MANIFEST);
    if (!manifest?.ccstatusline) {
      console.error('  ✗ No ccstatusline config found in manifest');
      process.exit(1);
    }
    installCcstatuslineConfig(manifest);
    return;
  }

  // Handle --sync mode: re-run install against all targets in config/targets.json
  if (flags.sync) {
    const targets = readJsonSync(TARGETS_JSON);
    if (!targets?.targets?.length) {
      console.error('  ✗ No targets found in config/targets.json');
      process.exit(1);
    }

    console.log(`\nSyncing to ${targets.targets.length} target(s)...\n`);

    const profilesConfig = readJsonSync(PROFILES_JSON);
    if (!profilesConfig) {
      console.error('  ✗ Could not read profiles.json');
      process.exit(1);
    }

    const divergences = [];
    for (const target of targets.targets) {
      const targetPath = path.resolve(target.path.replace(/^~/, HOME_DIR));
      if (!fs.existsSync(targetPath)) {
        console.log(`  ⚠ Skipping ${target.path} (not found)`);
        continue;
      }
      installTarget(targetPath, profilesConfig, { divergences });
    }

    console.log('\nSync complete!\n');
    printDivergenceSummary(divergences);
    return;
  }

  const targetDir = path.resolve(positional[0] || process.cwd());

  // Handle --only mode: install specific skills/agents without touching hooks/settings
  if (flags.only) {
    console.log(`\nInstalling specific items to: ${targetDir}\n`);
    const missing = installOnly(targetDir, flags.only, flags.agents || []);
    if (missing.length > 0) {
      const unique = [...new Set(missing)];
      console.error(`\n  ✗ Missing items: ${unique.join(', ')}`);
      process.exit(1);
    }
    console.log('\nDone!\n');
    return;
  }

  const profilesConfig = readJsonSync(PROFILES_JSON);

  if (!profilesConfig) {
    console.error('  ✗ Could not read profiles.json');
    process.exit(1);
  }

  console.log(`\nConfiguring Claude Code for: ${targetDir}\n`);
  const divergences = [];

  const { isMonorepo } = installTarget(targetDir, profilesConfig, {
    logProfiles: true,
    copyWorkspaceDocs: true,
    divergences,
  });

  // Global settings check
  const manifest = readJsonSync(GLOBAL_MANIFEST);
  console.log('\n--- Global settings check ---\n');
  if (!manifest) {
    console.log('  ⚠ Could not read global manifest, skipping global check');
  } else {
    const settingsPaths = [path.join(targetDir, '.claude', 'settings.json')];
    if (isMonorepo) {
      const workspaces = findWorkspaces(targetDir);
      for (const ws of workspaces) {
        settingsPaths.push(path.join(ws.path, '.claude', 'settings.json'));
      }
    }
    checkGlobalSettings(manifest, settingsPaths);
  }

  console.log('\nDone!\n');
  printDivergenceSummary(divergences);
}

function checkGlobalSettings(manifest, projectSettingsPaths) {
  const globalSettings = readJsonSync(HOME_SETTINGS);
  const globalLocal = readJsonSync(HOME_SETTINGS_LOCAL);
  const allProjectSettings = (Array.isArray(projectSettingsPaths) ? projectSettingsPaths : [projectSettingsPaths])
    .map(p => readJsonSync(p))
    .filter(Boolean);
  let allGood = true;

  // Check marketplaces (prerequisite for plugins)
  if (manifest.marketplaces) {
    const knownMarketplaces = readJsonSync(KNOWN_MARKETPLACES) || {};
    const knownNames = Object.keys(knownMarketplaces);
    for (const marketplace of manifest.marketplaces) {
      if (knownNames.includes(marketplace.name)) {
        console.log(`  ✓ Marketplace: ${marketplace.name}`);
      } else {
        console.log(`  ✗ Marketplace missing: ${marketplace.name}`);
        console.log(`    → Install via: /plugin marketplace add ${marketplace.repo}`);
        allGood = false;
      }
    }
  }

  // Check plugins (global or project-scoped, including workspace settings)
  if (manifest.plugins) {
    const globalPlugins = globalSettings?.enabledPlugins;
    if (!globalPlugins && allProjectSettings.length === 0) {
      console.log(`  ⚠ No enabledPlugins found in global or project settings — skipping plugin check`);
    } else {
      for (const plugin of manifest.plugins) {
        if (globalPlugins?.[plugin]) {
          console.log(`  ✓ Plugin: ${plugin} (global)`);
        } else {
          const foundIn = allProjectSettings.find(s => s.enabledPlugins?.[plugin]);
          if (foundIn) {
            console.log(`  ✓ Plugin: ${plugin} (project)`);
          } else {
            console.log(`  ✗ Plugin missing: ${plugin}`);
            console.log(`    → Enable via Claude Code settings or add to ~/.claude/settings.json`);
            allGood = false;
          }
        }
      }
    }
  }

  // Install and check MCP servers
  if (manifest.mcpServers && typeof manifest.mcpServers === 'object') {
    const mcpJson = readJsonSync(HOME_MCP_JSON) || {};
    const mcpServers = mcpJson.mcpServers || {};
    let mcpChanged = false;

    for (const [name, config] of Object.entries(manifest.mcpServers)) {
      if (mcpServers[name]) {
        console.log(`  ✓ MCP server: ${name} (already in ~/.mcp.json)`);
      } else {
        // Strip metadata keys (prefixed with _) before writing
        const cleanConfig = Object.fromEntries(
          Object.entries(config).filter(([k]) => !k.startsWith('_'))
        );
        mcpServers[name] = cleanConfig;
        mcpChanged = true;
        console.log(`  ✓ MCP server: ${name} (added to ~/.mcp.json)`);
      }
    }

    if (mcpChanged) {
      mcpJson.mcpServers = mcpServers;
      fs.mkdirSync(path.dirname(HOME_MCP_JSON), { recursive: true });
      fs.writeFileSync(HOME_MCP_JSON, JSON.stringify(mcpJson, null, 2) + '\n');
    }

    // Ensure servers are enabled in settings.local.json
    const localSettings = readJsonSync(HOME_SETTINGS_LOCAL) || {};
    const enabledServers = localSettings.enabledMcpjsonServers || [];
    let localChanged = false;

    for (const name of Object.keys(manifest.mcpServers)) {
      if (!enabledServers.includes(name)) {
        enabledServers.push(name);
        localChanged = true;
        console.log(`  ✓ MCP server: ${name} (enabled in settings.local.json)`);
      }
    }

    if (localChanged) {
      localSettings.enabledMcpjsonServers = enabledServers;
      fs.mkdirSync(path.dirname(HOME_SETTINGS_LOCAL), { recursive: true });
      fs.writeFileSync(HOME_SETTINGS_LOCAL, JSON.stringify(localSettings, null, 2) + '\n');
    }
  }

  // Check statusLine
  if (manifest.statusLine) {
    const currentStatus = globalSettings?.statusLine;
    if (currentStatus && currentStatus.command === manifest.statusLine.command) {
      console.log(`  ✓ StatusLine: ${manifest.statusLine.command}`);
    } else {
      console.log(`  ✗ StatusLine not configured: ${manifest.statusLine.command}`);
      console.log(`    → Add statusLine config to ~/.claude/settings.json`);
      allGood = false;
    }
  }

  // Check ccstatusline config
  if (manifest.ccstatusline) {
    const ccstatuslinePath = path.join(require('os').homedir(), '.config', 'ccstatusline', 'settings.json');
    const currentConfig = readJsonSync(ccstatuslinePath);
    if (!currentConfig) {
      console.log(`  ✗ ccstatusline config missing: ${ccstatuslinePath}`);
      console.log(`    → Run with --install-ccstatusline to install`);
      allGood = false;
    } else if (currentConfig.version !== manifest.ccstatusline.version) {
      console.log(`  ✗ ccstatusline config version mismatch: v${currentConfig.version} (expected v${manifest.ccstatusline.version})`);
      console.log(`    → Run with --install-ccstatusline to update`);
      allGood = false;
    } else {
      console.log(`  ✓ ccstatusline config (v${currentConfig.version})`);
    }
  }

  if (allGood) {
    console.log('\n  All global settings match the manifest.');
  }
}

try {
  main();
} catch (err) {
  // Errors thrown by origin-protocol utilities carry user-facing messages
  // already. Print cleanly, exit non-zero, skip the noisy Node stack trace.
  console.error(`\n  ✗ ${err.message}`);
  process.exit(1);
}
