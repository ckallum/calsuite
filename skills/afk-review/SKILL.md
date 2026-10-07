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

- **A variable set in one block is empty in the next.** Where a block writes `<owner/repo>`, `<N>`, `<SHA>`, `<VERDICT>` or `<REASON>`, **substitute the literal value**: the repo you resolved, the PR number you are processing, that PR's `headRefOid` from Step 2, the verdict from 3.4, and a one-line escalation reason.
- **`continue`/`break` outside a `for` loop are not guards.** bash warns and falls through, so the guard fails **open**; zsh aborts the block with no status line. Guards below use `exit 1` inside their own block.
- **Blocks talk to you through stdout.** Every block prints one status line — `AFKREV_OK …`, `AFKREV_SKIP …`, `AFKREV_PROCEED`, `AFKREV_ERROR <reason>`, or `AFKREV_ABORT <reason>` — and **you** act on it per the prose. Step 2 also prints the PR list as JSON, which is where `<N>` and `<SHA>` come from. A block that ends without a status line counts as `AFKREV_ERROR`.

## Repo + preconditions

Determine `REPO`: the `owner/repo` passed in the invocation (e.g. `/afk-review ckallum/museli`), else the current directory's remote (`gh repo view --json nameWithOwner --jq .nameWithOwner`).

Then run the **hard preconditions** — one block, so a failure stops the run before any label is touched. If it prints `AFKREV_ABORT`, report that line and **stop**; change nothing. Otherwise report the `running as` line: an unexpected account means the routine's token prefix did not apply.

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
if [ -n "$AFK_LOOP_LOGIN" ] && [ -n "$TOKEN_LOGIN" ] && [ "$TOKEN_LOGIN" != "$AFK_LOOP_LOGIN" ]; then
  echo "AFKREV_ABORT AFK_LOOP_LOGIN is $AFK_LOOP_LOGIN but the token authenticates as $TOKEN_LOGIN"; exit 1
fi
LOGIN="${AFK_LOOP_LOGIN:-$TOKEN_LOGIN}"
# Whole-string match: `grep -x` tests each LINE, so a multi-line value would pass it.
case "${LOGIN%\[bot\]}" in ''|*[!A-Za-z0-9-]*)
  echo "AFKREV_ABORT cannot resolve the GitHub login this loop runs as — fix gh auth, or set AFK_LOOP_LOGIN"; exit 1 ;;
esac
# An empty GH_TOKEN silently falls back to gh's active account, which may be read-only here.
if ! perm=$(gh api "repos/$REPO" --jq '.permissions.triage // false'); then
  echo "AFKREV_ABORT could not read permissions on $REPO (gh error — not a missing-permission condition)"; exit 1
fi
if [ "$perm" != "true" ]; then
  echo "AFKREV_ABORT running as $LOGIN, which cannot label PRs on $REPO — check the routine's GH_TOKEN"; exit 1
fi
if [ -n "$TOKEN_LOGIN" ]; then echo "AFKREV_OK running as $LOGIN"; else echo "AFKREV_OK running as $LOGIN (unverified: /user unavailable)"; fi
```

## Step 1 — Age-aware stale-claim sweep

A prior run may have crashed mid-review, leaving a stuck `auto:reviewing` claim. Reset only claims **older than the ~30-min run budget** — a *fresh* claim may belong to a still-running sibling (manual + scheduled runs can overlap), so don't yank it:
```bash
REPO="<owner/repo>"
cutoff=$(date -u -v-30M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '30 minutes ago' +%Y-%m-%dT%H:%M:%SZ)
if ! claimed=$(gh pr list --repo "$REPO" --state open --label auto:reviewing --limit 200 --json number --jq '.[].number'); then
  echo "AFKREV_OK sweep skipped (gh error listing auto:reviewing)"; exit 0
