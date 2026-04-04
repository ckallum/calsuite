'use strict';

// Known section names for identification
const KNOWN_SECTIONS = [
  'Summary',
  'How It Works',
  'Important Files',
  'Test Results',
  'Pre-Landing Review',
  'Development Flow',
  'Doc Completeness',
  'Revision History',
];

/**
 * Parse a PR body into sections by `## ` headers.
 *
 * Returns: { preamble: string, sections: [{name: string, content: string}] }
 *
 * - Splits on `^## ` at line start (regex)
 * - Preserves preamble text before the first `## ` header
 * - Each section = header name + full content until next `## ` or EOF
 * - Unknown sections (not in KNOWN_SECTIONS) are preserved in their original position
 * - Round-trip safe: assemblePrBody(parsePrBody(body)) === body
 */
function parsePrBody(body) {
  if (!body) {
    return { preamble: '', sections: [] };
  }

  // Split on lines that start with `## ` while keeping the delimiter
  // We use a regex that matches `## ` at the start of a line
  const parts = body.split(/^(?=## )/m);

  let preamble = '';
  const sections = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (i === 0 && !part.startsWith('## ')) {
      // Everything before the first ## header is the preamble
      preamble = part;
      continue;
    }

    // Extract the section name from the first line: "## Name\n..."
    const newlineIndex = part.indexOf('\n');
    let name;
    let content;

    if (newlineIndex === -1) {
      // Section header with no content after it
      name = part.replace(/^## /, '').trim();
      content = '';
    } else {
      name = part.slice(3, newlineIndex).trim();
      content = part.slice(newlineIndex + 1);
    }

    sections.push({ name, content });
  }

  return { preamble, sections };
}

/**
 * Reassemble a PR body from a section map.
 * Takes the same structure returned by parsePrBody.
 */
function assemblePrBody(parsed) {
  let body = parsed.preamble;

  for (const section of parsed.sections) {
    body += '## ' + section.name + '\n' + section.content;
  }

  return body;
}

module.exports = { parsePrBody, assemblePrBody, KNOWN_SECTIONS };
