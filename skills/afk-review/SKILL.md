---
name: afk-review
version: 0.3.0
description: |
  afk review loop, autonomous PR review loop, run the review loop, review needs-review PRs,
  afk review cycle. The in-session orchestrator for the AFK review loop: select open PRs
  labelled auto:needs-review, claim each, run /review pr, then advance the label to
  auto:ready or auto:needs-fixes. Headless-safe (never prompts); the GitHub label is the
  state-machine spine. Calsuite-internal — globally symlinked, not distributed per-target.
argument-hint: "[owner/repo]"
allowed-tools:
  - Bash
  - Skill
  - Read
---

# AFK review loop

You are the **review loop** of the AFK autonomous system. You review open pull requests labelled `auto:needs-review`, post a consolidated review on each, and advance the GitHub-label state machine. This runs **unattended** — **never ask the user anything, never wait for input.** Anything you cannot resolve escalates to `auto:needs-human` and you move on. The GitHub **label is the data channel**: exactly one loop owns a PR at a time; you own `auto:needs-review` and your in-flight claim `auto:reviewing`.

## How to execute this skill

**You are the loop — bash is not.** Every ```` ```bash ```` block below runs as its **own shell**, and the `Skill:` call is a **separate process**. Nothing carries across that boundary:

- **A variable set in one block is empty in the next.** Where a block writes `<owner/repo>`, `<LOGIN>`, `<N>`, `<SHA>`, `<VERDICT>` or `<REASON>`, **substitute the literal value**: the repo you resolved, the login the preconditions printed, the PR number you are processing, that PR's `headRefOid` from Step 2, the verdict from 3.4, and a one-line escalation reason.
- **`continue`/`break` outside a `for` loop are not guards.** bash warns and falls through, so the guard fails **open**; zsh aborts the block with no status line. Guards below use `exit 1` inside their own block.
- **Blocks talk to you through stdout.** Every block prints one status line — `AFKREV_OK …`, `AFKREV_SKIP …`, `AFKREV_PROCEED`, `AFKREV_ERROR <reason>`, or `AFKREV_ABORT <reason>` — and **you** act on it per the prose. A block that ends without a status line counts as `AFKREV_ERROR` — except Step 2, whose success output is the PR list as JSON (where `<N>` and `<SHA>` come from) rather than a status line.

## Repo + preconditions

Determine `REPO`: the `owner/repo` passed in the invocation (e.g. `/afk-review ckallum/museli`), else the current directory's remote (`gh repo view --json nameWithOwner --jq .nameWithOwner`).

Then run the **hard preconditions** — one block, so a failure stops the run before any label is touched. If it prints `AFKREV_ABORT`, report that line and **stop**; change nothing. Otherwise report the `running as` line: an unexpected account means the routine's token prefix did not apply. The login it prints is `<LOGIN>` in Step 3.

```bash
REPO="<owner/repo>"   # substitute the resolved value

# /review pr reviews the CURRENT DIRECTORY's repo, so a mismatch would review the wrong PR.
CWD_REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)
if [ "$CWD_REPO" != "$REPO" ]; then
  echo "AFKREV_ABORT cwd repo is '${CWD_REPO:-none}', not '$REPO' — set the task's working folder to a checkout of $REPO"; exit 1
fi

# Labels must exist — `gh pr edit` errors hard on a missing one. Capture gh's exit status so a gh
# outage isn't misread as a missing label. --limit 1000 is gh's max.
if ! have=$(gh label list --repo "$REPO" --limit 1000 --json name --jq '.[].name'); then
  echo "AFKREV_ABORT could not list labels on $REPO (gh error — not a missing-label condition)"; exit 1
fi
for L in auto:needs-review auto:reviewing auto:needs-fixes auto:ready auto:needs-human; do
  echo "$have" | grep -qx "$L" || { echo "AFKREV_ABORT AFK label '$L' missing on $REPO — run: node \"\${CALSUITE_DIR:-\$HOME/Projects/calsuite}/scripts/bootstrap-afk-labels.cjs\" $REPO (that script lives in calsuite, not in this repo)"; exit 1; }
done

