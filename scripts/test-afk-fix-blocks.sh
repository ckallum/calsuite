#!/usr/bin/env bash
# Execution harness for skills/afk-fix/SKILL.md — run: scripts/test-afk-fix-blocks.sh
# Runs each shipped ```bash block as its OWN process against a real git repo + stub gh,
# which is the only way to catch cross-block state loss, continue-fallthrough, and
# guards that fail open. Asserts on the block's printed status line.
SKILL="${1:-$(dirname "$0")/../skills/afk-fix/SKILL.md}"
[ -f "$SKILL" ] || { echo "usage: test-afk-fix-blocks.sh [path to afk-fix SKILL.md]"; exit 2; }
# absolute — the harness cd's into its sandbox, so a relative path would break mid-run
SKILL=$(cd "$(dirname "$SKILL")" && pwd)/$(basename "$SKILL")
command -v jq >/dev/null 2>&1 || { echo "jq is required (the gh stub evaluates --jq with it)"; exit 2; }
ROOT=$(mktemp -d "${TMPDIR:-/tmp}/afk-fix-blocks.XXXXXX")
trap 'rm -rf "$ROOT"' EXIT
PASS=0; FAIL=0
say() { printf '%s\n' "$*"; }
ok()   { PASS=$((PASS+1)); say "  PASS  $1"; }
bad()  { FAIL=$((FAIL+1)); say "  FAIL  $1"; say "        got: $2"; }

# --- extract the Nth ```bash block verbatim from the skill ---
block() { awk -v want="$1" '/^```bash$/{inb=1;n++;next} /^```$/{if(inb)inb=0;next} inb&&n==want{print}' "$SKILL"; }

# --- stub gh: behaviour driven by env ---
# - Every call → $GH_CALLS; successful edits and comments → $GH_LOG; the last comment's --body → $GH_BODY.
# - `api` (timeline) and `pr view --json labels` run the block's --jq through real jq; other reads are canned.
# - GH_TIMELINE: space-separated `labeled@<ts>` / `unlabeled@<ts>` auto:fixing events, oldest first.
#   A labeled auto:fixing comes with the claim's unlabeled auto:needs-fixes at the same instant.
# - GH_PR_LABELS: the PR's labels (default auto:fixing); GH_LABELS_VIEW_FAIL makes that read fail.
mkdir -p "$ROOT/bin" "$ROOT/tmp"
cat > "$ROOT/bin/gh" <<'GHEOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${GH_CALLS:-/dev/null}"
sub="$1"; shift
json=""; want=""; body=""
for ((i=1;i<=$#;i++)); do
  a="${!i}"; n=$((i+1))
  [ "$a" = "--json" ] && json="${!n}"
  [ "$a" = "--jq" ] && want="${!n}"
  [ "$a" = "--body" ] && body="${!n}"
done
case "$sub" in
  repo) echo "${GH_REPO:-owner/repo}" ;;
  label) printf '%s\n' ${GH_LABELS:-auto:needs-fixes auto:fixing auto:needs-review auto:needs-human} ;;
  api)
    [ -n "$GH_TIMELINE_FAIL" ] && exit 1
    tl=$(jq -cn --arg s "${GH_TIMELINE-}" '[{event: "labeled", label: {name: "auto:needs-fixes"}, created_at: "2020-01-01T00:00:00Z"}]
      + [$s | split(" ")[] | select(length > 0) | split("@") as [$e, $t]
         | {event: $e, label: {name: "auto:fixing"}, created_at: $t},
           (select($e == "labeled") | {event: "unlabeled", label: {name: "auto:needs-fixes"}, created_at: $t})]')
    printf '%s\n' "$tl" | jq -r "${want:-.}" ;;
  pr)
    act="$1"; shift
    case "$act" in
      list) [ -n "$GH_LIST_FAIL" ] && exit 1; printf '%s\n' $GH_LIST ;;
      view)
        case "$json" in
          *isCrossRepository*) [ -n "$GH_FORKFAIL" ] && exit 1; echo "${GH_FORK:-false}" ;;
          *baseRefName*)       echo "${GH_BASE-main}" ;;
          *headRefName*)       echo "${GH_BRANCH-feature}" ;;
          *headRefOid*)        echo "${GH_HEADOID-}" ;;
          *labels*)            [ -n "$GH_LABELS_VIEW_FAIL" ] && exit 1
                               jq -cn --arg s "${GH_PR_LABELS-auto:fixing}" '{labels: ($s | split(" ") | map(select(length > 0) | {name: .}))}' \
                                 | jq -r "${want:-.}" ;;
          *) echo "" ;;
        esac ;;
      edit)    [ -n "$GH_EDIT_FAIL" ] && exit 1; echo "$*" >> "$GH_LOG"; echo "edited" ;;
      comment) [ -n "$GH_COMMENT_FAIL" ] && exit 1; echo "commented: $*" >> "$GH_LOG"; printf '%s' "$body" > "$GH_BODY"; echo "commented" ;;
      checkout) [ -n "$GH_CHECKOUT_FAIL" ] && exit 1; git checkout --detach "${GH_PRHEAD:-origin/feature}" >/dev/null 2>&1 ;;
    esac ;;
