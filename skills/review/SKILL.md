---
name: review
version: 1.2.1
description: |
  review this, pre-landing review, check my code, review before merge, code review,
  look over my changes, audit this PR, review PR, review pull request.
  Up to 11 parallel review agents: conventions, security checklist, git blame history,
  previous PR comments, code comment compliance, silent failure hunting, type design,
  cross-module format consistency, spec-contract deviation, correctness/logic bugs,
  reuse & simplification.
  Confidence scoring, Greptile triage, TODO cross-reference, flow diagrams.
  Multi-PR mode: /review pr 123,124,125 --multi spawns separate Claude Code instances per PR.
  Adversarial converse mode: /review pr 123 --converse codex runs Claude's review then debates findings with another model CLI.
argument-hint: "[pr <number>[,number,...]] [greptile] [--multi] [--converse cli[:model]]"
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---

# Pre-Landing PR Review

You are running the `/review` workflow. Analyze the current branch's diff against main for structural issues that tests don't catch.

## Domain awareness

If the repo has a `CONTEXT.md` (or a `CONTEXT-MAP.md` pointing to per-module `CONTEXT.md` files), read it before dispatching review agents. **Use its vocabulary verbatim** in findings — refer to the "Order intake module" if the glossary names it that, not "the order service." Inconsistent vocabulary in review feedback creates churn during execute/ship.

If `docs/adr/` exists and the diff touches an area covered by an ADR, include "respect ADR-NNNN" in the relevant agent prompts so findings don't propose changes the ADR already rejected.

## Arguments

- `/review` — full review of current branch vs main (default)
- `/review greptile` — include Greptile bot comment triage (auto-detected for repos with prior triage history)
- `/review pr <number>` — review an existing PR by number (fetches diff from GitHub, posts findings as PR comment)
- `/review pr 123 --multi` — spawn a separate Claude Code instance in a new tmux pane (context-free, unbiased)
- `/review pr 123,124,125 --multi` — one new pane per PR
- `/review --converse codex` — adversarial review: Claude reviews, then debates findings with Codex CLI until consensus
- `/review pr 123 --converse codex` — same but for a PR (posts consensus findings as PR comment)
- `/review pr 123 --converse codex:o3` — specify adversary model (format: `cli:model`)

---

## Step 0: Multi Mode

**If `$ARGUMENTS` contains `--multi`:**

`--multi` means "new tmux pane, clean context" — works with one PR or many. Each PR gets its own Claude Code instance for unbiased review.

1. Parse PR numbers from arguments (single number like `123` or comma-separated like `123,124,125`).
2. Hand the parsed PR numbers to the shared launcher. It validates each value against `^[0-9]+$` before touching tmux — a value containing `$(...)`, backticks, or other shell metacharacters would otherwise fire command substitution inside the double-quoted tmux command. It then confirms an active tmux session, spawns one pane per PR, and prints the summary. Pass `{ID}` through unexpanded — the script substitutes it per pane.

```bash
calsuite_dir="${CALSUITE_DIR:-$HOME/Projects/calsuite}"
if [ ! -f "$calsuite_dir/scripts/tmux-multi-launch.sh" ]; then
  echo "✗ Launcher not found at $calsuite_dir/scripts/tmux-multi-launch.sh" >&2
  echo "  Set \$CALSUITE_DIR to your calsuite checkout, or clone it to ~/Projects/calsuite" >&2
  exit 1
fi
bash "$calsuite_dir/scripts/tmux-multi-launch.sh" \
  --mode pr --ids "123,124,125" \
  --prompt 'Run /review pr {ID}. Post your full findings as a PR comment. Do not make any code changes.' \
  --label 'Review of PR #{ID} complete' \
  --summary-label 'Multi-PR review'
```

The script exits non-zero on a validation failure (`2`), no tmux session (`3`), or missing tmux (`4`). Relay its stderr message to the user and STOP — do not fall back to spawning panes by hand. Each pane posts its findings as a comment on the respective PR.

3. **STOP.** Do not proceed to Step 1 — the tmux instances handle the reviews.

---

## Step 0.5: Converse Mode (Adversarial Review)

**If `$ARGUMENTS` contains `--converse <cli>` (e.g. `--converse codex`, `--converse codex:o3`):**

Adversarial review. Claude and the adversary CLI review the same diff independently and in parallel, exchange findings, then debate disagreements for up to 3 rounds. Output is a consensus report (both-found / Claude-only / adversary-only / dropped / unresolved) that replaces the normal Step 5/7/8 summary. Supported adversary CLIs: `codex`, `gemini`, `claude` (allowlisted to prevent injection from `$ARGUMENTS`).