# Identity: Step 3 trusts only SHA markers written by this login. AFK_LOOP_LOGIN stands in for
# tokens that can't call /user (GitHub App / Actions tokens), but never contradicts one that can.
# On failure gh still prints the JSON error body to stdout, so keep the exit status.
TOKEN_LOGIN=$(gh api user --jq .login 2>/dev/null) || TOKEN_LOGIN=""
lc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }   # GitHub logins are case-insensitive
if [ -n "$AFK_LOOP_LOGIN" ] && [ -n "$TOKEN_LOGIN" ] && [ "$(lc "$TOKEN_LOGIN")" != "$(lc "$AFK_LOOP_LOGIN")" ]; then
  echo "AFKREV_ABORT AFK_LOOP_LOGIN is $AFK_LOOP_LOGIN but the token authenticates as $TOKEN_LOGIN"; exit 1
fi
LOGIN="${AFK_LOOP_LOGIN:-$TOKEN_LOGIN}"
# Whole-string match: `grep -x` tests each LINE, so a multi-line value would pass it.
case "${LOGIN%\[bot\]}" in ''|*[!A-Za-z0-9-]*)
  echo "AFKREV_ABORT cannot resolve the GitHub login this loop runs as — fix gh auth, or set AFK_LOOP_LOGIN"; exit 1 ;;
esac
# An empty GH_TOKEN silently falls back to gh's active account, which may be read-only here.
# App/Actions installation tokens get no `permissions` object at all: that's unknown, not false.
if ! perm=$(gh api "repos/$REPO" --jq '.permissions.triage // (if .permissions then false else "unknown" end)'); then
  echo "AFKREV_ABORT could not read permissions on $REPO (gh error — not a missing-permission condition)"; exit 1
fi
NOTE=""
[ -n "$TOKEN_LOGIN" ] || NOTE=" (unverified: /user unavailable)"
case "$perm" in
  true) ;;
  unknown) NOTE="$NOTE (triage unverified: no permissions in the repo response)" ;;
  *) echo "AFKREV_ABORT running as $LOGIN, which cannot label PRs on $REPO — check the routine's GH_TOKEN"; exit 1 ;;
esac
echo "AFKREV_OK running as $LOGIN$NOTE"
```

## Step 1 — Age-aware stale-claim sweep

A prior run may have crashed mid-review, leaving a stuck `auto:reviewing` claim. Reset only claims **older than the ~30-min run budget** — a *fresh* claim may belong to a still-running sibling (manual + scheduled runs can overlap), so don't yank it:
```bash
REPO="<owner/repo>"
cutoff=$(date -u -v-30M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '30 minutes ago' +%Y-%m-%dT%H:%M:%SZ)
if ! claimed=$(gh pr list --repo "$REPO" --state open --label auto:reviewing --limit 200 --json number --jq '.[].number'); then
  echo "AFKREV_ERROR sweep skipped (gh error listing auto:reviewing)"; exit 1
fi
reclaimed=0; failed=0; failed_prs=""
# Command substitution, not bare $claimed: zsh doesn't word-split unquoted variables.
for n in $(printf '%s\n' "$claimed"); do
  # Per-page --jq, not --slurp (gh >= 2.95 rejects --slurp with --jq). A failed fetch leaves the
  # claim: never reclaim on uncertainty. Stale means the LATEST auto:reviewing event is a `labeled`
  # older than the cutoff. `[[ < ]]` for the lexical (== chronological) ISO-8601 UTC compare, since
  # POSIX/zsh `[ \< ]` has no `<`. An empty result is uncertainty, not age.
  if ! raw=$(gh api "repos/$REPO/issues/$n/timeline" --paginate \
      --jq '.[] | select((.event=="labeled" or .event=="unlabeled") and .label.name=="auto:reviewing") | "\(.event) \(.created_at)"'); then
    failed=$((failed+1)); failed_prs="$failed_prs #${n}:timeline"; continue
  fi
  last=$(tail -n1 <<<"$raw"); ev=${last%% *}; applied=${last#* }
  [[ "$ev" = labeled && -n "$applied" && "$applied" < "$cutoff" ]] || continue
  # Re-read just before the edit: the claim's owner may have transitioned since the list was taken.
  if ! AUTO=$(gh pr view "$n" --repo "$REPO" --json labels --jq '[.labels[].name | select(. == "auto:needs-review" or . == "auto:reviewing" or . == "auto:needs-fixes" or . == "auto:fixing" or . == "auto:ready" or . == "auto:needs-human")] | sort | join(" ")'); then
    failed=$((failed+1)); failed_prs="$failed_prs #${n}:labels"; continue
  fi
  case " $AUTO " in *" auto:reviewing "*) ;; *) continue ;; esac
  # A lone stale claim goes back to needs-review; one beside another auto:* label (a human's
  # needs-human, a half-applied edit) is dropped so that label owns the PR.
  if [ "$AUTO" = "auto:reviewing" ]; then
    gh pr edit "$n" --repo "$REPO" --remove-label auto:reviewing --add-label auto:needs-review >/dev/null
  else
    gh pr edit "$n" --repo "$REPO" --remove-label auto:reviewing >/dev/null
  fi && reclaimed=$((reclaimed+1)) || { failed=$((failed+1)); failed_prs="$failed_prs #${n}:edit"; }