esac
GHEOF
chmod +x "$ROOT/bin/gh"
export PATH="$ROOT/bin:$PATH"; export GH_LOG="$ROOT/gh.log" GH_CALLS="$ROOT/calls.log" GH_BODY="$ROOT/body.txt"; : > "$GH_LOG"

# --- real git: bare remote + primary checkout + linked worktree ---
git init -q --bare "$ROOT/remote.git"
git clone -q "$ROOT/remote.git" "$ROOT/primary" 2>/dev/null
cd "$ROOT/primary"; git config user.email t@t; git config user.name t
echo base > f.txt; git add .; git commit -qm init; git branch -M main; git push -q origin main
git checkout -qb feature; echo feat >> f.txt; git commit -qam feat; git push -q origin feature
git checkout -q main
git worktree add -q "$ROOT/linked" --detach origin/feature
ln -s "$ROOT/primary" "$ROOT/symlinked"

# fake installed skills (dependency precondition reads these)
mkdir -p "$ROOT/home/.claude/skills/review" "$ROOT/home/.claude/skills/receiving-pr-feedback"
echo 'supports --headless and --base' > "$ROOT/home/.claude/skills/review/SKILL.md"
echo 'supports --no-publish / --publish-only' > "$ROOT/home/.claude/skills/receiving-pr-feedback/SKILL.md"
export HOME="$ROOT/home"

REASON_TXT='did not converge in 3 passes'
# run(blockNum, dir, VAR=value...) — the block in its OWN process, from dir, with the VARs in its env.
# - RUNSH picks the shell; TMPDIR is the sandbox's, so the staged-replies cleanup can't touch the real one.
# - Placeholders are substituted literally (a value may hold & \ | / ' " $ `):
#   <owner/repo> ← $TARGET_REPO, else the GH_REPO= arg (what the stub's `gh repo view` reports), else owner/repo
#   <N> ← 7;  <REASON> ← $ESC_REASON (default $REASON_TXT);  <PUSHED> ← $ESC_PUSHED (default no)
run() {
  local b="$1" d="$2" a repo=owner/repo; shift 2
  for a in "$@"; do case "$a" in GH_REPO=*) repo=${a#GH_REPO=} ;; esac; done
  block "$b" | P_REPO="${TARGET_REPO:-$repo}" P_REASON="${ESC_REASON-$REASON_TXT}" P_PUSHED="${ESC_PUSHED-no}" awk '
    function rep(s, ph, v,   out, i) {
      out = ""
      while ((i = index(s, ph)) > 0) { out = out substr(s, 1, i - 1) v; s = substr(s, i + length(ph)) }
      return out s
    }
    { l = rep($0, "<owner/repo>", ENVIRON["P_REPO"]); l = rep(l, "<N>", "7")
      l = rep(l, "<REASON>", ENVIRON["P_REASON"]); print rep(l, "<PUSHED>", ENVIRON["P_PUSHED"]) }' \
    | ( cd "$d" && env TMPDIR="$ROOT/tmp" "$@" ${RUNSH:-bash} 2>&1 )
}
# blk_with <text> — index of the first ```bash block containing <text>
blk_with() { awk -v t="$1" '/^```bash$/ { n++; inb = 1; next } /^```$/ { inb = 0 } inb && index($0, t) { print n; exit }' "$SKILL"; }
# Located by what they print or post, not by index or by the plumbing under test.
ESC=$(blk_with 'afk-fix: escalating to needs-human'); CLAIM=$(blk_with 'AFKFIX_OK claimed')
[ -n "$ESC" ] || { say "no Step 4 escalate block (posting 'afk-fix: escalating to needs-human') in $SKILL — update this harness"; exit 2; }
[ -n "$CLAIM" ] || { say "no 3.1 claim block (printing 'AFKFIX_OK claimed') in $SKILL — update this harness"; exit 2; }

