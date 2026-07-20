---
name: receiving-pr-feedback
version: 1.2.0
description: |
  PR feedback, review comments, code review response, address review, respond to feedback,
  handle reviewer suggestions, fix review comments, CR feedback.
  Rigorous handling of PR review feedback — verify before implementing, push back when wrong.
  Multi-PR mode: /receiving-pr-feedback 323,324,325 --multi spawns separate Claude Code instances per PR.
argument-hint: "[pr-number[,number,...]] [--multi] [--no-publish|--publish-only]"
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Agent
  - AskUserQuestion
---

# Receiving PR Feedback

Handle PR review feedback with technical rigor. Verify suggestions before implementing, push back when they're wrong, and never blindly agree.

## Step 0: Multi-PR Mode

**If `$ARGUMENTS` contains `--multi`:**

`--multi` means "new tmux pane, clean context" — works with one PR or many. Each PR gets its own Claude Code instance with a fresh context window.

1. Parse PR numbers from arguments (single number like `323` or comma-separated like `323,324,325`).
2. Hand the parsed PR numbers to the shared launcher. It validates each number against `^[0-9]+$` (rejecting shell metacharacters before they reach the tmux command), confirms an active tmux session, spawns one pane per PR, and prints the summary. Pass `{ID}` through unexpanded — the script substitutes it per pane.

```bash
calsuite_dir="${CALSUITE_DIR:-$HOME/Projects/calsuite}"
if [ ! -f "$calsuite_dir/scripts/tmux-multi-launch.sh" ]; then
  echo "✗ Launcher not found at $calsuite_dir/scripts/tmux-multi-launch.sh" >&2
  echo "  Set \$CALSUITE_DIR to your calsuite checkout, or clone it to ~/Projects/calsuite" >&2
  exit 1
fi
bash "$calsuite_dir/scripts/tmux-multi-launch.sh" \
  --mode pr --ids "323,324,325" \
  --prompt 'Run /receiving-pr-feedback {ID}. Process all review feedback, apply fixes, and reply to comments on the PR.' \
  --label 'PR #{ID} feedback complete' \
  --summary-label 'Multi-PR feedback'
```

The script exits non-zero on a validation failure (`2`), no tmux session (`3`), or missing tmux (`4`). Relay its stderr message to the user and STOP — do not fall back to spawning panes by hand.

3. **STOP.** Do not proceed to Step 1 — the tmux instances handle the feedback.

---

## Step 0.5: Publish mode — `--no-publish` / `--publish-only` (AFK fix loop)

These flags let the AFK **fix loop** run this skill repeatedly on one PR and publish once at the end, instead of posting replies and rewriting the PR body on every pass. Mutually exclusive; default (neither flag) is the normal behavior.

Per-PR staging file, kept **outside the repo working tree** so a broad `git add` can never sweep it into a commit: `PENDING="${TMPDIR:-/tmp}/rpf-pending-<number>.json"`. It's ephemeral staging for one convergence (the fix loop's isolated worktree is discarded on crash, so a lost `$PENDING` just means a clean re-run). The path is deterministic per PR number, so `--no-publish` and `--publish-only` in the same run agree on it.