done
if [ "$failed" -eq 0 ]; then
  echo "AFKREV_OK sweep done reclaimed=$reclaimed"
else
  echo "AFKREV_ERROR sweep incomplete reclaimed=$reclaimed failed=$failed (${failed_prs# })"; exit 1
fi
```
On `AFKREV_ERROR`, keep the line for the Step 5 report and go on to Step 2: a claim the sweep couldn't check or reset is retried next run.

## Step 2 — Select

```bash
REPO="<owner/repo>"
gh pr list --repo "$REPO" --state open --label auto:needs-review --limit 200 --json number,headRefOid \
  || { echo "AFKREV_ABORT could not list auto:needs-review PRs (gh error)"; exit 1; }
```
On `AFKREV_ABORT`, report it and stop. If the list is empty, report "no PRs awaiting review" and stop. Otherwise process each PR (Step 3) with its own `<N>` and `<SHA>` (its `headRefOid`).

## Step 3 — Per PR (isolated)

**Per-PR isolation is the rule:** a failure on one PR must never abort the run or strand a claim. On any `AFKREV_ERROR <reason>`, record `#N → error (<reason>)`, leave its label as-is (Step 1's sweep reclaims a stranded `auto:reviewing` next run), and continue to the next PR.

1. **Guard + SHA-skip.** Skip only a revision **this loop's own login** already reviewed. On a public repo anyone can comment, so a marker from any other author must not count — trusting one would let a stranger stall a PR in `auto:needs-review` forever.
   ```bash
   REPO="<owner/repo>"; N=<N>; SHA="<SHA>"; LOGIN='<LOGIN>'
   # - Exact body match, so review prose that quotes the marker doesn't count.
   # - REST issues/comments reports bots as `name[bot]`, the form the preconditions print; GraphQL drops it.
   # - Logins compare case-insensitively (GitHub's are). A marker edited after posting doesn't count:
   #   maintainers can edit anyone's comment, and merge/gate applies the same rule.
   # - LOGIN and SHA are validated before being spliced into the jq program (gh --jq has no --arg).
   # - Any lookup failure is AFKREV_ERROR, never a skip.
   # Whole-string matches: `grep -x` tests each LINE, so a multi-line value would pass it.
   case "$SHA" in *[!0-9a-f]*|'') echo "AFKREV_ERROR no valid head sha ('$SHA')"; exit 1 ;; esac
   [ "${#SHA}" -eq 40 ] || { echo "AFKREV_ERROR no valid head sha ('$SHA')"; exit 1; }
   case "${LOGIN%\[bot\]}" in ''|*[!A-Za-z0-9-]*)
     echo "AFKREV_ERROR no valid login ('$LOGIN') — substitute the login the preconditions printed"; exit 1 ;;
   esac
   LC_LOGIN=$(printf '%s' "$LOGIN" | tr '[:upper:]' '[:lower:]')
   M="<!-- afk-review reviewed sha=$SHA"
   if ! hits=$(gh api "repos/$REPO/issues/$N/comments" --paginate --jq ".[] | select(((.user.login // \"\") | ascii_downcase) == \"$LC_LOGIN\" and .updated_at == .created_at and (.body == \"$M -->\" or .body == \"$M verdict=ready -->\" or .body == \"$M verdict=needs-fixes -->\")) | .id"); then
     echo "AFKREV_ERROR comments fetch failed"; exit 1
   fi
   if [ -n "$hits" ]; then echo "AFKREV_SKIP sha=$SHA already reviewed by $LOGIN"; else echo "AFKREV_PROCEED"; fi
   ```
   `AFKREV_SKIP` → record `#N → skipped (unchanged)` and continue. `AFKREV_PROCEED` → claim (step 2).