# go <block> [VAR=value...] — one run in the linked worktree from fresh logs; sets out rc st (AFKFIX_ line) body
go() {
  local b=$1; shift
  : > "$GH_LOG"; : > "$GH_CALLS"; rm -f "$GH_BODY" "$ROOT/pwned"
  out=$(run "$b" "$ROOT/linked" GH_REPO=o/r "$@"); rc=$?
  st=$(printf '%s\n' "$out" | grep -E '^AFKFIX_'); body=$(cat "$GH_BODY" 2>/dev/null)
}
# want_* accumulate into WHY; chk reports and resets it.
WHY=""
why() { WHY="$WHY$*; "; }
want_st() { [ "$st" = "$1" ] || why "status '$st', want '$1'"; }
want_rc() { [ "$rc" = "$1" ] || why "exit $rc, want $1"; }
want_body() { [ "$body" = "$1" ] || why "comment body '$body', want '$1'"; }
want_out_has() { case "$out" in *"$1"*) ;; *) why "output lacks '$1'" ;; esac; }
want_log() { [ "$(cat "$GH_LOG")" = "$1" ] || why "writes '$(cat "$GH_LOG")', want '$1'"; }
want_no_writes() { [ ! -s "$GH_LOG" ] || why "writes: $(cat "$GH_LOG")"; }
want_no_calls() { [ ! -s "$GH_CALLS" ] || why "gh calls: $(cat "$GH_CALLS")"; }
want_call_has() { grep -qF -- "$1" "$GH_CALLS" || why "no gh call containing '$1'"; }
want_no_call_has() { ! grep -qF -- "$1" "$GH_CALLS" || why "unexpected gh call containing '$1'"; }
want_no_pwned() { [ ! -e "$ROOT/pwned" ] || why "reason text was executed: $ROOT/pwned exists"; }
chk() { if [ -z "$WHY" ]; then ok "$1"; else bad "$1" "$WHY| $out"; fi; WHY=""; }

say "=== T1-T4  preconditions (block 1) ==="
out=$(run 1 "$ROOT/linked" GH_REPO=o/r)
[[ "$out" == *AFKFIX_OK\ preconditions* ]] && ok "T1 all-good -> OK" || bad "T1 all-good -> OK" "$out"
out=$(TARGET_REPO=o/r run 1 "$ROOT/linked" GH_REPO=someone/else)
[[ "$out" == *"AFKFIX_ABORT cwd repo"* ]] && ok "T2 wrong repo -> ABORT" || bad "T2 wrong repo -> ABORT" "$out"
out=$(run 1 "$ROOT/linked" GH_REPO=o/r GH_LABELS="auto:needs-fixes auto:fixing")
[[ "$out" == *"AFKFIX_ABORT label 'auto:needs-review' missing"* ]] && ok "T3 missing label -> ABORT" || bad "T3 missing label -> ABORT" "$out"
echo 'no flags here' > "$ROOT/home/.claude/skills/review/SKILL.md"
out=$(run 1 "$ROOT/linked" GH_REPO=o/r)
[[ "$out" == *"AFKFIX_ABORT installed /review lacks --headless"* ]] && ok "T4 stale /review install -> ABORT (C3)" || bad "T4 stale /review install -> ABORT (C3)" "$out"
[[ "$out" == *"your personal copy"* ]] && ok "T4b stale PERSONAL copy -> hint says update/remove it" || bad "T4b personal-copy hint" "$out"
# project copy only (no personal): the fix is to commit it, not to touch ~/.claude
mv "$ROOT/home/.claude/skills/review" "$ROOT/home/review.bak"
mkdir -p "$ROOT/linked/.claude/skills/review" && echo 'no flags here' > "$ROOT/linked/.claude/skills/review/SKILL.md"
out=$(run 1 "$ROOT/linked" GH_REPO=o/r)
[[ "$out" == *"lacks --headless (resolved: .claude/skills/review/SKILL.md)"*"COMMITTED"* ]] && ok "T4c stale PROJECT copy -> hint says commit it" || bad "T4c project-copy hint" "$out"
rm -rf "$ROOT/linked/.claude/skills/review"; mv "$ROOT/home/review.bak" "$ROOT/home/.claude/skills/review"
echo 'supports --headless and --base' > "$ROOT/home/.claude/skills/review/SKILL.md"

