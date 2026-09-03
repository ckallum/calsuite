---
name: afk-fix
version: 0.3.0
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

## How to execute this skill

**You are the loop — bash is not.** Every ```` ```bash ```` block below runs as its **own shell**, and every `Skill:` call is a **separate process**. Nothing carries across that boundary:

- **A variable set in one block is empty in the next.** Each block re-derives what it needs from `gh`/`git`. Never reference a value assigned in an earlier block.
- **`Skill:` args are a literal string, not shell.** Write the value you read: `args: "136 --no-publish"`. A `$VAR` there arrives as the literal characters `$VAR`.
- **`continue`/`break` outside a `for` loop do nothing** — bash and zsh both warn and *fall through*, so a guard written that way fails **open**. Guards below use `exit 1` inside their own block.
- **Blocks talk to you through stdout.** Each guard prints exactly one status line — `AFKFIX_OK …`, `AFKFIX_ESCALATE <reason>`, or `AFKFIX_ABORT <reason>` — and **you** act on it per the prose. That printed line is the only state that crosses a block boundary.
- **Anything that needs two values at once lives in ONE block** (push + verify + transition is a single block for this reason).

Where a step writes `<owner/repo>`, `<N>` or `<BASE>`, **substitute the literal value** — the repo you resolved, the PR number you are processing, and the base printed by 3.2.

**Stateless by design.** There is no completion marker and no saved per-run state. Crash recovery is *re-derivation*: a crashed run leaves a stale `auto:fixing` claim, Step 1's sweep returns it to `auto:needs-fixes`, and the next run re-reads the PR's current head and current review comments and starts over. That costs a redundant convergence but cannot corrupt state — the tradeoff is deliberate.

## Repo + preconditions

Determine `REPO`: the `owner/repo` passed in the invocation (e.g. `/afk-fix ckallum/museli`), else the current directory's remote (`gh repo view --json nameWithOwner --jq .nameWithOwner`).

Run these **hard preconditions** first — all three in one block, so a failure stops the run before any label is touched or any code changed. If it prints `AFKFIX_ABORT`, report that line and **stop**; change nothing.

```bash
REPO="<owner/repo>"   # substitute the resolved value

CWD_REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)
if [ "$CWD_REPO" != "$REPO" ]; then
  echo "AFKFIX_ABORT cwd repo is '${CWD_REPO:-none}', not '$REPO' — point the task's working folder at a checkout of $REPO"; exit 1
fi

# Labels must exist — `gh pr edit` errors hard on a missing one. Capture gh's exit status so a gh
# outage isn't misread as a missing label.
if ! have=$(gh label list --repo "$REPO" --limit 1000 --json name --jq '.[].name'); then
  echo "AFKFIX_ABORT could not list labels on $REPO (gh error, not a missing label)"; exit 1
fi
for L in auto:needs-fixes auto:fixing auto:needs-review auto:needs-human; do
  if ! echo "$have" | grep -qx "$L"; then
    echo "AFKFIX_ABORT label '$L' missing on $REPO — run: node \"\${CALSUITE_DIR:-\$HOME/Projects/calsuite}/scripts/bootstrap-afk-labels.cjs\" $REPO (that script lives in calsuite, not in this repo)"; exit 1
  fi
done

# Skill dependencies: /review and /receiving-pr-feedback resolve from the TARGET repo's INSTALLED
# skills (personal ~/.claude beats project .claude), NOT from calsuite's source tree. An install
# predating --headless / --no-publish silently lacks the flags this loop depends on, which would
# fail every convergence. Verify the resolved copies actually carry them.
resolve_skill() {
  for p in "$HOME/.claude/skills/$1/SKILL.md" ".claude/skills/$1/SKILL.md"; do
    [ -f "$p" ] && { echo "$p"; return 0; }
  done
  return 1
}
RV=$(resolve_skill review)
if [ -z "$RV" ] || ! grep -q -- '--headless' "$RV"; then
  echo "AFKFIX_ABORT installed /review lacks --headless (resolved: ${RV:-not installed}) — run: node \"\${CALSUITE_DIR:-\$HOME/Projects/calsuite}/scripts/configure-claude.js\" ."; exit 1
