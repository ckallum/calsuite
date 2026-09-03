#!/usr/bin/env bash
# Execution harness for skills/afk-fix/SKILL.md — run: scripts/test-afk-fix-blocks.sh
# Runs each shipped ```bash block as its OWN process against a real git repo + stub gh,
# which is the only way to catch cross-block state loss, continue-fallthrough, and
# guards that fail open. Asserts on the block's printed status line.
SKILL="${1:-$(dirname "$0")/../skills/afk-fix/SKILL.md}"
[ -f "$SKILL" ] || { echo "usage: test-afk-fix-blocks.sh [path to afk-fix SKILL.md]"; exit 2; }
# absolute — the harness cd's into its sandbox, so a relative path would break mid-run
SKILL=$(cd "$(dirname "$SKILL")" && pwd)/$(basename "$SKILL")
ROOT=$(mktemp -d "${TMPDIR:-/tmp}/afk-fix-blocks.XXXXXX")
trap 'rm -rf "$ROOT"' EXIT
PASS=0; FAIL=0
say() { printf '%s\n' "$*"; }
ok()   { PASS=$((PASS+1)); say "  PASS  $1"; }
bad()  { FAIL=$((FAIL+1)); say "  FAIL  $1"; say "        got: $2"; }

# --- extract the Nth ```bash block verbatim from the skill ---
block() { awk -v want="$1" '/^```bash$/{inb=1;n++;next} /^```$/{if(inb)inb=0;next} inb&&n==want{print}' "$SKILL"; }

# --- stub gh: behaviour driven by env ---
mkdir -p "$ROOT/bin"
cat > "$ROOT/bin/gh" <<'GHEOF'
#!/usr/bin/env bash
sub="$1"; shift
json=""; want=""
for ((i=1;i<=$#;i++)); do
  a="${!i}"; n=$((i+1))
  [ "$a" = "--json" ] && json="${!n}"
  [ "$a" = "--jq" ] && want="${!n}"
done
case "$sub" in
  repo) echo "${GH_REPO:-owner/repo}" ;;
  label) printf '%s\n' ${GH_LABELS:-auto:needs-fixes auto:fixing auto:needs-review auto:needs-human} ;;
  api)   [ -n "$GH_TIMELINE_FAIL" ] && exit 1; printf '%s\n' $GH_TIMELINE ;;
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
          *labels*)            echo "${GH_OWN:-true}" ;;
          *) echo "" ;;
        esac ;;
      edit)    [ -n "$GH_EDIT_FAIL" ] && exit 1; echo "$*" >> "$GH_LOG"; echo "edited" ;;
      comment) [ -n "$GH_COMMENT_FAIL" ] && exit 1; echo "commented: $*" >> "$GH_LOG"; echo "commented" ;;
      checkout) [ -n "$GH_CHECKOUT_FAIL" ] && exit 1; git checkout --detach "${GH_PRHEAD:-origin/feature}" >/dev/null 2>&1 ;;
    esac ;;
esac
GHEOF
chmod +x "$ROOT/bin/gh"
export PATH="$ROOT/bin:$PATH"; export GH_LOG="$ROOT/gh.log"; : > "$GH_LOG"

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

run() { # run(blockNum, dir) with placeholders substituted, in its OWN process
  local b="$1" d="$2"; shift 2
  block "$b" | sed -e "s|<owner/repo>|${TARGET_REPO:-${GH_REPO:-owner/repo}}|g" -e 's|<N>|7|g' \
             | ( cd "$d" && env "$@" bash 2>&1 )
}

say "=== T1-T4  preconditions (block 1) ==="
out=$(GH_REPO=o/r run 1 "$ROOT/linked" GH_REPO=o/r)
[[ "$out" == *AFKFIX_OK\ preconditions* ]] && ok "T1 all-good -> OK" || bad "T1 all-good -> OK" "$out"
out=$(TARGET_REPO=o/r run 1 "$ROOT/linked" GH_REPO=someone/else)
[[ "$out" == *"AFKFIX_ABORT cwd repo"* ]] && ok "T2 wrong repo -> ABORT" || bad "T2 wrong repo -> ABORT" "$out"
out=$(GH_REPO=o/r run 1 "$ROOT/linked" GH_REPO=o/r GH_LABELS="auto:needs-fixes auto:fixing")
[[ "$out" == *"AFKFIX_ABORT label 'auto:needs-review' missing"* ]] && ok "T3 missing label -> ABORT" || bad "T3 missing label -> ABORT" "$out"
echo 'no flags here' > "$ROOT/home/.claude/skills/review/SKILL.md"
out=$(GH_REPO=o/r run 1 "$ROOT/linked" GH_REPO=o/r)
[[ "$out" == *"AFKFIX_ABORT installed /review lacks --headless"* ]] && ok "T4 stale /review install -> ABORT (C3)" || bad "T4 stale /review install -> ABORT (C3)" "$out"
echo 'supports --headless and --base' > "$ROOT/home/.claude/skills/review/SKILL.md"