say "=== T5  sweep (block 2) ==="
OLD=$(date -u -v-200M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '200 minutes ago' +%Y-%m-%dT%H:%M:%SZ)
OLD2=$(date -u -v-100M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '100 minutes ago' +%Y-%m-%dT%H:%M:%SZ)
NEW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
REC7="7 --repo o/r --remove-label auto:fixing --add-label auto:needs-fixes"
for RUNSH in bash "zsh -f"; do
  SH=${RUNSH%% *}
  if ! command -v "$SH" >/dev/null 2>&1; then say "  NOTICE: $SH not found — skipping T5 [$SH]"; continue; fi
  go 2 GH_LIST=7 GH_TIMELINE="labeled@$OLD"
  want_st "AFKFIX_OK sweep done"; want_log "$REC7"; want_call_has "pr view 7 --repo o/r --json labels"
  chk "T5a [$SH] stale claim, re-read still auto:fixing -> reclaimed"
  go 2 GH_LIST=7 GH_TIMELINE="labeled@$NEW"; want_st "AFKFIX_OK sweep done"; want_no_writes
  chk "T5b [$SH] fresh claim left alone"
  go 2 GH_LIST=7 GH_TIMELINE=""; want_st "AFKFIX_OK sweep done"; want_no_writes
  chk "T5c [$SH] empty timeline = uncertainty, left"
  go 2 GH_LIST=7 GH_TIMELINE_FAIL=1; want_st "AFKFIX_OK sweep done"; want_out_has "  ~ #7: timeline fetch failed"; want_no_writes
  chk "T5d [$SH] timeline fetch failure -> claim left (continue works in for)"
  # T5e: zsh doesn't word-split a bare $claimed, so the loop would see one n="7<newline>8". The stub
  # logs that joined arg across two lines — a line starting `8 --repo` still appears — so only the
  # `^7 --repo` line tells the cases apart.
  go 2 GH_LIST="7 8" GH_TIMELINE="labeled@$OLD"
  grep -q '^7 --repo o/r --remove-label auto:fixing' "$GH_LOG" && grep -q '^8 --repo o/r --remove-label auto:fixing' "$GH_LOG" \
    || why "writes: $(cat "$GH_LOG")"
  chk "T5e [$SH] two stale claims -> both reclaimed"
  go 2 GH_LIST=7 GH_TIMELINE="labeled@$OLD unlabeled@$OLD2"; want_st "AFKFIX_OK sweep done"; want_no_writes; want_no_call_has "pr view"
  chk "T5f [$SH] latest auto:fixing event is unlabeled -> left, no re-read"
  go 2 GH_LIST=7 GH_TIMELINE="labeled@$OLD" GH_PR_LABELS=auto:needs-review; want_st "AFKFIX_OK sweep done"; want_no_writes
  chk "T5g [$SH] re-read shows auto:needs-review -> left"
  go 2 GH_LIST=7 GH_TIMELINE="labeled@$OLD" GH_PR_LABELS="auto:fixing auto:needs-human"; want_st "AFKFIX_OK sweep done"
  want_log "7 --repo o/r --remove-label auto:fixing"
  chk "T5h [$SH] re-read shows auto:fixing + auto:needs-human -> claim removed only"
  go 2 GH_LIST=7 GH_TIMELINE="labeled@$OLD" GH_PR_LABELS="auto:fixing auto:needs-fixes"; want_st "AFKFIX_OK sweep done"
  want_log "7 --repo o/r --remove-label auto:fixing"
  chk "T5j [$SH] half-applied claim (auto:fixing + auto:needs-fixes) -> claim removed only"
  go 2 GH_LIST=7 GH_TIMELINE="labeled@$OLD" GH_EDIT_FAIL=1; want_st "AFKFIX_OK sweep done"
  want_out_has "  ~ #7: reclaim failed — will retry next sweep"; want_no_writes
  chk "T5k [$SH] reclaim edit fails -> noted, sweep done"
  go 2 GH_LIST=7 GH_TIMELINE="labeled@$OLD" GH_LABELS_VIEW_FAIL=1; want_st "AFKFIX_OK sweep done"
  want_out_has "  ~ #7: label read failed — leaving claim as-is"; want_no_writes
  chk "T5i [$SH] re-read fails -> left"
done
unset RUNSH

