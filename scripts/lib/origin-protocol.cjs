const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const ORIGIN_LINE_RE = /^_origin:\s*(.+?)\s*$/m;

function parseFrontmatter(content) {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: {}, body: content, hasFrontmatter: false, raw: '' };
  const fm = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return {
    frontmatter: fm,
    body: content.slice(match[0].length),
    hasFrontmatter: true,
    raw: match[0],
    rawBody: match[1],
  };
}

function readOrigin(content) {
  return parseFrontmatter(content).frontmatter._origin || null;
}

/**
 * Stamp `_origin: <value>` into the file. Adds a new frontmatter block if
 * none exists; otherwise replaces or prepends within the existing block.
 */
function stampOrigin(content, originValue) {
  const parsed = parseFrontmatter(content);
  if (!parsed.hasFrontmatter) {
    return `---\n_origin: ${originValue}\n---\n\n${content}`;
  }
  let newBody;
  if (ORIGIN_LINE_RE.test(parsed.rawBody)) {
    // Function replacer — string form would interpret `$1`/`$&` sequences
    // if originValue ever contained them (target basenames in exotic dirs).
    newBody = parsed.rawBody.replace(ORIGIN_LINE_RE, () => `_origin: ${originValue}`);
  } else {
    newBody = `_origin: ${originValue}\n${parsed.rawBody}`;
  }
  return `---\n${newBody}\n---\n${parsed.body.startsWith('\n') ? '' : '\n'}${parsed.body}`;
}

/**
 * Normalize content for byte-equality comparison. Used on both sides of
 * dest-vs-calsuite-content diffs so the comparison only flags *intentional*
 * divergence, not superficial things like:
 * - `_origin:` lines present on one side but not the other
 * - CRLF vs LF line endings
 * - The leading blank line that appears below a frontmatter block that
 *   becomes empty after `_origin` stripping
 * - Trailing whitespace
 *
 * Calsuite source files never carry `_origin`; target files do once stamped.
 */
function normalizeForCompare(content) {
  const parsed = parseFrontmatter(content);
  let body;
  let fm;
  if (parsed.hasFrontmatter) {
    const kept = parsed.rawBody
      .split(/\r?\n/)
      .filter(line => !ORIGIN_LINE_RE.test(line))
      .join('\n')
      .trim();
    fm = kept ? `---\n${kept}\n---\n` : '';
    body = parsed.body;
  } else {
    fm = '';
    body = content;
  }
  return (fm + body)
    .replace(/\r\n/g, '\n')
    .replace(/^\n+/, '')
    .replace(/\s+$/, '');
}

/**
 * Read the content a file had at a given git sha inside calsuite.
 *
 * Returns null ONLY when git reports the path/sha is unknown to the repo
 * (benign: "file didn't exist at that commit"). Any other failure — git not
 * installed, shallow-clone pruning, repo corruption — throws, because the
 * caller's `skip-unknown` path would otherwise silently route every managed
 * file to the divergence queue on every sync.
 */
function contentAtSha(calsuiteRelPath, sha, calsuiteDir) {
  try {
    return execFileSync('git', ['show', `${sha}:${calsuiteRelPath}`], {
      cwd: calsuiteDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    const benignMissing =
      /fatal: invalid object name/i.test(stderr) ||
      /fatal: bad revision/i.test(stderr) ||
      /path .* does not exist in/i.test(stderr) ||
      /exists on disk, but not in/i.test(stderr);
    if (benignMissing) return null;

    throw new Error(
      `git show ${sha}:${calsuiteRelPath} failed unexpectedly in ${calsuiteDir}.\n` +
      `This is not a "path didn't exist at that sha" error — the _origin protocol ` +
      `cannot proceed without historical content comparison.\n` +
      `Git reported: ${stderr.trim() || err.message}`
    );
  }
}

/**
 * Return calsuite's current HEAD sha (7-char). Throws on failure rather
 * than returning a fallback string — stamping every file with
 * `_origin: calsuite@<fallback>` would break future syncs permanently,
 * because `contentAtSha(..., <fallback>, ...)` would return null for
 * every file and route them all to skip-unknown.
 */
function currentCalsuiteSha(calsuiteDir) {
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      cwd: calsuiteDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    throw new Error(
      `Unable to determine calsuite HEAD sha via 'git rev-parse' in ${calsuiteDir}.\n` +
      `The _origin protocol requires a real sha to stamp into every distributed file.\n` +
      `Git reported: ${stderr.trim() || err.message}\n` +
      `Fix: ensure calsuite is a git checkout with an accessible HEAD (not detached, not shallow-pruned, git binary on PATH).`
    );
  }
}

/**
 * Decide what to do with a single calsuite-managed file during sync.
 * Returns one of:
 *   'write-new'     dest missing — fresh write + stamp
 *   'write-update'  dest calsuite-managed and unchanged since install — safe overwrite
 *   'migrate'       dest has no _origin but content matches calsuite current — stamp in place
 *   'skip-diverged' dest calsuite-managed but user edited — skip, flag
 *   'skip-unknown'  dest has no _origin and content differs — pre-protocol edit or stale, skip, flag
 *   'skip-claimed'  dest has _origin pointing somewhere other than calsuite — user-owned, skip silently
 */
function decideFileAction(destPath, calsuiteRelPath, calsuiteDir) {
  if (!fs.existsSync(destPath)) {
    return { action: 'write-new' };
  }

  const destContent = fs.readFileSync(destPath, 'utf8');
  const origin = readOrigin(destContent);

  const calsuiteAbsPath = path.join(calsuiteDir, calsuiteRelPath);
  const calsuiteCurrent = fs.existsSync(calsuiteAbsPath)
    ? fs.readFileSync(calsuiteAbsPath, 'utf8')
    : null;

  if (origin && origin.startsWith('calsuite@')) {
    const installSha = origin.slice('calsuite@'.length);
    const atSha = contentAtSha(calsuiteRelPath, installSha, calsuiteDir);
    if (atSha === null) {
      return { action: 'skip-unknown', reason: `origin sha ${installSha} has no record of ${calsuiteRelPath}` };
    }
    if (normalizeForCompare(destContent) === normalizeForCompare(atSha)) {
      return { action: 'write-update' };
    }
    return { action: 'skip-diverged', reason: `user-modified since ${installSha}` };
  }

  if (origin) {
    return { action: 'skip-claimed', reason: `claimed as ${origin}` };
  }

  if (calsuiteCurrent !== null &&
      normalizeForCompare(destContent) === normalizeForCompare(calsuiteCurrent)) {
    return { action: 'migrate' };
  }
  return { action: 'skip-unknown', reason: 'no _origin marker and content diverges from current calsuite' };
}

module.exports = {
  parseFrontmatter,
  readOrigin,
  stampOrigin,
  normalizeForCompare,
  contentAtSha,
  currentCalsuiteSha,
  decideFileAction,
};
