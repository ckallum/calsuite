---
name: afk-review
version: 0.2.2
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

## Repo + preconditions

Determine `REPO`: the `owner/repo` passed in the invocation (e.g. `/afk-review ckallum/museli`), else the current directory's remote (`gh repo view --json nameWithOwner --jq .nameWithOwner`).

Then run these two **hard preconditions** — both must pass before any label is touched:

1. **cwd must be a checkout of `REPO`.** `/review pr` (below) reviews the *current directory's* repo, so a mismatch would review the wrong PR. This is an environment fault, not a per-PR fault — exit cleanly **without changing any labels**:
   ```bash
   CWD_REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)
   [ "$CWD_REPO" = "$REPO" ] || { echo "afk-review: cwd repo is '${CWD_REPO:-none}', not '$REPO' — set the task's working folder to a checkout of $REPO. No changes made."; exit 0; }
   ```
2. **AFK labels must exist** (`gh pr edit --add-label` errors hard if a label is missing — bootstrap is a required one-time setup):
   ```bash
   have=$(gh label list --repo "$REPO" --limit 200 --json name --jq '.[].name')
   for L in auto:needs-review auto:reviewing auto:needs-fixes auto:ready auto:needs-human; do
     echo "$have" | grep -qx "$L" || { echo "afk-review: AFK label '$L' missing on $REPO — run: node scripts/bootstrap-afk-labels.cjs $REPO"; exit 1; }
   done
   ```

## Step 1 — Age-aware stale-claim sweep

A prior run may have crashed mid-review, leaving a stuck `auto:reviewing` claim. Reset only claims **older than the ~30-min run budget** — a *fresh* claim may belong to a still-running sibling (manual + scheduled runs can overlap), so don't yank it:
```bash
cutoff=$(date -u -v-30M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '30 minutes ago' +%Y-%m-%dT%H:%M:%SZ)
for n in $(gh pr list --repo "$REPO" --state open --label auto:reviewing --json number --jq '.[].number'); do
  # --slurp folds all timeline pages into one array so jq runs once (plain
  # --paginate runs jq per page and emits a `null` per page, corrupting the
  # comparison on long timelines). On a fetch FAILURE (rate-limit / auth /
  # network) leave the claim alone — never reclaim on uncertainty, or a claim a
  # still-running sibling legitimately holds gets yanked.
  applied=$(gh api "repos/$REPO/issues/$n/timeline" --paginate --slurp --jq 'add | [.[] | select(.event=="labeled" and .label.name=="auto:reviewing") | .created_at] | last') \
    || { echo "  ~ #$n: timeline fetch failed — leaving claim as-is"; continue; }
  if [ -z "$applied" ] || [ "$applied" = "null" ] || [ "$applied" \< "$cutoff" ]; then
    gh pr edit "$n" --repo "$REPO" --remove-label auto:reviewing --add-label auto:needs-review || true
  fi
done
```

## Step 2 — Select

```bash
gh pr list --repo "$REPO" --state open --label auto:needs-review --json number,headRefOid,title
```
If empty, report "no PRs awaiting review" and stop. Otherwise process each PR (Step 3).

## Step 3 — Per PR (isolated)

**Per-PR isolation is the rule:** a failure on one PR must never abort the run or strand a claim. If any `gh` command for PR `N` fails, record `#N → error (<reason>)`, leave its label as-is (Step 1's sweep reclaims a stranded `auto:reviewing` next run), and continue to the next PR.

For PR `N` with head `SHA` (`headRefOid` from Step 2):

1. **Guard + SHA-skip.** If `SHA` is empty, record `#N → error (no head sha)` and continue. Else, if you already reviewed this exact revision (`gh pr view "$N" --repo "$REPO" --json comments --jq '.comments[].body' | grep -qF "afk-review reviewed sha=$SHA"`), record `#N → skipped (unchanged)` and continue.

2. **Claim** (first state change, so a second run finds nothing to grab):
   ```bash
   gh pr edit "$N" --repo "$REPO" --add-label auto:reviewing --remove-label auto:needs-review
   ```
   If the claim **fails**, do **not** review an unclaimed PR — record `#N → error (claim)` and continue.

3. **Review.** Use the Skill tool to run the real review in PR mode:
   ```
   Skill: review
   args: "pr <N>"
   ```
   PR mode posts ONE consolidated comment and is non-interactive. **It must never prompt you** — if `/review` ever asks a question or appears to wait for input, that is a bug; do **not** answer it. Treat any prompt, hang, or crash as a review failure (escalate, Step 4).

4. **Read the verdict** from `/review`'s final output. Match its **canonical summary line**, not a bare substring (a findings body can contain the word "BLOCKED"):
   - a line matching `^Review complete: BLOCKED` → **needs-fixes**
   - else a line matching `^Review complete: PASS` → **ready**
   - else if the output contains `not eligible for review` (draft / closed / trivial PR) → **not a failure**: release the claim back so it's re-checked when it becomes eligible — `gh pr edit "$N" --repo "$REPO" --remove-label auto:reviewing --add-label auto:needs-review` (write **no** SHA marker), record `#N → skipped (not eligible)`, continue.
   - else (no recognizable verdict / it errored / it prompted) → **escalate** (Step 4).

5. **Transition + mark** (ready / needs-fixes):
   ```bash
   gh pr edit "$N" --repo "$REPO" --remove-label auto:reviewing --add-label auto:ready       # PASS
   gh pr edit "$N" --repo "$REPO" --remove-label auto:reviewing --add-label auto:needs-fixes  # BLOCKED
   ```
   If the transition `gh pr edit` **fails**, record `#N → error (transition)` and **do not** write the marker (a failed transition + written marker would strand the PR in `auto:reviewing` *and* SHA-skipped forever). Otherwise, write the marker with **`$SHA`** — the revision you actually reviewed (captured at selection). Do **not** re-read the current head: if the PR advanced during the review, marking the newer SHA would make the next run skip commits you never reviewed; marking the reviewed SHA only ever risks a harmless re-review.
   ```bash
   gh pr comment "$N" --repo "$REPO" --body "<!-- afk-review reviewed sha=$SHA -->"
   ```

## Step 4 — Escalate on failure

```bash
gh pr edit "$N" --repo "$REPO" --remove-label auto:reviewing --add-label auto:needs-human
gh pr comment "$N" --repo "$REPO" --body "afk-review: escalating to needs-human — <one-line reason>."
```
If either call fails, record the error and continue — Step 1's sweep reclaims the stranded claim next run.

## Step 5 — Report

Print one line per PR — `#N → ready | needs-fixes | needs-human | skipped (unchanged|not eligible) | error (...)` — and the totals. An all-skipped or all-error run is still a clean exit, not a failure. Make no other changes.

## Notes

- **Headless-safe.** Every action is `gh`/label work or `/review pr` (non-interactive PR mode). Never call AskUserQuestion; never wait for input. On uncertainty the move is *escalate*, never *ask*.
- **Idempotent + crash-safe.** The claim label, the age-aware sweep, and the SHA marker mean a re-run — or recovery after a crash mid-PR — does no double work and never permanently strands a PR.
- **Prerequisites.** Labels must be bootstrapped (`scripts/bootstrap-afk-labels.cjs`) and the working folder must be a checkout of `REPO`. Both are checked up front.
- **Downstream.** `auto:ready` → merge/gate loop; `auto:needs-fixes` → fix loop (Phases 3–4). Until those exist they sit for a human — intended; this loop only reviews and labels.
