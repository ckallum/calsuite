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
 *   --copy                       Copy scripts instead of symlinking (for portability)
 */

const fs = require('fs');
const path = require('path');

const CONFIG_REPO = path.resolve(__dirname, '..');
const HOOKS_JSON = path.join(CONFIG_REPO, 'hooks', 'hooks.json');
const GLOBAL_MANIFEST = path.join(CONFIG_REPO, 'config', 'global-settings.json');
const PROFILES_JSON = path.join(CONFIG_REPO, 'config', 'profiles.json');
const SCRIPTS_HOOKS = path.join(CONFIG_REPO, 'scripts', 'hooks');
const SCRIPTS_LIB = path.join(CONFIG_REPO, 'scripts', 'lib');
const SKILLS_DIR = path.join(CONFIG_REPO, 'skills');
const AGENTS_DIR = path.join(CONFIG_REPO, 'agents');
const TEMPLATES_DIR = path.join(CONFIG_REPO, 'templates');
const LINT_CONFIGS_DIR = path.join(CONFIG_REPO, 'config', 'lint-configs');
const TARGETS_JSON = path.join(CONFIG_REPO, 'config', 'targets.json');
const PARENT_CLAUDE_DIR = path.join(CONFIG_REPO, '..', '.claude');
const HOME_DIR = require('os').homedir();
const HOME_SETTINGS = path.join(HOME_DIR, '.claude', 'settings.json');
const HOME_SETTINGS_LOCAL = path.join(HOME_DIR, '.claude', 'settings.local.json');
const HOME_MCP_JSON = path.join(HOME_DIR, '.mcp.json');
const KNOWN_MARKETPLACES = path.join(HOME_DIR, '.claude', 'plugins', 'known_marketplaces.json');
// Skills that only make sense in the config repo itself — never export to target repos
const INTERNAL_SKILLS = new Set(['configure-claude', 'skill-builder']);

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

function symlinkDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      symlinkDirSync(srcPath, destPath);
    } else {
      symlinkOrSkip(srcPath, destPath);
    }
  }
}

/**
 * Create or refresh a symlink. Replaces existing symlinks, skips real files/dirs.
 * Returns true if the symlink was created, false if skipped.
 */
function symlinkOrSkip(srcPath, destPath) {
  if (fs.existsSync(destPath)) {
    const stat = fs.lstatSync(destPath);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(destPath);
    } else {
      return false; // Real file/directory — project-specific, skip
    }
  }
  fs.symlinkSync(path.resolve(srcPath), destPath);
  return true;
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

