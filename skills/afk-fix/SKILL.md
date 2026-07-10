---
name: afk-fix
version: 0.1.2
description: |
  afk fix loop, autonomous PR fix loop, run the fix loop, fix needs-fixes PRs, afk fix cycle.
  The in-session orchestrator for the AFK fix loop: select open PRs labelled auto:needs-fixes,
  claim each, converge review feedback into committed code fixes (via /receiving-pr-feedback,
  /improve-architecture, /simplify, and a local /review), then advance the label to
  auto:needs-review or auto:needs-human. The ONLY loop that mutates code and pushes.
  Headless-safe (never prompts); the GitHub label is the state-machine spine.
  Calsuite-internal — globally symlinked, not distributed per-target.
argument-hint: "[owner/repo]"
allowed-tools:
  - Bash
  - Skill
  - Read
  - Edit
  - Write
---

# AFK fix loop

You are the **fix loop** of the AFK autonomous system — the **only loop that mutates code and pushes.** You take open pull requests labelled `auto:needs-fixes`, converge their review feedback into committed fixes on the PR branch, and advance the GitHub-label state machine. This runs **unattended** — **never ask the user anything, never wait for input.** Anything you cannot resolve escalates to `auto:needs-human` and you move on. The GitHub **label is the data channel**: exactly one loop owns a PR at a time; you own `auto:needs-fixes` and your in-flight claim `auto:fixing`.

**Mutation guardrails (non-negotiable):**
- Work only on the **PR's own branch**, in an isolated checkout. **Never push to `main`. Never force-push.** Only fast-forward pushes to the PR branch.
- **Publish once**, at the end (`/receiving-pr-feedback --publish-only`) — not on every convergence round.
- On any question, ambiguity, or failure you cannot fix, **escalate** — never guess at a mutation, never push a half-converged branch.

## Repo + preconditions

Determine `REPO`: the `owner/repo` passed in the invocation (e.g. `/afk-fix ckallum/museli`), else the current directory's remote (`gh repo view --json nameWithOwner --jq .nameWithOwner`).

Then run these **hard preconditions** — both must pass before any label is touched or any code changed:

1. **cwd must be a checkout of `REPO`** (an environment fault — exit cleanly, change nothing):
   ```bash
   CWD_REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)
   [ "$CWD_REPO" = "$REPO" ] || { echo "afk-fix: cwd repo is '${CWD_REPO:-none}', not '$REPO' — set the task's working folder to a checkout of $REPO. No changes made."; exit 0; }
   ```
2. **Fix-loop labels must exist** (`gh pr edit` errors hard if a label is missing; capture gh's exit status so a gh failure isn't misread as a missing label):
   ```bash
   have=$(gh label list --repo "$REPO" --limit 1000 --json name --jq '.[].name') \
     || { echo "afk-fix: could not list labels on $REPO (gh error — not a missing-label condition). No changes made."; exit 1; }
   for L in auto:needs-fixes auto:fixing auto:needs-review auto:needs-human; do
     echo "$have" | grep -qx "$L" || { echo "afk-fix: label '$L' missing on $REPO — run: node scripts/bootstrap-afk-labels.cjs $REPO"; exit 1; }
   done
   ```

## Step 1 — Age-aware stale-claim sweep

A prior run may have crashed mid-fix, leaving a stuck `auto:fixing` claim. The fix loop's budget is larger than review's (a convergence runs several rounds of `/receiving-pr-feedback` + `/review`), so reset only claims **older than ~60 min** — a fresher claim may belong to a still-running sibling. On a fetch failure, leave the claim (never reclaim on uncertainty).
```bash
cutoff=$(date -u -v-60M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '60 minutes ago' +%Y-%m-%dT%H:%M:%SZ)
for n in $(gh pr list --repo "$REPO" --state open --label auto:fixing --json number --jq '.[].number'); do
  # Per-page --jq (NOT --slurp — gh >= 2.95 rejects --slurp with --jq). Capture gh
  # on its own line so a real fetch FAILURE trips ||; `[[ < ]]` for the lexical
  # (== chronological) ISO-8601 UTC compare, since POSIX/zsh `[ \< ]` has no `<`.
  raw=$(gh api "repos/$REPO/issues/$n/timeline" --paginate \
    --jq '.[] | select(.event=="labeled" and .label.name=="auto:fixing") | .created_at') \
    || { echo "  ~ #$n: timeline fetch failed — leaving claim as-is"; continue; }
  applied=$(tail -n1 <<<"$raw")
  if [[ -z "$applied" || "$applied" < "$cutoff" ]]; then
    gh pr edit "$n" --repo "$REPO" --remove-label auto:fixing --add-label auto:needs-fixes \
      || echo "  ~ #$n: reclaim failed — will retry next sweep"
  fi
done
```