- **default (full)** — unchanged: apply fixes, post replies (Step 4), update the PR body (Step 4.5); the caller commits/pushes as today. Ignore `$PENDING`.
- **`--no-publish` (defer)** — run Steps 1–4's analysis + code fixes and **commit locally** (each commit message carries `[skip-review]` — this mode only ever runs inside the AFK fix loop, whose `/review --headless` is the gating review, and calsuite's review-gate hook would otherwise block every non-`.md` commit). Do NOT post any reply, do NOT run Step 4.5, and do NOT push. Instead, in Step 4 record each reply you would have posted into `$PENDING.replies`, **upserting by `commentId`** — replace any existing entry with the same `commentId` rather than appending a duplicate (a `null` `commentId`, e.g. a general non-inline reply, can't be keyed — append those). Meant to run multiple times; the upsert is what keeps it idempotent (one latest reply per comment), so a re-run — or a later `--publish-only` — never replays a duplicate. When the upsert replaces an entry already marked `posted: true` (from a publish that crashed mid-flush), **keep** `posted: true` — a resumed run must not re-post it. **Never prompt:** this mode runs unattended, so an unclear or ambiguous item is *not* an `AskUserQuestion` — print a terminal `receiving-pr-feedback: cannot proceed — <reason>` line and stop (the fix loop detects that line and escalates). This overrides Step 2.5 and the "escalate via AskUserQuestion" gotcha.
- **`--publish-only` (flush)** — **skip Steps 1–4 entirely** (no re-analysis, no new fixes). **Push first, and NEVER gate the push on `$PENDING`** — the fix loop's real payload is the *commits*, not the replies (its rounds 2–3 apply findings directly with `Edit`, staging no replies), so a genuinely-fixed PR can legitimately have an empty `$PENDING`. Derive the branch (`gh pr view <number> --json headRefName --jq .headRefName`) and **always attempt** `git push origin HEAD:<branch>` — push `HEAD:<branch>` (not a bare `git push`) so it works on the branch **or in a detached checkout**, which the AFK fix loop uses to dodge worktree conflicts. Do **not** pre-gate on an "is `HEAD` ahead of `origin/<branch>`" check: in a fresh detached worktree the base ref may not be fetched, making that check unanswerable and silently skipping a real push — instead just push, since a redundant push is a harmless `Everything up-to-date` and a genuine non-fast-forward (someone else pushed) surfaces as a non-zero exit the caller re-verifies. **Then**, *only if* `$PENDING` has replies, post each — marking it `posted: true` in `$PENDING` as its API call succeeds, so a crash-and-rerun skips already-posted replies instead of double-posting — and run Step 4.5 once using the tally derived from `$PENDING.replies` (count per `kind`); if `$PENDING` is missing or empty, skip the reply/PR-body step (say "no staged replies") — the commits were already pushed above. A reply whose comment returns **404** (the comment was deleted/resolved since it was staged) is **dropped as no-longer-applicable** — not a failure, and it must not block cleanup. Delete `$PENDING` once every reply is either posted or dropped.

`$PENDING` schema: `{ "replies": [ { "commentId": <id|null>, "path": <str|null>, "kind": "accepted"|"pushedBack"|"answered", "body": <str>, "posted": <bool — publish-time, absent/false until its API call succeeds> } ], "notes": [<str>] }`. `replies` is keyed by `commentId` (upsert, not append); the Step 4.5 tally is **derived** by counting `replies` per `kind` — there is no separately-accumulated counter to double-count when a round re-runs.

If `$ARGUMENTS` contains **both** flags, print "Choose one of --no-publish / --publish-only, not both." and stop. `--multi` is incompatible with either — the spawned panes run full mode.

---

## Step 1: Load feedback

If a PR number is in `$ARGUMENTS`, fetch ALL comment types:

```bash
# Issue-level comments (general PR discussion, including /review bot comments)
gh pr view <number> --comments --json comments,reviews,reviewDecision

# Inline review comments (line-level code review feedback)
gh api repos/{owner}/{repo}/pulls/<number>/comments --jq '.[] | {id: .id, path: .path, line: .line, body: .body, user: .user.login}'

# Top-level issue comments (general discussion not tied to specific lines)
gh api repos/{owner}/{repo}/issues/<number>/comments --jq '.[] | {id: .id, body: .body, user: .user.login}'
```

**Important:** PRs have TWO comment APIs — `/pulls/.../comments` for inline review comments and `/issues/.../comments` for general discussion. Both must be fetched. Automated review bots (like `/review pr`) post to issue comments, not inline comments.

If no PR number, check the current branch:
```bash
gh pr view --json number,comments,reviews
```

## Step 2: Classify each comment

For each review comment, classify it:

| Type | Action |
|---|---|
| **Bug / correctness issue** | Verify it's real, then fix |
| **Style / convention** | Check if it matches project conventions (read CLAUDE.md), then fix or push back |
| **Architecture suggestion** | Evaluate tradeoffs before acting |
| **Question / clarification** | Answer it |
| **Nitpick** | Fix if trivial, skip if subjective |
| **Wrong / outdated** | Push back with evidence |

## Step 2.5: Clarify ALL unclear items first

Before implementing anything, check if any comments are unclear or ambiguous. If so, **stop and ask for clarification on ALL unclear items before touching any code.**

> **`--no-publish` (AFK fix loop) never prompts.** In that mode this step does *not* call `AskUserQuestion` — it runs unattended and a prompt would hang. Instead, print the terminal `receiving-pr-feedback: cannot proceed — <unclear items>` line and stop; the fix loop detects it and escalates the PR to `auto:needs-human`. The rest of this step (identifying the unclear items) still applies — only the "ask" becomes "emit the terminal line and stop."

Items may be related — partial understanding leads to wrong implementation.

```
IF you understand items 1,2,3,6 but not 4,5:
  ❌ WRONG: Implement 1,2,3,6 now, ask about 4,5 later
  ✅ RIGHT: "Understand 1,2,3,6. Need clarification on 4 and 5 before implementing."
```

---

## Step 3: Process each comment

For each comment, follow this protocol:

### Verify first — never blindly implement

1. **Read the code** the reviewer is commenting on. Understand the full context.
2. **Check if they're right.** Run the code path mentally or with a test. Does their suggestion actually improve things?
3. **Check for side effects.** Will the suggested change break something else?

### Forbidden responses

Never say:
- "You're absolutely right!"
- "Great catch!" (unless it genuinely is)
- "I'll fix that right away" (before verifying)

Instead: verify, then respond with facts.

### When to push back

Push back when a suggestion:
- **Breaks functionality** — "This would break X because Y. The current approach handles Z."
- **Lacks context** — "This pattern is intentional because [reason from spec/CLAUDE.md]."
- **Violates YAGNI** — grep the codebase for actual usage. "This endpoint isn't called anywhere. Remove it (YAGNI)? Or is there usage I'm missing?"
- **Is technically incorrect** — "This would actually cause [problem]. Here's why: [evidence]."
- **Conflicts with project conventions** — "CLAUDE.md specifies [convention]. Should we update the convention instead?"

### When to accept

Accept when:
- The suggestion is correct and you can verify it
- It catches a real bug or edge case
- It aligns with project conventions you missed

Acknowledge with brief, factual statements: "Fixed — the null check was missing." Not: "Wonderful suggestion, you're so right!"

## Step 4: Apply fixes

> **Publish mode (Step 0.5):** `--publish-only` never reaches this step (Steps 1–4 are skipped). In `--no-publish`, do the fixes + local commit below, but replace every `gh api … /replies` post with an **upsert into `$PENDING.replies`** — key by `commentId` (replace a same-id entry; append only a `null`-id reply) and carry the reply's `kind` (`accepted`|`pushedBack`|`answered`) — do not post, do not push. No tally to bump; it's derived from the reply set at publish. In full (default) mode, post/commit/push as written.

Implement in this order:
1. **Blocking issues** (breaks, security) — fix first
2. **Simple fixes** (typos, imports, one-liners) — batch these
3. **Complex fixes** (refactoring, logic changes) — one at a time, test each

For each accepted comment:
1. Make the fix
2. Test it (run relevant tests to verify no regression)
3. Reply on the PR with what you changed (one-liner)

```bash
gh api repos/{owner}/{repo}/pulls/<number>/comments/<comment-id>/replies -f body="Fixed — added null check for empty array case."
```

For each rejected comment, reply with your reasoning:

```bash
gh api repos/{owner}/{repo}/pulls/<number>/comments/<comment-id>/replies -f body="This is intentional — [reason]. Happy to discuss if you see an issue I'm missing."
```

## Step 4.5: Update PR Description

> **Publish mode (Step 0.5):** **skip this step entirely in `--no-publish`** — the PR body is rewritten once, at `--publish-only` time. In `--publish-only` and full mode, run it; in `--publish-only` derive the Revision History tally by counting `$PENDING.replies` per `kind`.

After fixes are applied and commits pushed, update the PR description to reflect the current state. Both `/ship` (Step 8) and this skill follow the same PR body structure defined in `.claude/skills/ship/pr-template.md`.

### Compute summary data first

Before updating the description, tally the results from Steps 3-4:
- **Accepted count**: number of comments where fixes were applied
- **Pushed back count**: number of comments rejected with reasoning
- **Questions answered count**: number of clarification replies

These counts are used in both the Revision History entry (below) and the final user summary (Step 5).

### Update procedure

**a. Fetch current PR body:**

```bash
gh pr view <number> --json body --jq '.body'
```

**b. Parse into sections:**

Don't split the body by hand — use the shared parser. It exports `parsePrBody(body)` → `{ preamble, sections: [{ name, content }] }` and `assemblePrBody(parsed)` (the inverse). Splitting is by level-2 `## ` headers; the preamble is any text before the first header; unknown sections are preserved in place. Edit `parsed.sections` in steps c–e, then `assemblePrBody` it in step f.

```bash
node -e '
  const { parsePrBody, assemblePrBody } = require("./.claude/scripts/lib/pr-body-parser.cjs");
  const body = require("fs").readFileSync(0, "utf8");
  const parsed = parsePrBody(body);
  // inspect parsed.sections.map(s => s.name), edit as needed, then:
  process.stdout.write(assemblePrBody(parsed));
' <<<"$(gh pr view <number> --json body --jq '.body')"
```

The module path is `.claude/scripts/lib/pr-body-parser.cjs` inside a target project (the installer places calsuite's `scripts/lib/` under `.claude/`); in calsuite itself it lives at `scripts/lib/pr-body-parser.cjs`. The known section names live in the module's `KNOWN_SECTIONS` export — match against those rather than hardcoding the list here.

**c. Regenerate dynamic sections:**

- **Summary**: Analyze all commits on the branch (`git log origin/main..HEAD --oneline`) and generate updated bullet points summarizing what shipped.
- **Important Files**: Run `git diff origin/main --stat` and rebuild the file/change table matching the format in `pr-template.md`.
- **Test Results**: Re-run the project's test suites and rebuild the results table. Omit suites that weren't run.
- **Development Flow**: If `.claude/flow-trace-${CLAUDE_SESSION_ID:-unknown}.jsonl` exists, regenerate the Mermaid diagram. If no trace file exists, skip this section entirely. The `:-unknown` fallback matches the default used by calsuite's session-scoped trackers when `CLAUDE_SESSION_ID` is unset.

**d. Preserve static sections as-is (do not regenerate):**

- `## How It Works`
- `## Pre-Landing Review`
- `## Doc Completeness`
- Any custom/unknown sections not in the known list

**e. Build and append Revision History entry:**

If a `## Revision History` section exists, append to it. If not, create it after `## Doc Completeness` (or at the end if Doc Completeness is missing).

```markdown
## Revision History

**Round N** (YYYY-MM-DD):
- Accepted: X comments — brief list of key changes made
- Pushed back: Y comments
- Questions answered: Z comments
```

Round number = count of lines in the Revision History section matching the anchored regex `^\*\*Round \d+\*\*` (line start, literal `**Round `, one or more digits, literal `**`), plus 1. This avoids false matches inside prose or HTML comments. Date = today's date.

**f. Update the PR:**

Reassemble the body with `assemblePrBody(parsed)` (step b), then write it to a temp file and update the PR from that file. Use the `Write` tool to write the assembled body — this avoids heredoc sentinel collisions (a PR body can legitimately contain a line that is literally `EOF`, which would terminate a `<<'EOF'` heredoc early):

```bash
# 1. Create the temp file path
tmp_body="$(mktemp)"
trap 'rm -f "$tmp_body"' EXIT

# 2. Write the assembled body (from assemblePrBody) to $tmp_body using the Write tool
#    (not a shell heredoc — sentinels can collide with body content)

# 3. Update the PR from the file
gh pr edit <number> --body-file "$tmp_body"
```

## Step 5: Summary

Report to the user:
```text
PR #N feedback processed:
  Accepted: X comments (fixes applied)
  Pushed back: Y comments (replies posted)
  Questions answered: Z comments
  PR description: updated with revision round N
```

## Gotchas

- **Never batch-accept all comments.** Process each individually. Reviewers are sometimes wrong.
- **YAGNI check every "make it more professional" suggestion.** If it adds complexity for hypothetical future use, push back.
- **Read the full diff context, not just the commented line.** Reviewers sometimes miss surrounding code that explains the pattern.
- **If the reviewer and you disagree, escalate to the user** via AskUserQuestion rather than going back and forth. **Exception — `--no-publish`:** never prompt; emit the terminal `receiving-pr-feedback: cannot proceed — <reason>` line and stop, letting the fix loop escalate.