say "=== T6-T9  safety gates + checkout (block 5) — the data-loss guards ==="
echo "PRECIOUS UNCOMMITTED WORK" > "$ROOT/primary/uncommitted.txt"
out=$(run 5 "$ROOT/primary" GH_REPO=o/r)
[[ "$out" == *"AFKFIX_ESCALATE not an isolated worktree"* ]] && ok "T6a primary checkout -> ESCALATE" || bad "T6a primary -> ESCALATE" "$out"
[ -f "$ROOT/primary/uncommitted.txt" ] && ok "T6b uncommitted work SURVIVED (no reset ran)" || bad "T6b uncommitted work destroyed!" "file gone"
out=$(run 5 "$ROOT/symlinked" GH_REPO=o/r)
[[ "$out" == *"AFKFIX_ESCALATE not an isolated worktree"* ]] && ok "T7a symlinked primary -> ESCALATE (round-6 fail-open)" || bad "T7a symlinked primary -> ESCALATE" "$out"
[ -f "$ROOT/primary/uncommitted.txt" ] && ok "T7b uncommitted work still survived via symlink" || bad "T7b destroyed via symlink!" "file gone"
rm -f "$ROOT/primary/uncommitted.txt"
out=$(run 5 "$ROOT/linked" GH_REPO=o/r GH_FORK=true)
[[ "$out" == *"AFKFIX_ESCALATE cross-fork"* ]] && ok "T8a fork -> ESCALATE" || bad "T8a fork -> ESCALATE" "$out"
out=$(run 5 "$ROOT/linked" GH_REPO=o/r GH_FORKFAIL=1)
[[ "$out" == *"AFKFIX_ESCALATE cross-fork"* ]] && ok "T8b fork-check gh error -> ESCALATE (fail closed)" || bad "T8b fork-check error" "$out"
out=$(run 5 "$ROOT/linked" GH_REPO=o/r GH_BASE=)
[[ "$out" == *"AFKFIX_ESCALATE could not resolve the PR's base"* ]] && ok "T8c empty base -> ESCALATE" || bad "T8c empty base" "$out"
out=$(run 5 "$ROOT/linked" GH_REPO=o/r GH_CHECKOUT_FAIL=1)
[[ "$out" == *"AFKFIX_ESCALATE checkout failed"* ]] && ok "T8d checkout failure -> ESCALATE (was unguarded)" || bad "T8d checkout failure" "$out"
out=$(run 5 "$ROOT/linked" GH_REPO=o/r)
[[ "$out" == *"AFKFIX_OK ready base=main head="* ]] && ok "T9 happy path -> OK, prints base for substitution" || bad "T9 happy path" "$out"

say "=== T10-T11  zero-commit detection (block 6) ==="
( cd "$ROOT/linked" && git checkout -q --detach origin/feature )
UNCHANGED=$( cd "$ROOT/linked" && git rev-parse HEAD )
out=$(run 6 "$ROOT/linked" GH_REPO=o/r GH_HEADOID="$UNCHANGED")
[[ "$out" == *"AFKFIX_ESCALATE converged without changing code"* ]] && ok "T10a no local commits -> ESCALATE" || bad "T10a zero-commit" "$out"
# fail-CLOSED: an unreadable remote head must never be mistaken for "has commits" and publish.
out=$(run 6 "$ROOT/linked" GH_REPO=o/r GH_HEADOID=)
[[ "$out" == *"AFKFIX_ESCALATE could not read the PR head"* ]] && ok "T10b unreadable remote head -> ESCALATE (fail closed)" || bad "T10b unreadable head" "$out"
SOLE="AFKFIX_ESCALATE no longer the sole owner before publishing"
for RUNSH in bash "zsh -f"; do
  SH=${RUNSH%% *}
  if ! command -v "$SH" >/dev/null 2>&1; then say "  NOTICE: $SH not found — skipping T10c-d [$SH]"; continue; fi
  go 6 GH_HEADOID="$UNCHANGED" "GH_PR_LABELS=auto:fixing auto:needs-human"
  want_st "AFKFIX_ESCALATE converged without changing code — nothing to push; needs human adjudication"; want_rc 1
  want_no_call_has "--json labels"
  chk "T10c [$SH] zero commits beats a stacked label -> zero-commit ESCALATE, no label read"
  go 6 GH_HEADOID= GH_LABELS_VIEW_FAIL=1
  want_st "AFKFIX_ESCALATE could not read the PR head from GitHub"; want_rc 1; want_no_call_has "--json labels"
  chk "T10d [$SH] unreadable head beats an unreadable label set -> head ESCALATE, no label read"