fi
RP=$(resolve_skill receiving-pr-feedback)
if [ -z "$RP" ] || ! grep -q -- '--no-publish' "$RP"; then
  echo "AFKFIX_ABORT installed /receiving-pr-feedback lacks --no-publish (resolved: ${RP:-not installed}) — run: node \"\${CALSUITE_DIR:-\$HOME/Projects/calsuite}/scripts/configure-claude.js\" ."; exit 1
fi

echo "AFKFIX_OK preconditions repo=$REPO review=$RV rpf=$RP"
```

## Step 1 — Age-aware stale-claim sweep

A prior run may have crashed mid-fix, leaving a stuck `auto:fixing` claim. A convergence runs several `/review` passes, so reset only claims **older than ~90 min** — a fresher one may belong to a still-running sibling. On any fetch failure, leave the claim (never reclaim on uncertainty). This block is a real `for` loop, so `continue` is legal here.

```bash
REPO="<owner/repo>"
cutoff=$(date -u -v-90M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '90 minutes ago' +%Y-%m-%dT%H:%M:%SZ)
if ! claimed=$(gh pr list --repo "$REPO" --state open --label auto:fixing --limit 200 --json number --jq '.[].number'); then
  echo "AFKFIX_OK sweep skipped (gh error listing auto:fixing)"; exit 0
fi
for n in $claimed; do
  # Per-page --jq (NOT --slurp — gh >= 2.95 rejects --slurp with --jq). Capture gh on its own line
  # so a real fetch FAILURE trips the guard; `[[ < ]]` for the lexical (== chronological) ISO-8601
  # UTC compare, since POSIX/zsh `[ \< ]` has no `<`. Reclaim only with a timestamp older than the
  # cutoff — an empty result is uncertainty, not age.
  if ! raw=$(gh api "repos/$REPO/issues/$n/timeline" --paginate \
      --jq '.[] | select(.event=="labeled" and .label.name=="auto:fixing") | .created_at'); then
    echo "  ~ #$n: timeline fetch failed — leaving claim as-is"; continue
  fi
  applied=$(tail -n1 <<<"$raw")
  if [[ -n "$applied" && "$applied" < "$cutoff" ]]; then
    gh pr edit "$n" --repo "$REPO" --remove-label auto:fixing --add-label auto:needs-fixes \
      || echo "  ~ #$n: reclaim failed — will retry next sweep"
  fi
done
echo "AFKFIX_OK sweep done"
```

## Step 2 — Select

```bash
REPO="<owner/repo>"
if ! gh pr list --repo "$REPO" --state open --label auto:needs-fixes --limit 200 --json number,headRefOid; then
  echo "AFKFIX_ABORT could not list auto:needs-fixes PRs (gh error)"; exit 1
fi
```
A gh failure returns empty output, indistinguishable from an empty queue — hence the exit-status guard. If the list is valid but empty, report "no PRs awaiting fixes" and stop. Otherwise **process the PRs one at a time** through Step 3; you are the iteration, so a failure on one PR never aborts the others.

## Step 3 — Per PR

**Per-PR isolation is the rule:** if any step for PR `N` fails, record `#N → error (<reason>)` or escalate it, then move to the next PR. Substitute `N` literally into every block below.

### 3.1 Claim

```bash
REPO="<owner/repo>"; N=<N>
if gh pr edit "$N" --repo "$REPO" --add-label auto:fixing --remove-label auto:needs-fixes; then
  echo "AFKFIX_OK claimed #$N"
else
  echo "AFKFIX_SKIP #$N claim failed — leaving the PR untouched"; exit 1
fi
```
On `AFKFIX_SKIP`, do **not** touch this PR further — record `#N → error (claim)` and move on.

### 3.2 Safety gates, checkout, base fetch

One block: fork rejection, worktree-isolation check, staged-reply cleanup, detached checkout, base fetch. Every gate fails **closed** — the block exits non-zero and prints why; there is no partial state to unwind because nothing is mutated until every gate has passed.

