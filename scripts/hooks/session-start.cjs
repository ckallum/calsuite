#!/usr/bin/env node
/**
 * SessionStart Hook - Load previous context on new session
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Runs when a new Claude session starts. Checks for recent session
 * files and notifies Claude of available context to load.
 */

const path = require('path');
const {
  getSessionsDir,
  getLearnedSkillsDir,
  findFiles,
  findSpecsDir,
  readFile,
  ensureDir,
  log
} = require(path.join(__dirname, '..', 'lib', 'utils.cjs'));
const { getPackageManager, getSelectionPrompt } = require(path.join(__dirname, '..', 'lib', 'package-manager.cjs'));
const { listAliases } = require(path.join(__dirname, '..', 'lib', 'session-aliases.cjs'));

async function main() {
  const sessionsDir = getSessionsDir();
  const learnedDir = getLearnedSkillsDir();

  // Ensure directories exist
  ensureDir(sessionsDir);
  ensureDir(learnedDir);

  // Check for recent session files (last 7 days)
  // Match both old format (YYYY-MM-DD-session.tmp) and new format (YYYY-MM-DD-shortid-session.tmp)
  const recentSessions = findFiles(sessionsDir, '*-session.tmp', { maxAge: 7 });

  if (recentSessions.length > 0) {
    const latest = recentSessions[0];
    log(`[SessionStart] Found ${recentSessions.length} recent session(s)`);
    log(`[SessionStart] Latest: ${latest.path}`);
  }

  // Check for learned skills
  const learnedSkills = findFiles(learnedDir, '*.md');

  if (learnedSkills.length > 0) {
    log(`[SessionStart] ${learnedSkills.length} learned skill(s) available in ${learnedDir}`);
  }

  // Check for available session aliases
  const aliases = listAliases({ limit: 5 });

  if (aliases.length > 0) {
    const aliasNames = aliases.map(a => a.name).join(', ');
    log(`[SessionStart] ${aliases.length} session alias(es) available: ${aliasNames}`);
    log(`[SessionStart] Use /sessions load <alias> to continue a previous session`);
  }

  // Detect and report package manager
  const pm = getPackageManager();
  log(`[SessionStart] Package manager: ${pm.name} (${pm.source})`);

  // If package manager was detected via fallback, show selection prompt
  if (pm.source === 'fallback' || pm.source === 'default') {
    log('[SessionStart] No package manager preference found.');
    log(getSelectionPrompt());
  }

  // Spec-driven development awareness
  const specResult = findSpecsDir(process.cwd());
  if (specResult) {
    const { specsDir, projectRoot } = specResult;

    // Read SPECLOG.md for in-progress specs
    const speclogPath = require('path').join(projectRoot, 'SPECLOG.md');
    const speclog = readFile(speclogPath);
    if (speclog) {
      const inProgress = speclog.split('\n').filter(line => /in.?progress/i.test(line));
      if (inProgress.length > 0) {
        log(`[SessionStart] SPECLOG: ${inProgress.length} spec(s) in progress`);
      }
    }

    // Find tasks.md files with incomplete tasks
    const specEntries = findFiles(specsDir, 'tasks.md', { recursive: true });
    for (const entry of specEntries) {
      const content = readFile(entry.path);
      if (content) {
        const incomplete = content.split('\n').filter(line => /^- \[ \]/.test(line.trim()));
        if (incomplete.length > 0) {
          const specName = require('path').basename(require('path').dirname(entry.path));
          log(`[SessionStart] Spec "${specName}": ${incomplete.length} task(s) remaining`);
        }
      }
    }

    // Read last changelog entry
    const changelogPath = require('path').join(projectRoot, 'CHANGELOG.md');
    const changelog = readFile(changelogPath);
    if (changelog) {
      const unreleased = changelog.match(/## \[Unreleased\]([\s\S]*?)(?=\n## |\n*$)/);
      if (unreleased) {
        const items = unreleased[1].split('\n').filter(line => /^- /.test(line.trim()));
        if (items.length > 0) {
          log(`[SessionStart] CHANGELOG: ${items.length} unreleased item(s)`);
        }
      }
    }

    log('[SessionStart] Run @context-loader for full project briefing and task prioritization');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('[SessionStart] Error:', err.message);
  process.exit(0); // Don't block on errors
});
