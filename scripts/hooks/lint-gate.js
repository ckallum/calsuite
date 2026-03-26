#!/usr/bin/env node

/**
 * Lint Gate — PreToolUse hook that runs structural lint rules before commits.
 * Checks agent-rules.json patterns against staged files.
 * Fail-open: if anything goes wrong, exits 0 (allows).
 *
 * Unlike review-gate (which checks for code review), this checks that
 * lint rules pass — giving agents machine-readable feedback to self-correct.
 */

const path = require('path');
const fs = require('fs');
const { readStdinJson, runCommand, readFile, log } = require(path.join(__dirname, '..', 'lib', 'utils'));

function loadAgentRules() {
  // Check project-local config first, then co-located config/
  const projectConfig = path.join(process.cwd(), '.claude', 'config', 'agent-rules.json');
  const repoConfig = path.resolve(__dirname, '..', '..', 'config', 'lint-configs', 'agent-rules.json');

  const content = readFile(projectConfig) || readFile(repoConfig);
  if (!content) return null;

  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function matchesGlob(filePath, pattern) {
  // Simple glob matching: ** = any path, * = any file segment
  const regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '§§')
    .replace(/\*/g, '[^/]*')
    .replace(/§§/g, '.*');
  return new RegExp(`^${regex}$`).test(filePath);
}

function matchesAnyGlob(filePath, patterns) {
  return patterns.some(p => matchesGlob(filePath, p));
}

function checkPatternRule(rule, filePath, fileContent) {
  if (!rule.pattern) return null;

  try {
    const regex = new RegExp(rule.pattern, 'gm');
    const matches = [];
    const lines = fileContent.split('\n');

    for (let i = 0; i < lines.length; i++) {
      regex.lastIndex = 0;
      if (regex.test(lines[i])) {
        matches.push({ line: i + 1, content: lines[i].trim() });
      }
    }

    if (matches.length > 0) {
      return { rule, filePath, matches };
    }
  } catch {
    // bad regex
  }

  return null;
}

function checkColocatedTest(rule, filePath) {
  const ext = path.extname(filePath);
  const base = filePath.slice(0, -ext.length);
  const testFile = `${base}.test${ext}`;
  const specFile = `${base}.spec${ext}`;

  if (!fs.existsSync(testFile) && !fs.existsSync(specFile)) {
    return { rule, filePath, matches: [{ line: 0, content: `Missing colocated test file` }] };
  }
  return null;
}

async function main() {
  const input = await readStdinJson();

  // Only intercept git commit commands
  const command = input.tool_input?.command || '';
  if (!/git\s+commit(\s|$)/.test(command)) {
    process.exit(0);
  }

  // Check for skip flag
  const msgMatch = command.match(/(?:-m\s+|--message(?:=|\s+))(?:"([^"]*(?:\\.[^"]*)*)"|'([^']*)'|(\S+))/);
  const heredocMatch = command.match(/<<\s*'?EOF'?\s*\n([\s\S]*?)\nEOF/);
  const commitMsg = msgMatch ? (msgMatch[1] || msgMatch[2] || msgMatch[3] || '') : (heredocMatch ? heredocMatch[1] : '');

  if (/\[skip-lint\]/i.test(commitMsg)) {
    process.exit(0);
  }

  const config = loadAgentRules();
  if (!config || !config.rules) process.exit(0);

  // Get staged files
  const stagedResult = runCommand('git diff --cached --name-only');
  if (!stagedResult.success || !stagedResult.output.trim()) {
    process.exit(0);
  }

  const stagedFiles = stagedResult.output.trim().split('\n');
  const violations = [];

  for (const filePath of stagedFiles) {
    const fullPath = path.resolve(filePath);
    if (!fs.existsSync(fullPath)) continue;

    for (const rule of config.rules) {
      // Check file pattern match
      if (rule.files && !matchesAnyGlob(filePath, Array.isArray(rule.files) ? rule.files : [rule.files])) {
        continue;
      }

      // Check exclusions
      if (rule.exclude && rule.exclude.length > 0 && matchesAnyGlob(filePath, rule.exclude)) {
        continue;
      }

      // Special checks
      if (rule.check === 'colocated-test') {
        const v = checkColocatedTest(rule, fullPath);
        if (v) violations.push(v);
        continue;
      }

      // Pattern-based checks
      if (rule.pattern) {
        const content = readFile(fullPath);
        if (content) {
          const v = checkPatternRule(rule, filePath, content);
          if (v) violations.push(v);
        }
      }
    }
  }

  // Filter to errors and warnings only (skip info for gate blocking)
  const blocking = violations.filter(v => v.rule.severity === 'error');
  const warnings = violations.filter(v => v.rule.severity === 'warn');
  const infos = violations.filter(v => v.rule.severity === 'info');

  // Report all violations to stderr
  if (violations.length > 0) {
    log('');
    log('[Lint Gate] Structural lint check results:');

    for (const v of [...blocking, ...warnings, ...infos]) {
      const icon = v.rule.severity === 'error' ? '✗' : v.rule.severity === 'warn' ? '⚠' : 'ℹ';
      log(`  ${icon} ${v.rule.id}: ${v.filePath}`);
      for (const m of v.matches.slice(0, 3)) {
        if (m.line > 0) {
          log(`    L${m.line}: ${m.content}`);
        } else {
          log(`    ${m.content}`);
        }
      }
      if (v.matches.length > 3) {
        log(`    ... and ${v.matches.length - 3} more`);
      }
      log(`    → ${v.rule.message}`);
    }
    log('');
  }

  // Only block on errors
  if (blocking.length > 0) {
    log(`[Lint Gate] BLOCKED: ${blocking.length} error(s) must be fixed before commit.`);
    log('[Lint Gate] Add [skip-lint] to commit message to bypass.');
    log('');
    process.exit(1);
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