```bash
REPO="<owner/repo>"; N=<N>

# Fork PRs: `gh pr checkout --detach` SUCCEEDS for a fork (it fetches the PR ref), so a checkout
# failure can't catch one — and the publish would then push to origin (the BASE repo), leaving a
# stray branch while the fork's head stays untouched. Fail closed: only a literal `false` proceeds.
ISFORK=$(gh pr view "$N" --repo "$REPO" --json isCrossRepository --jq .isCrossRepository 2>/dev/null)
if [ "$ISFORK" != "false" ]; then
  echo "AFKFIX_ESCALATE cross-fork PR or fork-check failed — no push access to the fork head"; exit 1
fi

# Worktree isolation is a task setting the loop can't read — but its EFFECT is detectable. A linked
# worktree's git-dir is .git/worktrees/<name>; the PRIMARY checkout's git-dir IS the common dir, so
# equal ⇒ the live checkout, where the reset below would IRREVERSIBLY destroy uncommitted work.
# Resolve BOTH with --path-format=absolute: --absolute-git-dir canonicalises symlinks and
# `cd "$(git rev-parse --git-common-dir)" && pwd` does NOT (on macOS /tmp vs /private/tmp then
# never match ⇒ fail-open), and `cd ""` succeeds, defeating an empty check.
absgit=$(git rev-parse --absolute-git-dir 2>/dev/null)
abscommon=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
if [ -z "$absgit" ] || [ -z "$abscommon" ] || [ "$absgit" = "$abscommon" ]; then
  echo "AFKFIX_ESCALATE not an isolated worktree (or git-dir unresolvable) — refusing to reset the live checkout"; exit 1
fi

BASE=$(gh pr view "$N" --repo "$REPO" --json baseRefName --jq .baseRefName 2>/dev/null)
if [ -z "$BASE" ]; then
  echo "AFKFIX_ESCALATE could not resolve the PR's base ref"; exit 1
fi

# Safe to mutate from here: isolated worktree, same-repo PR, base known.
git reset --hard >/dev/null && git clean -fd >/dev/null
# Staged replies live OUTSIDE the worktree, so the reset doesn't clear them — drop any left by a
# prior crashed convergence so this run starts clean. Repo-scoped so two repos' PR #7 can't collide.
rm -f "${TMPDIR:-/tmp}/rpf-pending-$(printf '%s' "$REPO" | tr '/' '__')-$N.json"

# Detached — NEVER the branch: git refuses a branch that's live in another worktree, which in a
# multi-worktree setup is the common case.
if ! gh pr checkout "$N" --repo "$REPO" --detach; then
  echo "AFKFIX_ESCALATE checkout failed"; exit 1
fi
# gh pr checkout fetches the PR ref but NOT the base, and /review --headless diffs origin/<base>.
if ! git fetch origin "$BASE"; then
  echo "AFKFIX_ESCALATE base fetch failed for origin/$BASE"; exit 1
fi

echo "AFKFIX_OK ready base=$BASE head=$(git rev-parse HEAD)"
```

On `AFKFIX_ESCALATE`, go to **Step 4** with the printed reason. On `AFKFIX_OK`, note the printed `base=` — that is `<BASE>` below.

### 3.3 Convergence (max 3 review passes)

Goal: a local `/review --headless` with **no addressable findings**. Count the passes yourself: pass 1 is the round-1 fix plus its review; each further apply-and-review is the next pass; stop at **3 passes total**.

**Pass 1 — address the posted feedback:**
```
Skill: receiving-pr-feedback
args: "<N> --no-publish"
```
It applies fixes, commits locally (each commit carries `[skip-review]` — this loop's own `/review --headless` is the gating review, and calsuite's review-gate hook would otherwise block every non-`.md` commit), stages replies, and pushes nothing. It **never prompts**: if it can't proceed it prints a terminal `receiving-pr-feedback: cannot proceed — …` line — treat that as a failure and **escalate**; never try to answer it.

**Re-review (every pass).** Substitute the literal base printed by 3.2 — write `args: "--headless --base main"`, not `<BASE>` and not `$BASE` (either would reach `/review` as literal text and it would review nothing):
```
Skill: review
args: "--headless --base <BASE>"
```

`--headless` diffs `git diff origin/<BASE>`, prints the findings plus the canonical `^Review complete: PASS|BLOCKED` line, and never prompts, stamps, or posts. **Agent K (reuse & simplification) runs inside this review**, so simplification is covered here — there is deliberately no separate `/improve-architecture` or `/simplify` step (both prompt and have no headless mode). Determine the **addressable** findings: every CRITICAL, plus any INFORMATIONAL clearly relevant to this change or flagging a bug your fixes introduced. Skip subjective style nitpicks. Then:

- **No addressable findings** → **converged**; go to 3.4.
- **Addressable findings, passes remain** → apply them directly (edit + commit locally, commit message carrying `[skip-review]`), then re-review.
- **Addressable findings at pass 3** → **escalate** (Step 4), reason `did not converge in 3 passes`.
- **No recognizable verdict, an error, or a prompt** → **escalate**.

### 3.4 Publish, verify, transition

**Three steps, strictly in this order** — 1 gates 2, so never run them out of order or skip ahead to the `Skill:` call:

**(1) Is there anything to push?** Run this block *first*:

```bash
REPO="<owner/repo>"; N=<N>
# Compare against the head GitHub reports — NOT `origin/<branch>`. `git rev-parse` on an unfetched
# or unresolvable remote-tracking ref prints the literal ref text and exits 128, which compares as
# "different" and would let the publish run on a zero-commit convergence (fail-OPEN). Empty here is
# a read failure, not "no commits", so it escalates rather than publishing.
REMOTE=$(gh pr view "$N" --repo "$REPO" --json headRefOid --jq .headRefOid 2>/dev/null)
if [ -z "$REMOTE" ]; then echo "AFKFIX_ESCALATE could not read the PR head from GitHub"; exit 1; fi
if [ "$(git rev-parse HEAD)" = "$REMOTE" ]; then
  echo "AFKFIX_ESCALATE converged without changing code — nothing to push; needs human adjudication"; exit 1
fi
echo "AFKFIX_OK has-commits local=$(git rev-parse HEAD)"
```

On `AFKFIX_ESCALATE`, go straight to **Step 4** and **do not run `--publish-only`** — a zero-commit convergence means either every finding was pushed back on, or the head was already fixed by an earlier crashed run. Publishing there would re-post staged replies that a crashed run may already have posted (`--publish-only` is consume-once and keeps no per-reply state), and would append a Revision History entry for a run that changed nothing. Neither case may be auto-transitioned either: an unchanged head re-triggers the identical findings and bounces forever.

**(2) Publish** — only after step 1 printed `AFKFIX_OK has-commits`:

```
Skill: receiving-pr-feedback
args: "<N> --publish-only"
```

It pushes `HEAD:<branch>`, and only on a successful push posts the staged replies and updates the PR body. No `/prevent` step: it prompts, files an issue unattended, and its edits would be discarded here anyway.

**(3) Verify and transition** — one block, because the push check and the label move need the same values:

```bash
REPO="<owner/repo>"; N=<N>
LOCAL=$(git rev-parse HEAD)
NEWSHA=$(gh pr view "$N" --repo "$REPO" --json headRefOid --jq .headRefOid 2>/dev/null)

# The push landed iff the remote head is OUR commit — not merely different from where we started.
# A human pushing mid-convergence gets our non-force push rejected and leaves THEIR commit here.
if [ -z "$NEWSHA" ] || [ "$NEWSHA" != "$LOCAL" ]; then
  # Our commit being an ANCESTOR of the remote head means the push DID land and someone committed on
  # top; otherwise our non-force push was rejected and nothing of ours is public. Step 4 reports this.
  if [ -n "$NEWSHA" ] && git merge-base --is-ancestor "$LOCAL" "$NEWSHA" 2>/dev/null; then
    echo "AFKFIX_ESCALATE push landed but the head moved on (remote=$NEWSHA local=$LOCAL) push-landed=yes"
  else
    echo "AFKFIX_ESCALATE publish/push did not land (remote=${NEWSHA:-unknown} local=$LOCAL) push-landed=no"
  fi
  exit 1
fi

# Still ours? Two overlapping runs can both reach here; the loser must not stamp over the winner.
OWN=$(gh pr view "$N" --repo "$REPO" --json labels --jq 'any(.labels[].name; . == "auto:fixing")' 2>/dev/null)
if [ "$OWN" != "true" ]; then
  echo "AFKFIX_SKIP #$N no longer holds auto:fixing (own=${OWN:-fetch-failed}) — leaving the terminal edits to the owner"; exit 1
fi

if gh pr edit "$N" --repo "$REPO" --remove-label auto:fixing --add-label auto:needs-review; then
  echo "AFKFIX_OK #$N -> auto:needs-review at $LOCAL"
else
  echo "AFKFIX_SKIP #$N transition failed — the sweep will reclaim the stale claim"; exit 1
fi
```