2. **Claim** (first state change, so a second run finds nothing to grab). If the claim fails, do **not** review an unclaimed PR.
   ```bash
   REPO="<owner/repo>"; N=<N>
   # Re-read first: Step 2's list may be stale, and `gh pr edit --remove-label` succeeds on an
   # absent label, so claiming a PR another run has moved on would stack a second auto:* label.
   if ! AUTO=$(gh pr view "$N" --repo "$REPO" --json labels --jq '[.labels[].name | select(. == "auto:needs-review" or . == "auto:reviewing" or . == "auto:needs-fixes" or . == "auto:fixing" or . == "auto:ready" or . == "auto:needs-human")] | sort | join(" ")'); then
     echo "AFKREV_ERROR claim label read failed"; exit 1
   fi
   if [ "$AUTO" != "auto:needs-review" ]; then
     echo "AFKREV_SKIP not claimable (auto labels: '$AUTO')"; exit 0
   fi
   if gh pr edit "$N" --repo "$REPO" --add-label auto:reviewing --remove-label auto:needs-review >/dev/null; then
     echo "AFKREV_OK claimed"
   else
     echo "AFKREV_ERROR claim"; exit 1
   fi
   ```
   `AFKREV_SKIP` → record `#N → skipped (moved on)` and continue; another run or a human owns it now.

3. **Review.** Use the Skill tool to run the real review in PR mode:
   ```
   Skill: review
   args: "pr <N>"
   ```
   PR mode posts ONE consolidated comment and is non-interactive. **It must never prompt you** — if `/review` ever asks a question or appears to wait for input, that is a bug; do **not** answer it. Treat any prompt, hang, or crash as a review failure (escalate, Step 4).

4. **Read the verdict** from `/review`'s final output. Match its **canonical summary line**, not a bare substring (a findings body can contain the word "BLOCKED"):
   - a line matching `^Review complete: BLOCKED` → `<VERDICT>` is **needs-fixes**
   - else a line matching `^Review complete: PASS` → `<VERDICT>` is **ready**
   - else if the output contains `not eligible for review` (draft / closed / trivial PR) → **not a failure**. Release the claim so the PR is re-checked once eligible, write **no** SHA marker, and record `#N → skipped (not eligible)`:
     ```bash
     REPO="<owner/repo>"; N=<N>
     if ! OWN=$(gh pr view "$N" --repo "$REPO" --json labels --jq '[.labels[].name | select(. == "auto:needs-review" or . == "auto:reviewing" or . == "auto:needs-fixes" or . == "auto:fixing" or . == "auto:ready" or . == "auto:needs-human")] | sort | join(" ")'); then
       echo "AFKREV_ERROR claim check failed"; exit 1
     fi
     [ "$OWN" = "auto:reviewing" ] || { echo "AFKREV_ERROR lost claim (auto labels: '$OWN') — not releasing"; exit 1; }
     if gh pr edit "$N" --repo "$REPO" --remove-label auto:reviewing --add-label auto:needs-review >/dev/null; then
       echo "AFKREV_OK released (not eligible)"
     else
       echo "AFKREV_ERROR release"; exit 1
     fi
     ```
   - else (no recognizable verdict / it errored / it prompted) → **escalate** (Step 4).