say "=== T5  sweep (block 2) ==="
OLD=$(date -u -v-200M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '200 minutes ago' +%Y-%m-%dT%H:%M:%SZ)
NEW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
: > "$GH_LOG"; run 2 "$ROOT/linked" GH_REPO=o/r GH_LIST=7 GH_TIMELINE="$OLD" >/dev/null
grep -q 'remove-label auto:fixing' "$GH_LOG" && ok "T5a stale claim reclaimed" || bad "T5a stale claim reclaimed" "$(cat "$GH_LOG")"
: > "$GH_LOG"; run 2 "$ROOT/linked" GH_REPO=o/r GH_LIST=7 GH_TIMELINE="$NEW" >/dev/null
[ ! -s "$GH_LOG" ] && ok "T5b fresh claim left alone" || bad "T5b fresh claim left alone" "$(cat "$GH_LOG")"
: > "$GH_LOG"; run 2 "$ROOT/linked" GH_REPO=o/r GH_LIST=7 GH_TIMELINE="" >/dev/null
[ ! -s "$GH_LOG" ] && ok "T5c empty timeline = uncertainty, left" || bad "T5c empty timeline left" "$(cat "$GH_LOG")"
: > "$GH_LOG"; out=$(run 2 "$ROOT/linked" GH_REPO=o/r GH_LIST=7 GH_TIMELINE_FAIL=1)
[ ! -s "$GH_LOG" ] && ok "T5d timeline fetch failure -> claim left (continue works in for)" || bad "T5d fetch failure" "$(cat "$GH_LOG")"

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
( cd "$ROOT/linked" && echo fix >> f.txt && git -c user.email=t@t -c user.name=t commit -qam 'fix [skip-review]' )
out=$(run 6 "$ROOT/linked" GH_REPO=o/r GH_HEADOID="$UNCHANGED")
[[ "$out" == *"AFKFIX_OK has-commits"* ]] && ok "T11 commits present -> OK" || bad "T11 has-commits" "$out"

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
out=$(run 7 "$ROOT/linked" GH_REPO=o/r GH_BRANCH=feature GH_HEADOID="$LOCALSHA" GH_OWN=false)
[[ "$out" == *"AFKFIX_SKIP"*"no longer holds auto:fixing"* ]] && ok "T13 lost claim -> SKIP, no double-label" || bad "T13 lost claim" "$out"
: > "$GH_LOG"
out=$(run 7 "$ROOT/linked" GH_REPO=o/r GH_BRANCH=feature GH_HEADOID="$LOCALSHA" GH_OWN=true)
[[ "$out" == *"AFKFIX_OK"*"-> auto:needs-review at"* ]] && ok "T14a landed -> OK transition" || bad "T14a transition" "$out"
grep -q 'add-label auto:needs-review' "$GH_LOG" && ok "T14b label actually moved" || bad "T14b label moved" "$(cat "$GH_LOG")"

say "=== T15  escalate (block 8) — comment BEFORE label ==="
: > "$GH_LOG"
out=$(run 8 "$ROOT/linked" GH_REPO=o/r GH_OWN=true)
first=$(head -1 "$GH_LOG")
[[ "$first" == commented:* ]] && ok "T15a comment precedes label move" || bad "T15a ordering" "$(cat "$GH_LOG")"
out=$(run 8 "$ROOT/linked" GH_REPO=o/r GH_OWN=false)
[[ "$out" == *"AFKFIX_SKIP"*"not escalating"* ]] && ok "T15b lost claim -> no escalate-over-winner" || bad "T15b" "$out"
: > "$GH_LOG"
out=$(run 8 "$ROOT/linked" GH_REPO=o/r GH_OWN=true GH_COMMENT_FAIL=1)
if ! grep -q 'add-label auto:needs-human' "$GH_LOG"; then ok "T15c comment failure -> label NOT moved (no reason-less needs-human)"; else bad "T15c label moved without a reason" "$(cat "$GH_LOG")"; fi

say ""
say "RESULT: $PASS passed, $FAIL failed"
say "sandbox: $ROOT"
[ "$FAIL" -eq 0 ]