On `AFKFIX_ESCALATE`, go to **Step 4** and carry the printed `push-landed=` value into its comment. On `AFKFIX_SKIP`, do nothing further with this PR: the push is already public, so that path is *recoverable, not corrupting* — the claim goes stale, the sweep returns the PR to `auto:needs-fixes`, and the next run re-derives, finds the head already fixed, gets a zero-commit convergence, and escalates for a human to move it on.

## Step 4 — Escalate

Escalation hands the PR to a human and **abandons the local changes unpushed** — never push a half-converged branch. Comment **before** moving the label: if the label moves first and the comment fails, the PR sits at `auto:needs-human` with no reason recorded, and the sweep (which queries `auto:fixing`) can no longer see it.

```bash
REPO="<owner/repo>"; N=<N>
REASON="<one-line reason from the AFKFIX_ESCALATE line>"
# Say what actually happened: "No fixes were pushed." is TRUE for every escalation before 3.4's
# publish step, and FALSE once that push has landed (e.g. a human pushed on top afterwards).
# Read this from 3.4(3)'s printed push-landed= value; every escalation before 3.4(2) is push-landed=no.
PUSH_NOTE="<push-landed=no -> 'No fixes were pushed.' | push-landed=yes -> 'Fix commits were pushed; the transition did not complete.'>"

OWN=$(gh pr view "$N" --repo "$REPO" --json labels --jq 'any(.labels[].name; . == "auto:fixing")' 2>/dev/null)
if [ "$OWN" != "true" ]; then
  echo "AFKFIX_SKIP #$N no longer holds auto:fixing — not escalating over another run"; exit 1
fi
rm -f "${TMPDIR:-/tmp}/rpf-pending-$(printf '%s' "$REPO" | tr '/' '__')-$N.json"
# Gate the label on the comment: ordering alone doesn't hold the invariant. A reason-less
# auto:needs-human is invisible to the sweep (which queries auto:fixing), so on a comment failure
# keep the claim and let the sweep retry.
if ! gh pr comment "$N" --repo "$REPO" --body "afk-fix: escalating to needs-human — $REASON $PUSH_NOTE"; then
  echo "AFKFIX_SKIP #$N could not post the escalation reason — keeping the claim for the sweep to retry"; exit 1
fi
gh pr edit "$N" --repo "$REPO" --remove-label auto:fixing --add-label auto:needs-human
echo "AFKFIX_OK #$N -> auto:needs-human ($REASON)"
```

If the label edit fails after the comment posted, record the error and move on — the sweep reclaims the stranded claim.

## Step 5 — Report

Print one line per PR — `#N → needs-review | needs-human | error (...)` — and the totals. An all-skipped or all-error run is still a clean exit, not a failure.

## Notes

- **The only mutating loop.** You are the single place in the AFK system that edits code and pushes. Every push is a fast-forward to the **PR's own branch** — never `main`, never `--force`. Review and merge/gate never mutate.
- **Stateless.** No completion markers, no saved run state. Every block re-derives from `gh`/`git`; the GitHub label is the only persistent state. A crash costs a redundant convergence, never a corrupted transition.
- **Publish once.** `--no-publish` defers replies/body/push through every convergence pass; `--publish-only` flushes them once at the end. A crash before that leaves nothing pushed — a clean retry.
- **Headless-safe.** Every decision is escalate-not-ask. `/receiving-pr-feedback --no-publish`/`--publish-only` and `/review --headless` are non-interactive by contract; if either prompts or hangs, treat it as a failure and escalate. The loop never invokes a skill without a headless mode (`/improve-architecture`, `/prevent`, interactive `/review`).
- **Prerequisites.** Labels bootstrapped, cwd a checkout of `REPO`, and `/review` + `/receiving-pr-feedback` **installed at versions carrying `--headless` / `--no-publish`** — all verified up front. Worktree isolation must also be on; the loop can't read that setting but detects its effect and refuses to reset a primary checkout.
- **Downstream.** `auto:needs-review` → the review loop re-verifies the pushed fixes and can bounce it back to `auto:needs-fixes` (the review↔fix cycle). `auto:needs-human` → a human; the branch is left unpushed.