5. **Transition + mark** — one block, so a marker can only ever follow a successful transition (a failed transition plus a written marker would strand the PR in `auto:reviewing` *and* SHA-skipped). `<SHA>` is Step 2's head. `/review pr` diffs whatever the head is when it runs, so the marker is written only if the head is **still** `<SHA>` after the review — it never names a revision the review might not have seen. A missing marker costs a re-review, or an escalation if the gate already bounced that SHA.
   ```bash
   REPO="<owner/repo>"; N=<N>; SHA="<SHA>"; VERDICT="<VERDICT>"
   case "$VERDICT" in ready|needs-fixes) ;; *) echo "AFKREV_ERROR bad verdict '$VERDICT'"; exit 1 ;; esac
   # Still ours, and only ours? A sibling's sweep resets a claim held past its cutoff, and a human
   # may add auto:needs-human mid-review; transitioning then would stack two auto:* labels.
   if ! OWN=$(gh pr view "$N" --repo "$REPO" --json labels --jq '[.labels[].name | select(. == "auto:needs-review" or . == "auto:reviewing" or . == "auto:needs-fixes" or . == "auto:fixing" or . == "auto:ready" or . == "auto:needs-human")] | sort | join(" ")'); then
     echo "AFKREV_ERROR claim check failed"; exit 1
   fi
   [ "$OWN" = "auto:reviewing" ] || { echo "AFKREV_ERROR lost claim (auto labels: '$OWN') — not transitioning"; exit 1; }
   if ! gh pr edit "$N" --repo "$REPO" --remove-label auto:reviewing --add-label "auto:$VERDICT" >/dev/null; then
     echo "AFKREV_ERROR transition"; exit 1
   fi
   # The verdict lets merge/gate tell a PASS from a BLOCKED review at the same SHA.
   # Re-read labels first, whatever the head: a writer landing alongside the transition (a sweep's
   # reset, a human's needs-human) leaves two auto:* labels. Yield ours so one owner remains; a
   # marker on top would SHA-skip a PR sitting in auto:needs-review.
   if ! AUTO=$(gh pr view "$N" --repo "$REPO" --json labels --jq '[.labels[].name | select(. == "auto:needs-review" or . == "auto:reviewing" or . == "auto:needs-fixes" or . == "auto:fixing" or . == "auto:ready" or . == "auto:needs-human")] | sort | join(" ")' 2>/dev/null); then
     echo "AFKREV_OK auto:$VERDICT marked=none (label read failed)"; exit 0
   fi
   if [ "$AUTO" != "auto:$VERDICT" ]; then
     # Two overlapping runs reaching opposite verdicts would each yield its own label and leave none.
     both=no; case " $AUTO " in *" auto:needs-fixes "*) case " $AUTO " in *" auto:ready "*) both=yes ;; esac ;; esac
     if [ "$both" = yes ]; then
       if gh pr edit "$N" --repo "$REPO" --add-label auto:needs-human --remove-label auto:ready --remove-label auto:needs-fixes >/dev/null; then
         echo "AFKREV_ERROR conflicting verdicts from overlapping runs (auto labels: '$AUTO') — moved to auto:needs-human, no marker"; exit 1
       fi
       echo "AFKREV_ERROR conflicting verdicts from overlapping runs (auto labels: '$AUTO') — no marker"; exit 1
     fi
     case " $AUTO " in *" auto:$VERDICT "*)
       if gh pr edit "$N" --repo "$REPO" --remove-label "auto:$VERDICT" >/dev/null; then
         echo "AFKREV_ERROR labels changed under the transition (auto labels: '$AUTO') — removed auto:$VERDICT, no marker"; exit 1
       fi ;;
     esac
     echo "AFKREV_ERROR labels changed under the transition (auto labels: '$AUTO') — no marker"; exit 1
   fi
   MARK=""
   case "$SHA" in *[!0-9a-f]*|'') MARK="none (invalid sha)" ;; *) [ "${#SHA}" -eq 40 ] || MARK="none (invalid sha)" ;; esac
   if [ -z "$MARK" ]; then
     if ! HEAD_NOW=$(gh pr view "$N" --repo "$REPO" --json headRefOid --jq .headRefOid 2>/dev/null); then
       MARK="none (head read failed)"
     elif [ "$HEAD_NOW" != "$SHA" ]; then
       MARK="none (head moved)"
     elif ! gh pr comment "$N" --repo "$REPO" --body "<!-- afk-review reviewed sha=$SHA verdict=$VERDICT -->" >/dev/null; then
       MARK="none (comment failed)"
     else
       MARK="$SHA"
     fi
   fi
   echo "AFKREV_OK auto:$VERDICT marked=$MARK"
   ```
   - `AFKREV_ERROR labels changed … — removed auto:<V>, no marker` → record the error: another writer landed alongside the transition, and the block dropped its own verdict label so the other label owns the PR.
   - `AFKREV_ERROR labels changed … — no marker` (nothing removed) → record the error and flag it for a human in the report: the PR may carry two `auto:*` labels, or none.
   - `AFKREV_ERROR conflicting verdicts … — moved to auto:needs-human` → record the error: two overlapping runs disagreed, and the PR now waits for a human. If the line ends `— no marker` instead, the move failed and a human should check the labels.
   - `AFKREV_OK` → record `#N → ready` or `#N → needs-fixes`. When `marked=none`, add its reason to the line (`#N → ready (unmarked: head moved)`): the verdict label is on, but no marker binds it to a revision. Once merge/gate is built, an unmarked head goes back for review: the gate bounces it once, and escalates it to needs-human if it already bounced that SHA.

