---
name: afk-fix
version: 0.2.0
description: |
  afk fix loop, autonomous PR fix loop, run the fix loop, fix needs-fixes PRs, afk fix cycle.
  The in-session orchestrator for the AFK fix loop: select open PRs labelled auto:needs-fixes,
  claim each, converge review feedback into committed code fixes (via /receiving-pr-feedback
  and a local /review --headless, which itself covers reuse/simplification), then advance the
  label to auto:needs-review or auto:needs-human. The ONLY loop that mutates code and pushes.
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

A prior run may have crashed mid-fix, leaving a stuck `auto:fixing` claim. The fix loop's budget is larger than review's (a convergence runs several rounds of `/review`), so reset only claims **older than ~90 min** — a fresher claim may belong to a still-running sibling. (This is a coarse guard: a convergence that genuinely runs past 90 min could be reclaimed and double-processed — the durable fix is a per-round heartbeat on the claim; tracked separately.) On a fetch failure, leave the claim (never reclaim on uncertainty).
```bash
cutoff=$(date -u -v-90M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '90 minutes ago' +%Y-%m-%dT%H:%M:%SZ)
claimed=$(gh pr list --repo "$REPO" --state open --label auto:fixing --json number --jq '.[].number') \
  || { echo "afk-fix: could not list auto:fixing PRs (gh error) — skipping sweep this run"; claimed=""; }
for n in $claimed; do
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
queue=$(gh pr list --repo "$REPO" --state open --label auto:needs-fixes --json number,headRefOid,title) \
  || { echo "afk-fix: could not list auto:needs-fixes PRs (gh error) — stopping, no changes made"; exit 1; }
```
A gh failure returns empty, indistinguishable from an empty queue — so capture the exit status and stop on error rather than silently reporting a clean run. If `$queue` is a valid but empty list, report "no PRs awaiting fixes" and stop. Otherwise process each PR (Step 3).

## Step 3 — Per PR (isolated)