done
unset RUNSH
( cd "$ROOT/linked" && echo fix >> f.txt && git -c user.email=t@t -c user.name=t commit -qam 'fix [skip-review]' )
out=$(run 6 "$ROOT/linked" GH_REPO=o/r GH_HEADOID="$UNCHANGED")
[[ "$out" == *"AFKFIX_OK has-commits"* ]] && ok "T11 commits present -> OK" || bad "T11 has-commits" "$out"
HASC="AFKFIX_OK has-commits local=$( cd "$ROOT/linked" && git rev-parse HEAD )"
for RUNSH in bash "zsh -f"; do
  SH=${RUNSH%% *}
  if ! command -v "$SH" >/dev/null 2>&1; then say "  NOTICE: $SH not found — skipping T11a-c [$SH]"; continue; fi
  go 6 GH_HEADOID="$UNCHANGED" "GH_PR_LABELS=bug auto:fixing"; want_st "$HASC"; want_rc 0; want_call_has "pr view 7 --repo o/r --json labels"
  chk "T11a [$SH] sole owner (non-auto labels ignored) -> has-commits"
  go 6 GH_HEADOID="$UNCHANGED" "GH_PR_LABELS=auto:fixing auto:needs-human"
  want_st "$SOLE (auto labels: 'auto:fixing auto:needs-human') — not pushing"; want_rc 1
  chk "T11b [$SH] auto:needs-human added mid-convergence -> ESCALATE, not pushing"
  go 6 GH_HEADOID="$UNCHANGED" GH_PR_LABELS=auto:needs-review
  want_st "$SOLE (auto labels: 'auto:needs-review') — not pushing"; want_rc 1
  chk "T11c [$SH] claim gone (another run moved it) -> ESCALATE, not pushing"
  go 6 GH_HEADOID="$UNCHANGED" GH_LABELS_VIEW_FAIL=1
  want_st "AFKFIX_ESCALATE could not re-read the labels before publishing"; want_rc 1
  chk "T11d [$SH] label re-read fails -> ESCALATE"
done
unset RUNSH

say "=== T12-T14  publish verify + transition (block 7) ==="
LOCALSHA=$( cd "$ROOT/linked" && git rev-parse HEAD )
out=$(run 7 "$ROOT/linked" GH_REPO=o/r GH_BRANCH=feature GH_HEADOID="$UNCHANGED")
[[ "$out" == *"publish/push did not land"*"push-landed=no"* ]] && ok "T12a push rejected -> ESCALATE push-landed=no" || bad "T12a push-not-landed" "$out"
# our commit is an ANCESTOR of the remote head => it landed and someone pushed on top
ONTOP=$( cd "$ROOT/linked" && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m ontop && git rev-parse HEAD && git reset -q --hard HEAD~1 )
out=$(run 7 "$ROOT/linked" GH_REPO=o/r GH_BRANCH=feature GH_HEADOID="$ONTOP")
[[ "$out" == *"push landed but the head moved on"*"push-landed=yes"* ]] && ok "T12c landed-then-moved -> push-landed=yes" || bad "T12c landed-then-moved" "$out"
out=$(run 7 "$ROOT/linked" GH_REPO=o/r GH_BRANCH=feature GH_HEADOID=)
[[ "$out" == *"AFKFIX_ESCALATE publish/push did not land"* ]] && ok "T12b empty remote head -> ESCALATE" || bad "T12b empty head" "$out"
TERM_TAIL="— leaving the terminal edits to the owner"
for RUNSH in bash "zsh -f"; do
  SH=${RUNSH%% *}
  if ! command -v "$SH" >/dev/null 2>&1; then say "  NOTICE: $SH not found — skipping T13 [$SH]"; continue; fi
  go 7 GH_BRANCH=feature GH_HEADOID="$LOCALSHA" GH_PR_LABELS=auto:needs-human
  want_st "AFKFIX_SKIP #7 no longer the sole owner (auto labels: 'auto:needs-human') $TERM_TAIL"; want_rc 1; want_no_writes
  chk "T13 [$SH] lost claim -> SKIP, no double-label"
  go 7 GH_BRANCH=feature GH_HEADOID="$LOCALSHA" "GH_PR_LABELS=auto:fixing auto:needs-human"
  want_st "AFKFIX_SKIP #7 no longer the sole owner (auto labels: 'auto:fixing auto:needs-human') $TERM_TAIL"; want_rc 1; want_no_writes
  chk "T13b [$SH] auto:fixing beside auto:needs-human -> SKIP, no transition edit"
  go 7 GH_BRANCH=feature GH_HEADOID="$LOCALSHA" GH_LABELS_VIEW_FAIL=1
  want_st "AFKFIX_SKIP #7 no longer the sole owner (auto labels: 'fetch-failed') $TERM_TAIL"; want_rc 1; want_no_writes
  chk "T13c [$SH] ownership read fails -> SKIP as 'fetch-failed', no transition edit"