## Step 4 — Escalate on failure

Comment **before** the label move: if the label moved first and the comment failed, the PR would sit at needs-human with no reason, and the sweep (which queries `auto:reviewing`) could no longer see it. Replace the `<REASON>` line with one line of plain text (any characters, but not the line `AFKREV_REASON`); the quoted heredoc keeps the shell from interpreting it.
```bash
REPO="<owner/repo>"; N=<N>
IFS= read -r REASON <<'AFKREV_REASON'
<REASON>
AFKREV_REASON
case "$REASON" in ''|'<'*'>') echo "AFKREV_ERROR no escalation reason"; exit 1 ;; esac
# Still ours? An overlapping run may already have moved this PR; adding auto:needs-human on top of
# its label would leave two set.
# Presence, not the exact set: escalating is safe from any stacked state. It drops the claim and adds
# auto:needs-human, which every other check treats as the owner.
if ! OWN=$(gh pr view "$N" --repo "$REPO" --json labels --jq 'any(.labels[].name; . == "auto:reviewing")' 2>/dev/null); then
  echo "AFKREV_ERROR claim check failed"; exit 1
fi
[ "$OWN" = "true" ] || { echo "AFKREV_ERROR lost claim — another run owns it, not escalating"; exit 1; }
gh pr comment "$N" --repo "$REPO" --body "afk-review: escalating to needs-human — $REASON" >/dev/null \
  || { echo "AFKREV_ERROR escalation comment failed"; exit 1; }
gh pr edit "$N" --repo "$REPO" --remove-label auto:reviewing --add-label auto:needs-human >/dev/null \
  || { echo "AFKREV_ERROR escalation label move failed"; exit 1; }
echo "AFKREV_OK needs-human"
```
On `AFKREV_ERROR`, record the error and continue — Step 1's sweep reclaims the stranded claim next run.

## Step 5 — Report

Print the sweep's status line, then one line per PR — `#N → ready | needs-fixes | needs-human | skipped (unchanged|moved on|not eligible) | error (...)`, with any `(unmarked: …)` note from 3.5 — and the totals. An all-skipped or all-error run is still a clean exit, not a failure. Make no other changes.

## Notes

- **Headless-safe.** Every action is `gh`/label work or `/review pr` (non-interactive PR mode). Never call AskUserQuestion; never wait for input. On uncertainty the move is *escalate*, never *ask*.
- **Idempotent + crash-safe.** The claim label, the age-aware sweep, and the SHA marker mean a re-run — or recovery after a crash mid-PR — does no double work and never permanently strands a PR.
- **The SHA marker is authenticated.** It counts only when its author is this loop's own login and its body is exactly `<!-- afk-review reviewed sha=<40 hex>[ verdict=ready|needs-fixes] -->`. Any doubt means review again, never skip. Every run of the review loop on a repo must use the same login — it both writes and reads the marker — and merge/gate's `AFK_LOOP_LOGIN` must name that login.
- **Prerequisites.** Labels must be bootstrapped (`scripts/bootstrap-afk-labels.cjs`), the working folder must be a checkout of `REPO`, and the token must be able to label PRs. All are checked up front.
- **Downstream.** `auto:needs-fixes` → the fix loop (`/afk-fix`). `auto:ready` → the merge/gate loop, specified in `.claude/specs/afk-merge-gate/` and not yet built — until then `auto:ready` PRs sit for a human.