## Step 2 — Select

```bash
gh pr list --repo "$REPO" --state open --label auto:needs-fixes --json number,headRefOid,title
```
If empty, report "no PRs awaiting fixes" and stop. Otherwise process each PR (Step 3).

## Step 3 — Per PR (isolated)

**Per-PR isolation is the rule:** a failure on one PR must never abort the run, strand a claim, or leave half-pushed work. If any step for PR `N` fails, record `#N → error (<reason>)`, leave its label as-is (Step 1's sweep reclaims a stranded `auto:fixing` next run), and continue.

For PR `N` with head `SHA` (`headRefOid` from Step 2):

1. **Guard + SHA-skip.** If `SHA` is empty, record `#N → error (no head sha)` and continue. If a comment already records `afk-fix fixed sha=$SHA` — you already converged this exact head and crashed after the push but before the label moved — do **not** re-fix; just finish the transition:
   ```bash
   if gh pr view "$N" --repo "$REPO" --json comments --jq '.comments[].body' | grep -qF "afk-fix fixed sha=$SHA"; then
     gh pr edit "$N" --repo "$REPO" --remove-label auto:needs-fixes --add-label auto:needs-review
   fi
   ```
   record `#N → already-fixed (completed transition)` and continue.

2. **Claim** (first state change, so a second run finds nothing to grab):
   ```bash
   gh pr edit "$N" --repo "$REPO" --add-label auto:fixing --remove-label auto:needs-fixes
   ```
   If the claim fails, do **not** touch the PR — record `#N → error (claim)` and continue.

3. **Check out the PR head, detached, in isolation.** The scheduled task runs with **worktree on**, so your cwd is an isolated worktree. Check out the PR head **detached — never the branch** — so it can't collide with the PR branch already being checked out in another worktree: git refuses a branch that's live in a second worktree, and in a multi-worktree setup that's the *common* case. Capture the branch name for the push:
   ```bash
   BR=$(gh pr view "$N" --repo "$REPO" --json headRefName --jq .headRefName)
   gh pr checkout "$N" --repo "$REPO" --detach
   git fetch origin main    # gh pr checkout fetches the PR ref but NOT origin/main; without this,
                            # /review --headless (which diffs `git diff origin/main`) would compare
                            # against a stale base in a reused worktree and false-PASS a conflict.
   ```
   If either fails (e.g. a cross-fork PR without push access — you could never push the fixes), **escalate** (Step 4), reason `checkout/push access failed`. The publish step pushes with `HEAD:$BR`, so a detached checkout is fine.

4. **Convergence loop (max 3 rounds).** Goal: a local `/review` with **no CRITICAL findings**.
   - **Round 1 — address posted feedback:** run the fix skill in defer mode —
     ```
     Skill: receiving-pr-feedback
     args: "<N> --no-publish"
     ```
     It applies fixes, commits locally, and stages replies; it posts nothing and does not push. If it stops to ask a question or reports it cannot proceed, **escalate** — do not answer it.
   - **Enhance (once, after round 1, non-trivial PRs only):** deepen then clean up —
     `Skill: improve-architecture` (apply), then `Skill: simplify` (apply). Skip for trivial / docs-only PRs.
   - **Re-review (each round):** review the **local** working branch, non-interactively —
     ```
     Skill: review
     args: "--headless"
     ```
     `--headless` reviews `git diff origin/main` and prints the findings + the canonical `^Review complete: PASS|BLOCKED` line — no AskUserQuestion, no stamp, no PR comment. Determine the **addressable** findings: every CRITICAL finding, **plus** any INFORMATIONAL finding that is clearly relevant to this change or flags a bug/regression your fixes introduced. Skip only subjective style/nitpick informational — those alone don't block convergence. Then:
     - **No addressable findings** (PASS, and any leftover informational is pure style) → **converged**. Go to step 5.
     - **Addressable findings remain** with rounds left → apply them directly (edit + commit locally), then re-review. Up to **3 rounds total**.
     - **Addressable findings remain at the 3-round cap** → **escalate** (Step 4), reason `did not converge in 3 rounds`.
     - no recognizable verdict / it errored / it prompted → **escalate**.

5. **Publish + transition** (converged only):
   - `Skill: prevent` — capture the learning, add the most deterministic guardrail, file a tracking issue. **Non-blocking:** if `/prevent` errors, log it and continue to publish.
   - Flush the staged replies + PR body and **push** the fix commits to the PR branch:
     ```
     Skill: receiving-pr-feedback
     args: "<N> --publish-only"
     ```
   - Confirm the push landed and capture the new head:
     ```bash
     NEWSHA=$(gh pr view "$N" --repo "$REPO" --json headRefOid --jq .headRefOid) || NEWSHA=""
     ```
     If the fetch failed, or `NEWSHA` is **empty**, or `NEWSHA` equals the pre-fix `SHA` (nothing was pushed), the publish did not land — **escalate** (Step 4), reason `publish/push did not land`. **Never** write an `afk-fix fixed sha=` marker with an empty SHA: an empty marker defeats the Step 3.1 re-run guard and would let a half-published PR slip to `auto:needs-review`.
   - Transition + mark the **pushed** head (so step 1's guard recognises a completed fix on a re-run):
     ```bash
     gh pr edit "$N" --repo "$REPO" --remove-label auto:fixing --add-label auto:needs-review
     gh pr comment "$N" --repo "$REPO" --body "<!-- afk-fix fixed sha=$NEWSHA -->"
     ```
     If the transition `gh pr edit` fails, record `#N → error (transition)`; the sweep reclaims the claim and the SHA marker prevents a re-fix.

## Step 4 — Escalate on failure

Escalation means **abandon the local changes unpushed** — never push a half-converged branch.
```bash
gh pr edit "$N" --repo "$REPO" --remove-label auto:fixing --add-label auto:needs-human
gh pr comment "$N" --repo "$REPO" --body "afk-fix: escalating to needs-human — <one-line reason>. Local fixes were NOT pushed."
```
If either call fails, record the error and continue — Step 1's sweep reclaims the stranded claim.

## Step 5 — Report

Print one line per PR — `#N → needs-review | needs-human | already-fixed | error (...)` — and the totals. An all-skipped or all-error run is still a clean exit, not a failure.

## Notes

- **The only mutating loop.** You are the single place in the AFK system that edits code and pushes. Every push is a fast-forward to the **PR's own branch** — never `main`, never `--force`. Review and merge/gate never mutate.
- **Publish once.** `/receiving-pr-feedback --no-publish` defers replies/body/push through every convergence round; `--publish-only` flushes them once at the end. A crash before `--publish-only` leaves nothing pushed (the isolated worktree is discarded) — clean retry.
- **Idempotent + crash-safe.** The claim label, age-aware sweep, and `afk-fix fixed sha=` marker mean a re-run does no double work: a crash before push retries clean; a crash after push but before the label moved is recognised by the SHA marker and just completes the transition.
- **Headless-safe.** Every decision is escalate-not-ask. `/receiving-pr-feedback` (any mode) and `/review --headless` run non-interactively; if either prompts or hangs, that is a bug — treat it as a failure and escalate.
- **Prerequisites.** Labels bootstrapped (`scripts/bootstrap-afk-labels.cjs`), cwd a checkout of `REPO`, and the task's **worktree isolation on** (so `gh pr checkout` is safe). All checked up front.
- **Downstream.** `auto:needs-review` → the review loop re-verifies the pushed fixes and can bounce it back to `auto:needs-fixes` if new issues appear (the review↔fix cycle). `auto:needs-human` → a human; the branch is left unpushed.
