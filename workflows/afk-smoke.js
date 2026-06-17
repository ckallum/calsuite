export const meta = {
  name: 'afk-smoke',
  description:
    'Phase 0 smoke test for the AFK loops: confirms a Desktop scheduled task can invoke a custom global skill that runs a global dynamic workflow, dispatch one agent, use gh, and return a structured result. Read-only; throwaway.',
  phases: [{ title: 'Smoke', detail: 'one agent reads the newest open PR via gh' }],
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    repo: { type: 'string' },
    pr: { type: 'number' },
    title: { type: 'string' },
    headSha: { type: 'string' },
    ok: { type: 'boolean' },
    note: { type: 'string' },
  },
  required: ['repo', 'pr', 'title', 'headSha', 'ok'],
}

// PHASE 0 FINDING: `args` does NOT reliably propagate to a *named* user workflow
// (object and string forms both arrived empty across 3 runs). So the loops are
// cwd-based: the repo is whatever the session's working directory resolves to
// (the Desktop task's working folder). We still accept an optional repo override
// in case args ever start propagating — normalized from object / JSON-string / bare string.
let a = args
if (typeof a === 'string') {
  try {
    a = JSON.parse(a)
  } catch (_) {
    a = { repo: a }
  }
}
// Only accept a repo override that is a well-formed OWNER/REPO string. Anything
// else (non-string, wrong shape) is ignored and we fall back to the cwd repo —
// this guards the `--repo ${repo}` interpolation below if args ever propagate.
const rawRepo = a && typeof a.repo === 'string' ? a.repo.trim() : ''
const repo = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(rawRepo) ? rawRepo : ''

phase('Smoke')
log(`afk-smoke: probing newest open PR (${repo || 'cwd repo'}) via gh, read-only`)

const repoFlag = repo ? `--repo ${repo} ` : ''
const result = await agent(
  `You are validating plumbing for an autonomous PR-review loop. Run ONLY read-only shell commands — no comments, labels, code edits, or other mutating commands.\n\n` +
    `Run:\n    gh pr list ${repoFlag}--state open --limit 1 --json number,title,headRefOid\n\n` +
    `If --repo is omitted, gh resolves the repo from the current directory's git remote — that is expected and correct for the per-repo task model.\n\n` +
    `Return a structured result:\n` +
    `- repo = the OWNER/REPO gh actually queried (from the current dir's remote if --repo was omitted).\n` +
    `- If an open PR exists: pr = its number, title = its title, headSha = its headRefOid, ok = true.\n` +
    `- If there are no open PRs: pr = 0, title = "(no open PRs)", headSha = "", ok = true, note = "no open PRs — plumbing validated".\n` +
    `- If the gh command errors: ok = false, note = the error text, and STILL set the required fields so the result is schema-valid — repo = "${repo}" (best effort), pr = 0, title = "(gh errored)", headSha = "".`,
  { label: `smoke:${repo || 'cwd'}`, schema: SCHEMA },
)

if (!result) {
  // agent() returns null when the subagent is skipped, dies, or fails schema
  // validation. For a go/no-go probe that is the most important failure to make
  // loud — return a schema-valid ok:false instead of handing a bare null upward.
  log('afk-smoke: FAIL — agent returned null (skipped, died, or schema-invalid)')
  return { repo, pr: 0, title: '(agent returned null)', headSha: '', ok: false, note: 'agent returned null — go/no-go FAIL' }
}
log(`afk-smoke: done — ok=${result.ok} repo=${result.repo} pr=${result.pr}`)
return result