done
unset RUNSH
: > "$GH_LOG"
out=$(run 7 "$ROOT/linked" GH_REPO=o/r GH_BRANCH=feature GH_HEADOID="$LOCALSHA" "GH_PR_LABELS=bug auto:fixing")
[[ "$out" == *"AFKFIX_OK"*"-> auto:needs-review at"* ]] && ok "T14a landed, sole owner -> OK transition" || bad "T14a transition" "$out"
[ "$(cat "$GH_LOG")" = "7 --repo o/r --remove-label auto:fixing --add-label auto:needs-review" ] && ok "T14b label actually moved" || bad "T14b label moved" "$(cat "$GH_LOG")"

say "=== T15  escalate (Step 4, block $ESC) — comment BEFORE label ==="
esc() { go "$ESC" "$@"; }
PFX="afk-fix: escalating to needs-human —"
NOPUSH="No fixes were pushed."; PUSHED_NOTE="Fix commits were pushed; the transition did not complete."
SKIP_TAIL="— keeping the claim for the sweep to retry"
REASON_INJ="didn't converge: \$(touch $ROOT/pwned) and \`touch $ROOT/pwned\` & | / \"dq\" 'sq'"
for RUNSH in bash "zsh -f"; do
  SH=${RUNSH%% *}
  if ! command -v "$SH" >/dev/null 2>&1; then say "  NOTICE: $SH not found — skipping T15 [$SH]"; continue; fi
  esc
  want_st "AFKFIX_OK #7 -> auto:needs-human ($REASON_TXT)"; want_rc 0; want_body "$PFX $REASON_TXT $NOPUSH"
  [[ "$(head -1 "$GH_LOG")" == commented:* ]] || why "first write is not the comment: $(cat "$GH_LOG")"
  [ "$(sed -n 2p "$GH_LOG")" = "7 --repo o/r --remove-label auto:fixing --add-label auto:needs-human" ] || why "second write is not the label move: $(cat "$GH_LOG")"
  chk "T15a [$SH] comment precedes label move; PUSHED=no -> 'No fixes were pushed.'"
  esc GH_PR_LABELS=auto:needs-human
  want_st "AFKFIX_SKIP #7 no longer holds auto:fixing — not escalating over another run"; want_rc 1; want_no_writes
  chk "T15b [$SH] lost claim -> no escalate-over-winner"
  esc GH_COMMENT_FAIL=1
  want_st "AFKFIX_SKIP #7 could not post the escalation reason $SKIP_TAIL"; want_rc 1; want_no_writes
  chk "T15c [$SH] comment failure -> label NOT moved (no reason-less needs-human)"
  ESC_PUSHED=yes esc
  want_st "AFKFIX_OK #7 -> auto:needs-human ($REASON_TXT)"; want_body "$PFX $REASON_TXT $PUSHED_NOTE"
  chk "T15d [$SH] PUSHED=yes -> 'Fix commits were pushed; ...'"
  esc GH_LABELS_VIEW_FAIL=1
  want_st "AFKFIX_SKIP #7 claim check failed $SKIP_TAIL"; want_rc 1; want_no_writes
  chk "T15e [$SH] ownership read fails -> SKIP, no writes"
  ESC_REASON='<REASON>' esc
  want_st "AFKFIX_SKIP #7 no escalation reason $SKIP_TAIL"; want_rc 1; want_no_calls
  chk "T15f [$SH] unsubstituted <REASON> -> SKIP, no gh call"
  ESC_REASON= esc
  want_st "AFKFIX_SKIP #7 no escalation reason $SKIP_TAIL"; want_rc 1; want_no_calls
  chk "T15g [$SH] empty reason -> SKIP, no gh call"
  ESC_PUSHED=push-landed=yes esc
  want_st "AFKFIX_SKIP #7 bad push-landed value 'push-landed=yes' $SKIP_TAIL"; want_rc 1; want_no_calls
  chk "T15h [$SH] PUSHED='push-landed=yes' -> SKIP, no gh call"
  ESC_PUSHED='<PUSHED>' esc
  want_st "AFKFIX_SKIP #7 bad push-landed value '<PUSHED>' $SKIP_TAIL"; want_rc 1; want_no_calls
  chk "T15i [$SH] unsubstituted <PUSHED> -> SKIP, no gh call"
  ESC_REASON=$REASON_INJ esc
  want_st "AFKFIX_OK #7 -> auto:needs-human ($REASON_INJ)"; want_body "$PFX $REASON_INJ $NOPUSH"; want_no_pwned
  chk "T15j [$SH] reason with ' \$( ) backticks & | / \" -> verbatim, nothing runs"
  ESC_REASON="first line"$'\n'"touch $ROOT/pwned" esc
  want_st "AFKFIX_OK #7 -> auto:needs-human (first line)"; want_body "$PFX first line $NOPUSH"; want_no_pwned
  chk "T15k [$SH] multi-line reason -> first line only, the rest never runs"
  esc GH_EDIT_FAIL=1
  want_st "AFKFIX_SKIP #7 escalation label move failed — the sweep will reclaim the stale claim"; want_rc 1
  [[ "$(head -1 "$GH_LOG")" == commented:* ]] || why "the reason comment was not posted first: $(cat "$GH_LOG")"
  chk "T15l [$SH] label move fails after the comment -> SKIP, never a false OK"
  REASON_BS='parse error: expected "\n" got EOF'
  ESC_REASON=$REASON_BS esc
  want_st "AFKFIX_OK #7 -> auto:needs-human ($REASON_BS)"; want_body "$PFX $REASON_BS $NOPUSH"
  chk "T15m [$SH] backslash in the reason -> one intact status line (printf, not zsh echo)"