fi
# Command substitution, not bare $claimed: zsh doesn't word-split unquoted variables, so with 2+
# stranded claims the loop would run once with every number on one line.
for n in $(printf '%s\n' "$claimed"); do
  # Per-page --jq, NOT --slurp: gh >= 2.95 rejects `--slurp` together with
  # `--jq` and exits 1 — which the `|| continue` below would swallow on every
  # PR, turning the whole sweep into a silent no-op (so a crashed run's claim is
  # never reclaimed). Applied per page, the filter streams one created_at per
  # matching `labeled auto:reviewing` event across all pages in chronological
  # order; `tail -n1` is the most recent application. Capture gh on its own line
  # so a real fetch FAILURE (rate-limit / auth / network) still trips `||` —
  # never reclaim on uncertainty, or a claim a still-running sibling legitimately
  # holds gets yanked.
  raw=$(gh api "repos/$REPO/issues/$n/timeline" --paginate \
    --jq '.[] | select(.event=="labeled" and .label.name=="auto:reviewing") | .created_at') \
    || { echo "  ~ #$n: timeline fetch failed — leaving claim as-is"; continue; }
  applied=$(tail -n1 <<<"$raw")
  # Lexical timestamp comparison must use [[ < ]] (bash/zsh keyword), not
  # [ \< ] — POSIX `test`/`[` has no `<` operator, and under zsh `[ "$a" \< ... ]`
  # errors out and the failed test reads as "leave the claim", so no stale claim
  # is ever reclaimed. ISO-8601 UTC strings sort lexically == chronologically.
  # Reclaim only with a timestamp older than the cutoff — an empty result is a successful fetch
  # with no labeled event (e.g. read-replica lag), i.e. uncertainty, and must leave the claim.
  if [[ -n "$applied" && "$applied" < "$cutoff" ]]; then
    gh pr edit "$n" --repo "$REPO" --remove-label auto:reviewing --add-label auto:needs-review >/dev/null \
      || echo "  ~ #$n: reclaim failed — will retry next sweep"
  fi
done
echo "AFKREV_OK sweep done"
```

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
   REPO="<owner/repo>"; N=<N>; SHA="<SHA>"
   # - Exact body match, so review prose that quotes the marker doesn't count.
   # - REST on both sides: /user and issues/comments both report bots as `name[bot]`; GraphQL drops it.
   # - LOGIN and SHA are validated before being spliced into the jq program (gh --jq has no --arg).
   # - Any lookup failure is AFKREV_ERROR, never a skip.
   # Whole-string matches: `grep -x` tests each LINE, so a multi-line value would pass it.
   case "$SHA" in *[!0-9a-f]*|'') echo "AFKREV_ERROR no valid head sha ('$SHA')"; exit 1 ;; esac
   [ "${#SHA}" -eq 40 ] || { echo "AFKREV_ERROR no valid head sha ('$SHA')"; exit 1; }
   LOGIN="${AFK_LOOP_LOGIN:-$(gh api user --jq .login 2>/dev/null)}"
   case "${LOGIN%\[bot\]}" in ''|*[!A-Za-z0-9-]*)
     echo "AFKREV_ERROR cannot resolve this loop's GitHub login"; exit 1 ;;
   esac
   M="<!-- afk-review reviewed sha=$SHA"
   if ! hits=$(gh api "repos/$REPO/issues/$N/comments" --paginate --jq ".[] | select(.user.login == \"$LOGIN\" and (.body == \"$M -->\" or .body == \"$M verdict=ready -->\" or .body == \"$M verdict=needs-fixes -->\")) | .id"); then
     echo "AFKREV_ERROR comments fetch failed"; exit 1
   fi
   if [ -n "$hits" ]; then echo "AFKREV_SKIP sha=$SHA already reviewed by $LOGIN"; else echo "AFKREV_PROCEED"; fi
   ```
   `AFKREV_SKIP` → record `#N → skipped (unchanged)` and continue. `AFKREV_PROCEED` → claim (step 2).