function readJsonSync(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function resolveHookPaths(obj, claudeConfigDir) {
  const json = JSON.stringify(obj);
  const safeDir = claudeConfigDir.replace(/\\/g, '\\\\');
  return JSON.parse(json.replace(/\$\{CLAUDE_CONFIG_DIR\}/g, () => safeDir));
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
  const useCopy = opts.copy || false;
  const claudeDir = path.join(targetDir, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');

  console.log(`\n--- Installing: ${label} (${targetDir}) ---\n`);

  // 1. Create .claude/ directory
  fs.mkdirSync(claudeDir, { recursive: true });
  console.log(`  ✓ Ensured ${claudeDir} exists`);

  // 2. Symlink (or copy) scripts/hooks/ and scripts/lib/
  const destHooks = path.join(claudeDir, 'scripts', 'hooks');
  const destLib = path.join(claudeDir, 'scripts', 'lib');

  if (useCopy) {
    copyDirSync(SCRIPTS_HOOKS, destHooks);
    console.log(`  ✓ Copied hook scripts → ${destHooks}`);
    copyDirSync(SCRIPTS_LIB, destLib);
    console.log(`  ✓ Copied lib scripts  → ${destLib}`);
  } else {
    symlinkDirSync(SCRIPTS_HOOKS, destHooks);
    console.log(`  ✓ Symlinked hook scripts → ${destHooks}`);
    symlinkDirSync(SCRIPTS_LIB, destLib);
    console.log(`  ✓ Symlinked lib scripts  → ${destLib}`);
  }

  // 2b. Copy guardian rules config
  const guardianSrc = path.join(CONFIG_REPO, 'config', 'guardian-rules.json');
  const guardianDest = path.join(claudeDir, 'config', 'guardian-rules.json');
  if (fs.existsSync(guardianSrc)) {
    fs.mkdirSync(path.join(claudeDir, 'config'), { recursive: true });
    fs.copyFileSync(guardianSrc, guardianDest);
    console.log(`  ✓ Copied guardian rules → ${guardianDest}`);
  }

  // 2c. Copy agent lint rules config
  const agentRulesSrc = path.join(LINT_CONFIGS_DIR, 'agent-rules.json');
  const agentRulesDest = path.join(claudeDir, 'config', 'agent-rules.json');
  if (fs.existsSync(agentRulesSrc)) {
    fs.mkdirSync(path.join(claudeDir, 'config'), { recursive: true });
    fs.copyFileSync(agentRulesSrc, agentRulesDest);
    console.log(`  ✓ Copied agent lint rules → ${agentRulesDest}`);
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

  // 3. Copy skills (only those in resolved profile)
  const destSkills = path.join(claudeDir, 'skills');
  let skillCount = 0;
  for (const skillName of resolvedProfile.skills) {
    if (INTERNAL_SKILLS.has(skillName)) continue;
    const srcSkill = path.join(SKILLS_DIR, skillName);
    if (fs.existsSync(srcSkill) && fs.statSync(srcSkill).isDirectory()) {
      copyDirSync(srcSkill, path.join(destSkills, skillName));
      skillCount++;
    }
  }
  console.log(`  ✓ Copied ${skillCount} skill(s) → ${destSkills}`);

  // 4. Copy agents (only those in resolved profile)
  if (resolvedProfile.agents.length > 0) {
    const destAgents = path.join(claudeDir, 'agents');
    fs.mkdirSync(destAgents, { recursive: true });
    let agentCount = 0;
    for (const agentName of resolvedProfile.agents) {
      const srcAgent = path.join(AGENTS_DIR, `${agentName}.md`);
      if (fs.existsSync(srcAgent)) {
        fs.copyFileSync(srcAgent, path.join(destAgents, `${agentName}.md`));
        agentCount++;
      }
    }
    console.log(`  ✓ Copied ${agentCount} agent(s) → ${destAgents}`);
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
  const resolvedHooks = resolveHookPaths(hooksConfig.hooks, claudeDir);

  // 7. Merge hooks and plugins into target settings.json
  //    Uses _origin tags to replace only calsuite-managed hooks, preserving project-specific ones
  const existingSettings = readJsonSync(settingsPath) || {};
  const pluginsToEnable = {};
  for (const plugin of resolvedProfile.plugins) {
    pluginsToEnable[plugin] = true;
  }

  const mergedHooks = mergeHooks(existingSettings.hooks, resolvedHooks);
  const projectHookCount = Object.values(mergedHooks)
    .flat()
    .filter(h => !h._origin || h._origin !== 'calsuite').length;

  const merged = {
    ...existingSettings,
    ...(hooksConfig.$schema ? { $schema: hooksConfig.$schema } : {}),
    hooks: mergedHooks,
    enabledPlugins: { ...existingSettings.enabledPlugins, ...pluginsToEnable },
  };

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
  console.log(`  ✓ Merged hooks into ${settingsPath}${projectHookCount > 0 ? ` (preserved ${projectHookCount} project-specific hook(s))` : ''}`);
  console.log(`  ✓ Enabled ${resolvedProfile.plugins.length} plugin(s) in project settings`);

  // Verify no unresolved placeholders remain
  const written = fs.readFileSync(settingsPath, 'utf8');
  if (written.includes('${CLAUDE_CONFIG_DIR}')) {
    console.error('  ✗ WARNING: Unresolved ${CLAUDE_CONFIG_DIR} found in settings.json');
  } else {
    console.log('  ✓ All hook paths resolved (no ${CLAUDE_CONFIG_DIR} remaining)');
  }
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
function installOnly(targetDir, onlySkills, onlyAgents) {
  const claudeDir = path.join(targetDir, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  const missing = [];

  // Install specified skills
  if (onlySkills.length > 0) {
    const destSkills = path.join(claudeDir, 'skills');
    let count = 0;
    for (const skillName of onlySkills) {
      if (INTERNAL_SKILLS.has(skillName)) {
        console.log(`  ⊘ Skipped internal skill: ${skillName}`);
        continue;
      }
      const srcSkill = path.join(SKILLS_DIR, skillName);
      if (fs.existsSync(srcSkill) && fs.statSync(srcSkill).isDirectory()) {
        copyDirSync(srcSkill, path.join(destSkills, skillName));
        count++;
        console.log(`  ✓ Installed skill: ${skillName}`);
      } else {
        console.log(`  ✗ Skill not found: ${skillName}`);
        missing.push(`skill:${skillName}`);
      }
    }
    console.log(`  → ${count} skill(s) installed to ${destSkills}`);
  }

  // Install specified agents
  if (onlyAgents.length > 0) {
    const destAgents = path.join(claudeDir, 'agents');
    fs.mkdirSync(destAgents, { recursive: true });
    let count = 0;
    for (const agentName of onlyAgents) {
      const srcAgent = path.join(AGENTS_DIR, `${agentName}.md`);
      if (fs.existsSync(srcAgent)) {
        fs.copyFileSync(srcAgent, path.join(destAgents, `${agentName}.md`));
        count++;
        console.log(`  ✓ Installed agent: ${agentName}`);
      } else {
        console.log(`  ✗ Agent not found: ${agentName}`);
        missing.push(`agent:${agentName}`);
      }
    }
    console.log(`  → ${count} agent(s) installed to ${destAgents}`);
  }

  // Also install into workspaces if monorepo
  const detectedProfiles = detectProfiles(targetDir);
  if (detectedProfiles.includes('monorepo')) {
    const workspaces = findWorkspaces(targetDir);
    for (const ws of workspaces) {
      console.log(`\n  Workspace: ${ws.name}`);
      const wsMissing = installOnly(ws.path, onlySkills, onlyAgents);
      missing.push(...wsMissing);
    }
  }

  return missing;
}

function syncParentAssets() {
  if (!fs.existsSync(PARENT_CLAUDE_DIR)) {
    console.log(`  ⚠ Parent .claude dir not found at ${PARENT_CLAUDE_DIR} — skipping shared asset sync`);
    return;
  }

  const parentSkillsDir = path.join(PARENT_CLAUDE_DIR, 'skills');
  const parentAgentsDir = path.join(PARENT_CLAUDE_DIR, 'agents');

  fs.mkdirSync(parentSkillsDir, { recursive: true });
  fs.mkdirSync(parentAgentsDir, { recursive: true });

  // Symlink shared skills
  let skillCount = 0;
  for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || INTERNAL_SKILLS.has(entry.name) || entry.name.startsWith('.')) continue;
    if (symlinkOrSkip(path.join(SKILLS_DIR, entry.name), path.join(parentSkillsDir, entry.name))) {
      skillCount++;
    }
  }
  console.log(`  ✓ Symlinked ${skillCount} shared skill(s) → ${parentSkillsDir}`);

  // Symlink shared agents
  let agentCount = 0;
  for (const entry of fs.readdirSync(AGENTS_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (symlinkOrSkip(path.join(AGENTS_DIR, entry.name), path.join(parentAgentsDir, entry.name))) {
      agentCount++;
    }
  }
  console.log(`  ✓ Symlinked ${agentCount} shared agent(s) → ${parentAgentsDir}`);
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
    } else if (args[i] === '--copy') {
      flags.copy = true;
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

    // Also sync shared skills/agents to parent .claude/
    syncParentAssets();

    for (const target of targets.targets) {
      const targetPath = path.resolve(target.path.replace(/^~/, HOME_DIR));
      if (!fs.existsSync(targetPath)) {
        console.log(`  ⚠ Skipping ${target.path} (not found)`);
        continue;
      }
      installTarget(targetPath, profilesConfig, { copy: flags.copy });
    }

    console.log('\nSync complete!\n');
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

  const { isMonorepo } = installTarget(targetDir, profilesConfig, {
    copy: flags.copy,
    logProfiles: true,
    copyWorkspaceDocs: true,
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

main();