done
unset RUNSH

say "=== T16  claim (3.1, block $CLAIM) — re-read before claiming ==="
CLAIM7="7 --repo o/r --add-label auto:fixing --remove-label auto:needs-fixes"
for RUNSH in bash "zsh -f"; do
  SH=${RUNSH%% *}
  if ! command -v "$SH" >/dev/null 2>&1; then say "  NOTICE: $SH not found — skipping T16 [$SH]"; continue; fi
  go "$CLAIM" "GH_PR_LABELS=bug auto:needs-fixes"
  want_st "AFKFIX_OK claimed #7"; want_rc 0; want_log "$CLAIM7"
  case "$(head -1 "$GH_CALLS")" in "pr view 7 --repo o/r --json labels --jq "*) ;; *) why "first gh call is not the label re-read: $(cat "$GH_CALLS")" ;; esac
  chk "T16a [$SH] only auto:needs-fixes (non-auto labels ignored) -> re-read, then claim"
  go "$CLAIM" GH_PR_LABELS=auto:needs-human
  want_st "AFKFIX_SKIP #7 not claimable (auto labels: 'auto:needs-human') — moved on"; want_rc 0; want_no_writes; want_no_call_has "pr edit"
  chk "T16b [$SH] escalated to auto:needs-human -> no edit"
  go "$CLAIM" GH_PR_LABELS=auto:ready
  want_st "AFKFIX_SKIP #7 not claimable (auto labels: 'auto:ready') — moved on"; want_rc 0; want_no_writes; want_no_call_has "pr edit"
  chk "T16c [$SH] moved on to auto:ready -> no edit"
  go "$CLAIM" GH_PR_LABELS=auto:fixing
  want_st "AFKFIX_SKIP #7 not claimable (auto labels: 'auto:fixing') — moved on"; want_rc 0; want_no_writes; want_no_call_has "pr edit"
  chk "T16d [$SH] already claimed by a sibling -> no edit"
  go "$CLAIM" "GH_PR_LABELS=auto:needs-human auto:needs-fixes"
  want_st "AFKFIX_SKIP #7 not claimable (auto labels: 'auto:needs-fixes auto:needs-human') — moved on"; want_rc 0; want_no_writes
  want_no_call_has "pr edit"
  chk "T16e [$SH] auto:needs-fixes beside auto:needs-human -> no edit"
  go "$CLAIM" GH_LABELS_VIEW_FAIL=1
  want_st "AFKFIX_SKIP #7 claim label read failed — leaving the PR untouched"; want_rc 1; want_no_writes; want_no_call_has "pr edit"
  chk "T16f [$SH] label re-read fails -> SKIP, no edit"
  go "$CLAIM" GH_PR_LABELS=auto:needs-fixes GH_EDIT_FAIL=1
  want_st "AFKFIX_SKIP #7 claim failed — leaving the PR untouched"; want_rc 1; want_no_writes; want_call_has "pr edit 7 --repo o/r"
  chk "T16g [$SH] claim edit fails -> SKIP"
done
unset RUNSH

say ""
say "RESULT: $PASS passed, $FAIL failed"
say "sandbox: $ROOT"
[ "$FAIL" -eq 0 ]