Full flow lives in [references/converse.md](references/converse.md) — read it before executing converse mode. After Phase 5 completes, **STOP**; do not run Steps 7 or 8.

---

## Step 1: Pre-flight

**If `$ARGUMENTS` contains `pr <number>`:** PR review mode.
1. Run `gh pr view <number> --json state,isDraft` to check eligibility.
2. If the PR is closed, a draft, or trivially small (automated/bot PR), output: **"PR not eligible for review."** and stop.
3. Run `gh pr diff <number>` to get the diff. Use this instead of `git diff origin/main` for all subsequent steps.
4. Skip to Step 2.

**Otherwise:** Local branch review mode.
1. Run `git branch --show-current` to get the current branch.
2. If on `main`, output: **"Nothing to review — you're on main."** and stop.
3. Run `git fetch origin main --quiet && git diff origin/main --stat` to check if there's a diff.
4. If no diff, output: **"No changes against main. Nothing to review."** and stop.

---

## Step 2: Load Review Checklist

Read `.claude/skills/review/checklist.md`.

**If the file cannot be read, STOP and report:** "Review checklist not found. Run /configure-claude to install."

---

## Step 2.5: Greptile Comment Triage (conditional)

Only run this step if:
- `$ARGUMENTS` contains "greptile", OR
- A file exists at `$HOME/.claude/review/projects/$REMOTE_SLUG/greptile-history.md` for this repo
  (derive `REMOTE_SLUG` from `gh repo view --json nameWithOwner --jq '.nameWithOwner' | tr '/' '__'`)

Read `.claude/skills/review/greptile-triage.md` and follow the fetch, filter, classify, and escalation detection steps.

**If no PR exists, `gh` fails, API returns an error, or there are zero Greptile comments:** Skip this step silently. Greptile integration is additive — the review works without it.

**If Greptile comments are found:** Store the classifications (VALID & ACTIONABLE, VALID BUT ALREADY FIXED, FALSE POSITIVE, SUPPRESSED) — you will need them in Step 5.

---

## Step 3: Dispatch Parallel Review Agents

Dispatch **up to 11 parallel agents** in a single message using the Agent tool. Agents A–E always run. Agents F, G, H, I, J, and K are signal-gated — only dispatch them if the diff matches the gate.

### Signal gating (run these greps first)

Use the same diff source selected in Step 1:
- local mode: `git diff origin/main`
- PR mode: pipe the cached `gh pr diff <number>` output

```bash
# Cache the diff once so gating greps are cheap. Reuse the converse-mode diff when present;
# otherwise populate from the same source used in Step 1 (gh pr diff in PR mode, git diff
# origin/main in local mode). All gates read from $DIFF_FILE — do NOT re-shell out per gate.
DIFF_FILE="$CONVERSE_TMPDIR/diff.txt"
if [ ! -s "$DIFF_FILE" ]; then
  DIFF_FILE=$(mktemp)
  if [ -n "$PR_NUMBER" ]; then
    gh pr diff "$PR_NUMBER" > "$DIFF_FILE"
  else
    git diff origin/main > "$DIFF_FILE"
  fi
fi

# Agent F — silent failure hunter. `grep -c` always prints the count to stdout
# (0 on no match) and exits 1 on no match. Append `|| true` (not `|| echo 0`)
# to absorb the exit-1: `|| echo 0` would append a second "0" and produce a
# two-line "0\n0" string that breaks `-gt` tests, while bare `grep -c` would
# abort the script under `set -euo pipefail`. `|| true` gives the count without
# either failure mode.
F_COUNT=$(grep -cE 'catch|\.catch|fallback|onError|Result<' "$DIFF_FILE" || true)
# Agent G — type design review
G_COUNT=$(grep -cE 'interface |type |enum |class |struct ' "$DIFF_FILE" || true)
# Agent H — cross-module format consistency (any touched source file qualifies).
# Diff headers have the form "+++ b/path/to/file.ext" — grep those to count touched source files.
H_COUNT=$(grep -cE '^\+\+\+ b/.*\.(rs|ts|tsx|js|jsx|cjs|cts|mjs|mts|py|go|sql|sh|bash)$' "$DIFF_FILE" || true)
# Agents J (correctness/logic bugs) and K (reuse & simplification) reuse $H_COUNT —
# both apply to any source diff, so they gate on the same touched-source signal.
# Agent I — spec-contract deviation (branch has a matching spec).
# Strip standard feature-branch prefixes, then require an exact spec directory
# match. Do NOT fall back to "first spec under .claude/specs/" — for issue-driven
# branches (e.g. claude/<task>) the fallback grabs an unrelated spec and Agent I
# runs against the wrong contract. Better to skip cleanly when there's no match.
branch=$(git branch --show-current)
slug=$(echo "$branch" | sed -E 's#^(feat|fix|chore|refactor|feature)/##')
SPEC_DIR=""
[ -d ".claude/specs/$slug" ] && SPEC_DIR=".claude/specs/$slug"

# Also gate the versioned-struct pass inside Agent B:
VERSIONED_STRUCT=$(grep -cE '(_VERSION|version:\s*(number|u?[0-9]+))' "$DIFF_FILE" || true)
```

