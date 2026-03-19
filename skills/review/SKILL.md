---
name: review
version: 1.0.0
description: |
  review this, pre-landing review, check my code, review before merge, code review,
  look over my changes, audit this PR.
  Two-pass analysis (critical blocking + informational), parallel @code-reviewer
  dispatch, optional Greptile comment triage, TODO cross-reference.
argument-hint: [greptile]
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

## Arguments

- `/review` — full review (default)
- `/review greptile` — include Greptile bot comment triage

---

## Step 1: Pre-flight

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

Dispatch **2 parallel agents** in a single message using the Agent tool:

**Agent A — Convention review (@code-reviewer):**
```text
prompt: "You are the @code-reviewer agent. Review the diff between origin/main and HEAD.

Follow the full code-reviewer workflow:
1. Run: git diff origin/main, git diff origin/main --name-only
2. Read all CLAUDE.md files in the repo
3. If .claude/specs/ exists, detect active spec from branch name
4. For each changed file, read 1-2 sibling files for pattern context
5. Run the review checklist: convention compliance, secrets, debug artifacts,
   dead code, error handling, spec alignment, pattern consistency, security

Produce your standard findings list with file:line references and severity
(critical/warning/info). Do NOT write any review stamp file.
Return findings only."
description: "Convention review (@code-reviewer)"
```

**Agent B — Checklist review (security + structural):**
```text
prompt: "Run a pre-landing code review on the diff between origin/main and HEAD.
Run `git diff origin/main` to get the full diff. Read the checklist at
.claude/skills/review/checklist.md. Apply the two-pass review:

Pass 1 (CRITICAL): SQL & Data Safety, Race Conditions & Concurrency,
LLM Output Trust Boundary, Auth & Security Boundaries.
Pass 2 (INFORMATIONAL): All remaining categories.

Respect the Suppressions section — do NOT flag items listed there.
Read the FULL diff before flagging anything.

Output format: 'Checklist Review: N issues (X critical, Y informational)'
followed by findings with file:line references and suggested fixes.
Categorize each as CRITICAL or INFORMATIONAL."
description: "Checklist review (security + structural)"
```

Wait for both agents to return.

---

## Step 4: Merge and Deduplicate Findings

1. Collect findings from both agents.
2. Deduplicate: if both agents flag the same file:line for the same issue, keep the one with more detail.
3. Merge into a single findings list, preserving CRITICAL vs INFORMATIONAL classification.
4. If Greptile triage ran in Step 2.5, append VALID & ACTIONABLE Greptile findings as CRITICAL items.

---

## Step 5: Present Findings

Output all findings:

```text
## Pre-Landing Review: N issues (X critical, Y informational)
[+ M Greptile comments (A valid, B fixed, C FP)]  ← only if Greptile ran

### CRITICAL (blocking)
1. [file:line] Problem description
   Fix: suggested fix
   Source: checklist | @code-reviewer | greptile

### INFORMATIONAL (advisory)
1. [file:line] Problem description
   Fix: suggested fix
```

**For each CRITICAL finding**, use AskUserQuestion individually (one issue per call, not batched):
- A) Fix it now (recommended)
- B) Acknowledge and ship anyway
- C) False positive — skip

Lead with your recommendation and explain WHY.

**If user chose A (fix):** Describe the exact fix needed. Do NOT apply it — the skill is read-only. Tell the user to apply the fix and re-run `/review`.

### Greptile Comment Resolution

After presenting your own findings, if Greptile comments were classified in Step 2.5:

1. **VALID & ACTIONABLE:** Already included in CRITICAL findings above — follows the same AskUserQuestion flow.

2. **FALSE POSITIVE:** Present each via AskUserQuestion:
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
Post the diagram as a PR comment using `gh`:

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

Compute the diff hash and write the review stamp:

```bash
node -e "
  const crypto = require('crypto');
  const { execSync } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  const diff = execSync('git diff --cached', { encoding: 'utf8' });
  const hash = crypto.createHash('sha256').update(diff).digest('hex');
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

---

## Step 7: Summary

```text
Review complete: PASS | N informational notes
```
or
```text
Review complete: BLOCKED | N critical issues need resolution
```

---

## Important Rules

- **Read the FULL diff before commenting.** Do not flag issues already addressed in the diff.
- **Read-only by default.** Only write the review stamp file. Never modify code, commit, push, or create PRs.
- **Be terse.** One line problem, one line fix. No preamble.
- **Only flag real problems.** Skip anything that's fine. Respect the suppressions list.
- **One issue per AskUserQuestion.** Never batch multiple issues into one question.

## Gotchas

- **REMOTE_SLUG uses `tr '/' '__'`** to preserve the owner in the path (e.g., `owner__repo`). Don't use just the repo name.
- **Greptile auto-detect is repo-scoped, not wildcard.** The history file path includes the full `REMOTE_SLUG`, so it only activates for repos that have been triaged before.
- **The review stamp hashes `git diff --cached`** (staged changes only). If you stage/unstage files after the stamp, the review gate will see a mismatch. Stage everything before running `/review`.
- **If the checklist file is missing**, the skill stops early. Run `/configure-claude` to install it.
- **Flow diagram is posted as a PR comment**, not in the review output. If no PR exists yet, include it inline instead. Skip for trivial diffs (< 50 lines, config-only, docs-only).