2. **Claim** (first state change, so a second run finds nothing to grab). If the claim fails, do **not** review an unclaimed PR.
   ```bash
   REPO="<owner/repo>"; N=<N>
   if gh pr edit "$N" --repo "$REPO" --add-label auto:reviewing --remove-label auto:needs-review >/dev/null; then
     echo "AFKREV_OK claimed"
   else
     echo "AFKREV_ERROR claim"; exit 1
   fi
   ```

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
     if gh pr edit "$N" --repo "$REPO" --remove-label auto:reviewing --add-label auto:needs-review >/dev/null; then
       echo "AFKREV_OK released (not eligible)"
     else
       echo "AFKREV_ERROR release"; exit 1
     fi
     ```
   - else (no recognizable verdict / it errored / it prompted) → **escalate** (Step 4).

5. **Transition + mark** — one block, so a marker can only ever follow a successful transition (a failed transition plus a written marker would strand the PR in `auto:reviewing` *and* SHA-skipped). `<SHA>` is Step 2's head. `/review pr` diffs whatever the head is when it runs, so the marker is written only if the head is **still** `<SHA>` after the review — it never names a revision the review might not have seen. A missing marker costs at most one re-review.
   ```bash
   REPO="<owner/repo>"; N=<N>; SHA="<SHA>"; VERDICT="<VERDICT>"
   case "$VERDICT" in ready|needs-fixes) ;; *) echo "AFKREV_ERROR bad verdict '$VERDICT'"; exit 1 ;; esac
   if ! gh pr edit "$N" --repo "$REPO" --remove-label auto:reviewing --add-label "auto:$VERDICT" >/dev/null; then
     echo "AFKREV_ERROR transition"; exit 1
   fi
   # The verdict lets merge/gate tell a PASS from a BLOCKED review at the same SHA.
   SHA_OK=no
   case "$SHA" in *[!0-9a-f]*|'') ;; *) [ "${#SHA}" -eq 40 ] && SHA_OK=yes ;; esac
   HEAD_NOW=$(gh pr view "$N" --repo "$REPO" --json headRefOid --jq .headRefOid 2>/dev/null)
   if [ "$SHA_OK" = yes ] && [ "$HEAD_NOW" = "$SHA" ] \
      && gh pr comment "$N" --repo "$REPO" --body "<!-- afk-review reviewed sha=$SHA verdict=$VERDICT -->" >/dev/null; then
     echo "AFKREV_OK auto:$VERDICT marked=$SHA"
   else
     echo "AFKREV_OK auto:$VERDICT marked=none"
   fi
   ```
   `AFKREV_OK` → record `#N → ready` or `#N → needs-fixes`.

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
OWN=$(gh pr view "$N" --repo "$REPO" --json labels --jq 'any(.labels[].name; . == "auto:reviewing")' 2>/dev/null)
if [ "$OWN" != "true" ]; then
  echo "AFKREV_ERROR lost claim — another run owns it, not escalating"; exit 1
fi
gh pr comment "$N" --repo "$REPO" --body "afk-review: escalating to needs-human — $REASON" >/dev/null \
  || { echo "AFKREV_ERROR escalation comment failed"; exit 1; }
gh pr edit "$N" --repo "$REPO" --remove-label auto:reviewing --add-label auto:needs-human >/dev/null \
  || { echo "AFKREV_ERROR escalation label move failed"; exit 1; }
echo "AFKREV_OK needs-human"
```
On `AFKREV_ERROR`, record the error and continue — Step 1's sweep reclaims the stranded claim next run.

## Step 5 — Report

Print one line per PR — `#N → ready | needs-fixes | needs-human | skipped (unchanged|not eligible) | error (...)` — and the totals. An all-skipped or all-error run is still a clean exit, not a failure. Make no other changes.

## Notes

- **Headless-safe.** Every action is `gh`/label work or `/review pr` (non-interactive PR mode). Never call AskUserQuestion; never wait for input. On uncertainty the move is *escalate*, never *ask*.
- **Idempotent + crash-safe.** The claim label, the age-aware sweep, and the SHA marker mean a re-run — or recovery after a crash mid-PR — does no double work and never permanently strands a PR.
- **The SHA marker is authenticated.** It counts only when its author is this loop's own login and its body is exactly `<!-- afk-review reviewed sha=<40 hex>[ verdict=ready|needs-fixes] -->`. Any doubt means review again, never skip. Every run of the review loop on a repo must use the same login — it both writes and reads the marker — and merge/gate's `AFK_LOOP_LOGIN` must name that login.
- **Prerequisites.** Labels must be bootstrapped (`scripts/bootstrap-afk-labels.cjs`), the working folder must be a checkout of `REPO`, and the token must be able to label PRs. All are checked up front.
- **Downstream.** `auto:needs-fixes` → the fix loop (`/afk-fix`). `auto:ready` → the merge/gate loop, specified in `.claude/specs/afk-merge-gate/` and not yet built — until then `auto:ready` PRs sit for a human.