If the respective count is 0 (or `$SPEC_DIR` empty for Agent I), skip that agent.

**Agent A — Convention review (@code-reviewer):** runs the @code-reviewer workflow against the diff — convention compliance, secrets, debug artifacts, dead code, error handling, spec alignment, pattern consistency, security. Always dispatched. Prompt in [references/agents.md#agent-a-convention-review-code-reviewer](references/agents.md#agent-a-convention-review-code-reviewer).

**Agent B — Checklist review (security + structural):** runs the two-pass checklist from `.claude/skills/review/checklist.md` (CRITICAL pass: SQL/data, races, LLM trust, auth; INFORMATIONAL pass: everything else). Honours suppressions. Versioned-struct sub-pass fires only when `$VERSIONED_STRUCT > 0`. Always dispatched. Prompt in [references/agents.md#agent-b-checklist-review-security--structural](references/agents.md#agent-b-checklist-review-security--structural).

**Agent C — Git blame & history review:** uses `git log` and `git blame` per changed file to flag churn, undone bug fixes, and patterns deliberately set by prior commits. Always dispatched. Prompt in [references/agents.md#agent-c-git-blame--history-review](references/agents.md#agent-c-git-blame--history-review).

**Agent D — Previous PR comment review:** mines review comments from merged PRs that touched the same files (via `gh pr list` + `gh api`) and surfaces ones still relevant to the current diff. Always dispatched. Prompt in [references/agents.md#agent-d-previous-pr-comment-review](references/agents.md#agent-d-previous-pr-comment-review).

**Agent E — Code comment compliance:** checks the diff against TODO/FIXME/HACK comments, docstrings, and warning comments (e.g. `DO NOT MODIFY`) in the modified files. Always dispatched. Prompt in [references/agents.md#agent-e-code-comment-compliance](references/agents.md#agent-e-code-comment-compliance).

**Agent F — Silent failure hunter (signal-gated: `$F_COUNT > 0`):** scrutinizes every error-handling location in the diff for catch-specificity, logging quality, user feedback, fallback justification, and error propagation. Dispatch only if `$F_COUNT > 0` (diff contains `catch`, `.catch`, `fallback`, `onError`, or `Result<`). Prompt in [references/agents.md#agent-f-silent-failure-hunter-signal-gated-f_count--0](references/agents.md#agent-f-silent-failure-hunter-signal-gated-f_count--0).

**Agent G — Type design review (signal-gated: `$G_COUNT > 0`):** rates new/modified types on invariant expression, encapsulation, enforcement, and usefulness; flags anemic types, mutable internals, comment-only invariants. Dispatch only if `$G_COUNT > 0` (diff introduces or modifies `interface`, `type`, `enum`, `class`, or `struct`). Prompt in [references/agents.md#agent-g-type-design-review-signal-gated-g_count--0](references/agents.md#agent-g-type-design-review-signal-gated-g_count--0).

**Agent H — Cross-module format consistency (signal-gated: `$H_COUNT > 0`):** greps the whole module around each changed file (not just the diff) for inconsistent datetime writers, SQL `ORDER BY` directions, and snake/camel serialization drift. Dispatch only if `$H_COUNT > 0` (diff touches a source file — Rust, TS/JS incl. `.cjs`/`.cts`/`.mjs`/`.mts`, Python, Go, SQL, shell). Prompt in [references/agents.md#agent-h-cross-module-format-consistency-signal-gated-h_count--0](references/agents.md#agent-h-cross-module-format-consistency-signal-gated-h_count--0).

**Agent I — Spec-contract deviation (signal-gated: `$SPEC_DIR` non-empty):** reads `$SPEC_DIR/design.md` + `tasks.md` and flags MISSING (spec promises, diff doesn't deliver) and EXTRA (diff builds, spec doesn't describe) items. Dispatch only if `$SPEC_DIR` is non-empty (branch name with standard feature-branch prefixes stripped matches `.claude/specs/<slug>/` **exactly** — no fallback to "first spec"). Prompt in [references/agents.md#agent-i-spec-contract-deviation-signal-gated-spec_dir-non-empty](references/agents.md#agent-i-spec-contract-deviation-signal-gated-spec_dir-non-empty).

**Agent J — Correctness & logic bugs (signal-gated: `$H_COUNT > 0`):** the bug-hunting lens (the `/code-review` correctness half) — functional defects the checklist (SQL/race/auth) and silent-failure passes miss: boundary/off-by-one, null/undefined, wrong operator, control-flow, async, API misuse, state/resource. Reports only defects with a concrete triggering scenario. Dispatch only if `$H_COUNT > 0` (diff touches source). Prompt in [references/agents.md#agent-j-correctness--logic-bugs-signal-gated-h_count--0](references/agents.md#agent-j-correctness--logic-bugs-signal-gated-h_count--0).

**Agent K — Reuse & simplification (signal-gated: `$H_COUNT > 0`):** the quality lens (the `/simplify` analysis, report-only — it never applies) — duplication/reuse, over-abstraction, dead params/branches, altitude, avoidable inefficiency, each with a before→after shape. Findings score like any other agent, so a high-confidence one can block. Dispatch only if `$H_COUNT > 0` (diff touches source). Prompt in [references/agents.md#agent-k-reuse--simplification-signal-gated-h_count--0](references/agents.md#agent-k-reuse--simplification-signal-gated-h_count--0).

Wait for all agents to return (5 core + up to 6 signal-gated).

---

## Step 4: Merge, Score, and Filter Findings

1. Collect findings from all agents (5-11 depending on which conditional agents ran).
2. Deduplicate: if multiple agents flag the same file:line for the same issue, keep the one with most detail.
3. **Confidence score each finding** on a 0-100 scale:
   - **0-25:** Likely false positive — doesn't stand up to scrutiny, or is a pre-existing issue.
   - **25-50:** Might be real but unverifiable, or is a stylistic preference not backed by CLAUDE.md.
   - **50-75:** Real issue but minor — nitpick, rarely hit in practice, or low impact.
   - **75-100:** Verified real issue — will impact functionality, directly violates CLAUDE.md, or has historical evidence (git blame/previous PR comments support it).
4. **Filter out findings scoring below 60.** This eliminates noise and false positives.
5. Classify remaining findings: score ≥ 80 = CRITICAL, score 60-79 = INFORMATIONAL.
6. If Greptile triage ran in Step 2.5, append VALID & ACTIONABLE Greptile findings as CRITICAL items.

---

## Step 5: Present Findings

Output all findings:

```text
## Pre-Landing Review: N issues (X critical, Y informational)
[+ M Greptile comments (A valid, B fixed, C FP)]  ← only if Greptile ran

### CRITICAL (blocking) — confidence ≥ 80
1. [file:line] Problem description (score: 85)
   Fix: suggested fix
   Source: convention | checklist | blame | prev-PR | comments | silent-failure | type-design | format-consistency | spec-contract | correctness | simplification | greptile

### INFORMATIONAL (advisory) — confidence 60-79
1. [file:line] Problem description (score: 65)
   Fix: suggested fix
```

**Be terse.** One line problem, one line fix. No preamble.

**For each CRITICAL finding (local mode only)**, use AskUserQuestion individually (one issue per call, not batched):
- A) Fix it now (recommended)
- B) Acknowledge and ship anyway
- C) False positive — skip

Lead with your recommendation and explain WHY.

**If user chose A (fix):** Describe the exact fix needed. Do NOT apply it — the skill is read-only. Tell the user to apply the fix and re-run `/review`.

**In PR mode:** skip the AskUserQuestion loop — findings are posted as a single consolidated comment in Step 7 for the PR author to address.

### Greptile Comment Resolution

After presenting your own findings, if Greptile comments were classified in Step 2.5:

**In PR mode: never prompt.** PR mode is non-interactive (it may run unattended, e.g. from `/ship` or `/afk-review`). Fold the Greptile triage into the single consolidated comment (Step 7) — list FALSE POSITIVEs with a one-line reason, include VALID & ACTIONABLE alongside your own findings — and skip every AskUserQuestion below. Items 1–2 are **local mode only**.

1. **VALID & ACTIONABLE:** Already included in CRITICAL findings above — follows the same AskUserQuestion flow (local mode).

2. **FALSE POSITIVE (local mode only):** Present each via AskUserQuestion:
   - Show the comment: file:line + body summary + permalink URL
   - Explain why it's a false positive
   - Options: A) Reply to Greptile explaining why incorrect (recommended), B) Fix it anyway, C) Ignore
   - If user chose A, reply using the False Positive template from greptile-triage.md

3. **VALID BUT ALREADY FIXED:** Reply using the Already Fixed template — no AskUserQuestion needed.

4. **SUPPRESSED:** Skip silently.

Write triage outcomes to history files as documented in greptile-triage.md.

---

## Step 5.5: Flow Diagram

Generate a **Mermaid diagram** showing the key flow introduced or changed in this diff. Pick the diagram type that fits best:

- `sequenceDiagram` — for request/response flows, multi-step pipelines, hook execution chains
- `flowchart TD` — for decision trees, state machines, before/after architecture comparisons
- `stateDiagram-v2` — for entity lifecycle or state transitions

**Rules:**
- Read the full diff first. Only diagram **new/changed flows**, not the entire system.
- 5-15 nodes max. If the PR is small (< 50 lines, config-only, docs-only), skip this step.
- Include error paths where the diff introduces error handling.

**If a PR exists** (check with `gh pr view --json number --jq '.number'`):
In **local mode**, post the diagram as a standalone PR comment using `gh`:

```bash
gh pr comment <number> --body "$(cat <<'EOF'
## Flow Diagram

```mermaid
<diagram>
```

_Auto-generated by `/review`_
EOF
)"
```

**If no PR exists** (reviewing before push): Include the diagram in the Step 5 output instead.

**In PR mode:** Do NOT post the diagram as a separate comment here — Step 7 embeds it in the single consolidated review comment to avoid double-posting.

---

## Step 5.6: TODO Cross-Reference

Check for `TODO.md` or `TODOS.md` in the repository root. If found:

- Does this PR close any open TODOs? Note: "This PR addresses TODO: <title>"
- Does this PR introduce work that should become a TODO? Flag as informational.
- Are there related TODOs that provide context? Reference them alongside related findings.

If no TODO file exists, skip silently.

---

## Step 6: Write Review Stamp

**If no unresolved CRITICAL findings** (all resolved as B/C, or none existed):

Compute the diff hash and write the review stamp. The hash covers BOTH `git diff origin/main` (committed-vs-main) AND `git diff` (unstaged drift) so staging/unstaging after the stamp can't mask a stale review. The node snippet below uses `execFileSync` with an explicit argv array — git arguments are passed as array elements, not interpolated into a shell string — which is safer and passes repo security hooks:

```bash
node -e "
  const crypto = require('crypto');
  const { execFileSync } = require('node:child_process');
  const fs = require('fs');
  const path = require('path');
  const diff = execFileSync('git', ['diff', 'origin/main'], { encoding: 'utf8' });
  const unstaged = execFileSync('git', ['diff'], { encoding: 'utf8' });
  const hash = crypto.createHash('sha256').update(diff + unstaged).digest('hex');
  const reviewDir = path.join(process.cwd(), '.claude');
  if (!fs.existsSync(reviewDir)) fs.mkdirSync(reviewDir, { recursive: true });
  fs.writeFileSync(path.join(reviewDir, '.last-review'), JSON.stringify({
    diffHash: hash,
    reviewedAt: new Date().toISOString(),
    reviewer: '/review'
  }) + '\n');
  console.log('Review stamp written: ' + hash.slice(0, 12) + '...');
"
```

**If any CRITICAL finding was resolved with "Fix it now":** Do NOT write the stamp. The user needs to apply fixes and re-run `/review`.

**If in PR mode (`/review pr <number>`):** Do NOT write the stamp — there's no local staged diff to hash.

---

## Step 7: Post PR Comment (PR mode only)

**If in PR mode (`/review pr <number>`):** Always post all findings as a **single consolidated comment** on the PR — do not post multiple comments, and do not run the interactive AskUserQuestion loop (that's local-mode only).

Format the full review output (from Step 5, plus the Step 5.5 flow diagram if generated) as one PR comment:

```bash
gh pr comment <number> --body "$(cat <<'EOF'
## Pre-Landing Review

<full review findings from Step 5, formatted as markdown>

<flow diagram from Step 5.5, if generated — embed it here rather than posting separately>

### Summary
Review complete: PASS | N informational notes
— or —
Review complete: BLOCKED | N critical issues need resolution

---
*Automated review by `/review pr <number>`*
EOF
)"
```

**Do NOT make code changes in PR mode.** The review is read-only — findings are posted as a comment for the PR author to address. Only make changes if the user explicitly asks you to fix something.

**If in local mode:** Skip this step (no PR to comment on; the interactive AskUserQuestion loop in Step 5 handled it).

---

## Step 8: Summary

```text
Review complete: PASS | N informational notes
```
or
```text
Review complete: BLOCKED | N critical issues need resolution
```

If in PR mode, confirm the comment was posted:
```text
Review findings posted as comment on PR #<number>.
```

---

## Gotchas

- **REMOTE_SLUG uses `tr '/' '__'`** to preserve the owner in the path (e.g., `owner__repo`). Don't use just the repo name.
- **Greptile auto-detect is repo-scoped, not wildcard.** The history file path includes the full `REMOTE_SLUG`, so it only activates for repos that have been triaged before. First run for a repo needs the explicit `/review greptile`.
- **The review stamp hashes `git diff origin/main` + `git diff`** (both committed-vs-main and unstaged drift). If you stage/unstage files after the stamp, the review gate will see a mismatch — by design, so unstaged changes can't mask a stale stamp. Stage everything before running `/review`.
- **If the checklist file is missing**, the skill stops early. Run `/configure-claude` to install it.
- **Flow diagram posts to PR as a separate comment in local mode** (when a PR exists), or is embedded inline in Step 5 if no PR. In PR mode, Step 7 folds the diagram into the single consolidated review comment to avoid double-posting. Skip for trivial diffs (< 50 lines, config-only, docs-only).
- **Confidence scoring filters noise.** Findings below 60 are dropped entirely. Don't lower the threshold to include more — the cutoff exists to prevent false positive fatigue.
- **Git blame agent may be slow on large files.** It runs `git blame` per changed file — on files with thousands of lines, this takes time. The parallel agents run simultaneously so it doesn't block the others.
- **PR mode (`/review pr <number>`)** fetches the diff from GitHub, not the local branch. The review stamp is NOT written in PR mode (there's no local staged diff to hash). Findings are posted as a single consolidated PR comment, not an interactive question loop.
- **Multi mode spawns independent Claude instances.** Each `--multi` pane runs `/review pr <n>` in a fresh context — they cannot coordinate findings. Use when you want unbiased parallel reviews; use single-instance mode when you want one consolidated summary.
- **Signal gating uses grep counts, not heuristics.** If `$F_COUNT` / `$G_COUNT` / `$H_COUNT` is 0, the agent does not run. Agents J and K share `$H_COUNT` (the touched-source signal), so they skip docs-/config-only PRs along with H. This prevents wasted agent budget on irrelevant diffs. Spec-contract gating uses directory existence rather than a count.
- **Stamp script uses `execFileSync` with argv, not a shell-string runner.** Git arguments go in as an array so nothing gets shell-interpolated — no injection surface, and security hooks that block shell-interpolated child-process calls still allow the argv form.
- **Converse mode requires the adversary CLI installed.** `codex` needs `npm i -g @openai/codex`, `gemini` needs the Google CLI. The skill checks `command -v <cli>` and stops early if missing.
- **Converse mode uses unquoted heredocs** (`<<PROMPT_EOF`, not `<<'PROMPT_EOF'`) so `$(cat ...)` and `${VAR}` expand. The diff content is read from a temp file via `$(cat "$CONVERSE_TMPDIR/diff.txt")` — never passed as a shell argument.
- **Large diffs may exceed adversary context limits.** If the diff is >5000 lines, consider using `--stat` summary + key files instead of the full diff. The skill doesn't auto-truncate — watch for CLI errors.
- **Adversary model selection:** Use `cli:model` syntax (e.g., `codex:o3`, `claude:sonnet`). If omitted, the CLI's default model is used. Some models may not be available on all accounts — if the adversary fails with a model error, retry without the model suffix or try a different model.
- **Adversary CLI allowlist:** Only `codex`, `gemini`, and `claude` are accepted. Passing any other CLI via `--converse` is rejected to prevent arbitrary command injection from `$ARGUMENTS`.