**Per-PR isolation is the rule:** a failure on one PR must never abort the run, strand a claim, or leave half-pushed work. If any step for PR `N` fails, record `#N → error (<reason>)`, leave its label as-is (Step 1's sweep reclaims a stranded `auto:fixing` next run), and continue.

For PR `N` with head `SHA` (`headRefOid` from Step 2):

1. **Guard + SHA-skip.** If `SHA` is empty, record `#N → error (no head sha)` and continue. Otherwise check for a completion marker left by a prior crashed run:
   ```bash
   if gh pr view "$N" --repo "$REPO" --json comments --jq '.comments[].body' | grep -qF "afk-fix fixed sha=$SHA"; then
     # already converged this exact head, crashed after the push but before the label moved —
     # finish the transition, do NOT re-fix
     gh pr edit "$N" --repo "$REPO" --remove-label auto:needs-fixes --add-label auto:needs-review
   fi
   ```
   **If the marker was present** (the `if` fired), record `#N → already-fixed (completed transition)` and continue to the next PR. **If it was absent** (the common path), do *not* record already-fixed — fall through to step 2 and process the PR. *(The record-and-continue is conditional on the marker; putting it outside the `if` would skip every PR forever.)*

2. **Claim** (first state change, so a second run finds nothing to grab):
   ```bash
   gh pr edit "$N" --repo "$REPO" --add-label auto:fixing --remove-label auto:needs-fixes
   ```
   If the claim fails, do **not** touch the PR — record `#N → error (claim)` and continue.

3. **Cross-fork guard, clean the worktree, then check out the PR head detached against its real base.** First reject fork PRs — the publish only pushes to a **same-repo** head. `gh pr checkout --detach` *succeeds* for a fork (it fetches the PR ref), so a checkout failure can't catch one; and the publish would then push the head to `origin` (the **base** repo), leaving a stray branch there while the fork's head stays untouched. Capture it **fail-closed** — any gh error yields empty output, and empty must mean "assume fork / can't confirm", never "proceed":
   ```bash
   ISFORK=$(gh pr view "$N" --repo "$REPO" --json isCrossRepository --jq .isCrossRepository) \
     || ISFORK="check-failed"
   ```
   If `$ISFORK` is anything other than the literal `false`, **escalate** (Step 4), reason `cross-fork or fork-check failed — no push access to fork head`, and continue — do **not** check out or converge (the claim from step 3.2 is reversed by Step 4). Only when `$ISFORK` is exactly `false`: clean any residue a prior PR's abandoned convergence left in this reused worktree (Step 4 abandons changes in place), then check out the PR head **detached — never the branch** (git refuses a branch that's live in another worktree; in a multi-worktree setup that's the *common* case), and fetch the PR's **real base** — not a hardcoded `main`: the loop runs on arbitrary repos (`master`/`develop`) and a stacked PR's base is another feature branch.
   ```bash
   BASE=$(gh pr view "$N" --repo "$REPO" --json baseRefName --jq .baseRefName) || BASE=""
   [ -n "$BASE" ] || { echo "  ~ #$N: could not resolve base ref"; }   # empty → escalate below
   git reset --hard && git clean -fd
   gh pr checkout "$N" --repo "$REPO" --detach
   git fetch origin "$BASE"    # /review --headless diffs `git diff origin/$BASE`; gh pr checkout fetches
                               # the PR ref but not the base, so without this the base ref is stale/absent.
   ```
   If `$BASE` is empty, or the checkout or fetch fails, **escalate** (Step 4), reason `checkout/base-fetch failed`. `$BASE` feeds the re-review (step 4) and the publish re-derives the head branch itself, so a detached checkout is fine.

4. **Convergence loop (max 3 rounds).** Goal: a local `/review --headless` with **no addressable findings**.
   - **Round 1 — address posted feedback:** run the fix skill in defer mode —
     ```
     Skill: receiving-pr-feedback
     args: "<N> --no-publish"
     ```
     It applies fixes, commits locally (each commit carries `[skip-review]` — the loop's own `/review --headless` is the gating review, and calsuite's review-gate hook otherwise blocks every non-`.md` commit), stages replies, and pushes nothing. It **never prompts**: if it can't proceed on an item it returns a terminal `receiving-pr-feedback: cannot proceed — …` line — treat that as a failure and **escalate**, do not try to answer it.
   - **Re-review (each round):** review the **local** working branch, non-interactively —
     ```
     Skill: review
     args: "--headless --base $BASE"
     ```
     `--headless` diffs `git diff origin/$BASE`, prints the findings + the canonical `^Review complete: PASS|BLOCKED` line, and never prompts / stamps / posts. **Agent K (reuse & simplification) runs inside this review**, so simplification is covered here — there is deliberately no separate `/improve-architecture` or `/simplify` mutation step (both prompt and can't run headless). Determine the **addressable** findings: every CRITICAL, **plus** any INFORMATIONAL clearly relevant to this change or flagging a bug/regression your fixes introduced. Skip only subjective style/nitpick informational. Then:
     - **No addressable findings** (PASS, leftover informational is pure style) → **converged**. Go to step 5.
     - **Addressable findings remain** with rounds left → apply them directly (edit + commit locally, commit message carrying `[skip-review]`), then re-review. Up to **3 rounds total**.
     - **Addressable findings remain at the 3-round cap** → **escalate** (Step 4), reason `did not converge in 3 rounds`.
     - no recognizable verdict / it errored / it prompted → **escalate**.

5. **Publish + transition** (converged only). No `/prevent` step — it prompts, files a GitHub issue unattended, and its edits would be discarded here anyway; capture guardrails out-of-band.
   - Record the local head, then flush the staged replies + PR body and push any fix commits to the PR branch:
     ```bash
     LOCAL=$(git rev-parse HEAD)
     ```
     ```
     Skill: receiving-pr-feedback
     args: "<N> --publish-only"
     ```
   - **Zero-commit convergence.** If `$LOCAL` equals the pre-fix `SHA`, the loop changed no code — every finding was correctly pushed back on, or none was actionable. `--publish-only` above already published the pushback replies, so **escalate** (Step 4), reason `converged with no code changes — pushed back on all findings; needs human adjudication`. Do **not** transition to `auto:needs-review`: the unchanged code would re-trigger the identical findings and bounce between review and fix forever.
   - **Confirm the push landed** (commits were made): the remote head must now equal **our local commit** — not merely differ from the old `SHA`:
     ```bash
     NEWSHA=$(gh pr view "$N" --repo "$REPO" --json headRefOid --jq .headRefOid) || NEWSHA=""
     ```
     The push landed **iff** `$NEWSHA` == `$LOCAL`. If the fetch failed, `$NEWSHA` is empty, or `$NEWSHA` != `$LOCAL` — e.g. a human pushed to the branch mid-convergence, so our non-force `git push` was rejected and the remote now carries *their* commit — **escalate** (Step 4), reason `publish/push did not land`. **Never** write a marker unless `$NEWSHA` == `$LOCAL`: a marker on someone else's SHA (or an empty one) poisons the Step 3.1 re-run guard and would slip a half-published PR to `auto:needs-review`.
   - Transition + mark the **pushed local** head (so step 1's guard recognises a completed fix on a re-run):
     ```bash
     gh pr edit "$N" --repo "$REPO" --remove-label auto:fixing --add-label auto:needs-review
     gh pr comment "$N" --repo "$REPO" --body "<!-- afk-fix fixed sha=$LOCAL -->"
     ```
     If the transition `gh pr edit` fails, record `#N → error (transition)`; the sweep reclaims the claim and the SHA marker prevents a re-fix.

## Step 4 — Escalate on failure

Escalation hands the PR to a human. In the usual case (a mid-convergence failure) it means **abandon the local changes unpushed** — never push a half-converged branch. Post the one-line reason; state "local fixes were not pushed" only when that is actually true — it is **not** true for the zero-commit-convergence escalation, where pushback replies were published and no code changed. Also **discard the staged replies** for this dead convergence, so a later run on the same PR starts clean instead of inheriting stale entries:
```bash
rm -f "${TMPDIR:-/tmp}/rpf-pending-$N.json"
gh pr edit "$N" --repo "$REPO" --remove-label auto:fixing --add-label auto:needs-human
gh pr comment "$N" --repo "$REPO" --body "afk-fix: escalating to needs-human — <one-line reason>."
```
If either `gh` call fails, record the error and continue — Step 1's sweep reclaims the stranded claim.

## Step 5 — Report

Print one line per PR — `#N → needs-review | needs-human | already-fixed | error (...)` — and the totals. An all-skipped or all-error run is still a clean exit, not a failure.

## Notes

- **The only mutating loop.** You are the single place in the AFK system that edits code and pushes. Every push is a fast-forward to the **PR's own branch** — never `main`, never `--force`. Review and merge/gate never mutate.
- **Publish once.** `/receiving-pr-feedback --no-publish` defers replies/body/push through every convergence round; `--publish-only` flushes them once at the end. A crash before `--publish-only` leaves nothing pushed (the isolated worktree is discarded) — clean retry.
- **Idempotent + crash-safe.** The claim label, age-aware sweep, and `afk-fix fixed sha=` marker mean a re-run does no double work: a crash before push retries clean; a crash after push but before the label moved is recognised by the SHA marker and just completes the transition.
- **Headless-safe.** Every decision is escalate-not-ask. `/receiving-pr-feedback --no-publish`/`--publish-only` and `/review --headless` are non-interactive by contract; if either prompts or hangs, that is a bug — treat it as a failure and escalate. The loop never invokes a skill that has no headless mode (`/improve-architecture`, `/prevent`, interactive `/review`).
- **Prerequisites.** Labels bootstrapped (`scripts/bootstrap-afk-labels.cjs`) and cwd a checkout of `REPO` are **verified up front** in the preconditions. The task's **worktree isolation** must also be on (so `gh pr checkout --detach` mutates an isolated tree) — that is a Desktop-task setting the loop can't read at runtime, so it's a deployment prerequisite, not a guard: with isolation off, the loop would detach HEAD and commit in the live checkout.
- **Downstream.** `auto:needs-review` → the review loop re-verifies the pushed fixes and can bounce it back to `auto:needs-fixes` if new issues appear (the review↔fix cycle). `auto:needs-human` → a human; the branch is left unpushed.
