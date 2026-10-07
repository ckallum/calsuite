#!/usr/bin/env bash
# Execution harness for skills/afk-review/SKILL.md.
# - Extracts each ```bash block verbatim (indented list-item fences included), substitutes the
#   placeholders, and runs it as its OWN process under bash and zsh, the way the loop executes it.
# - gh is a stub that evaluates --jq with real jq against fixture JSON, so the skill's filters are
#   under test, not canned answers. It logs every write (pr edit / pr comment) with its exact argv.
# - Asserts on the block's AFKREV_* status line, its exit code, and the write log.
#
# usage: test-afk-review-blocks.sh [--mutation-check] [path to afk-review SKILL.md]
#   --mutation-check  run the suite against a copy of the skill with block 4's author check removed;
#                     passes only if R2 (forged marker from another login) fails there.
MODE=run
if [ "${1-}" = "--mutation-check" ]; then MODE=mutation; shift; fi
SKILL="${1:-$(dirname "$0")/../skills/afk-review/SKILL.md}"
[ -f "$SKILL" ] || { echo "usage: test-afk-review-blocks.sh [--mutation-check] [path to afk-review SKILL.md]"; exit 2; }
# absolute — blocks run from a sandbox cwd
SKILL=$(cd "$(dirname "$SKILL")" && pwd)/$(basename "$SKILL")
SELF=$(cd "$(dirname "$0")" && pwd)/$(basename "$0")
command -v jq >/dev/null 2>&1 || { echo "jq is required (the gh stub evaluates --jq with it)"; exit 2; }
ROOT=$(mktemp -d "${TMPDIR:-/tmp}/afk-review-blocks.XXXXXX")
trap 'rm -rf "$ROOT"' EXIT
say() { printf '%s\n' "$*"; }

if [ "$MODE" = mutation ]; then
  MUTANT="$ROOT/SKILL.md"
  sed 's/\.user\.login == \\"\$LOGIN\\" and //' "$SKILL" > "$MUTANT"
  if cmp -s "$SKILL" "$MUTANT"; then
    say "MUTATION CHECK: mutation did not apply — block 4's author check changed shape; update the sed"; exit 2
  fi
  say "=== mutant: block 4 author check removed ==="
  diff "$SKILL" "$MUTANT" | sed 's/^/  /'
  out=$(bash "$SELF" "$MUTANT" 2>&1)
  r2=$(printf '%s\n' "$out" | grep -E '^  (PASS|FAIL)  \[(bash|zsh)\] R2 ')
  say "--- R2 under the mutant:"; printf '%s\n' "$r2"
  say "--- every case failing under the mutant:"; printf '%s\n' "$out" | grep -E '^  FAIL  '
  if [ -n "$r2" ] && ! printf '%s\n' "$r2" | grep -q '^  PASS'; then
    say "MUTATION CHECK: caught — R2 fails when the author check is removed"; exit 0
  fi
  say "MUTATION CHECK: NOT caught — R2 passes without the author check"; exit 1
fi

# --- the Nth ```bash block, verbatim, with its fence indentation stripped ---
# Any fence opens/closes a block; only ```bash blocks are counted, so the plain ``` Skill: block is skipped.
block() {
  awk -v want="$1" '
    /^ *```/ {
      if (!inf) { inf = 1; isb = ($0 ~ /^ *```bash *$/); if (isb) { n++; ind = index($0, "`") - 1 }; next }
      if ($0 ~ /^ *``` *$/) { inf = 0; isb = 0; next }
    }
    inf && isb && n == want {
      line = $0; i = 0
      while (i < ind && substr(line, 1, 1) == " ") { line = substr(line, 2); i++ }
      print line
    }' "$SKILL"
}
nblocks=$(awk '/^ *```bash *$/ { c++ } END { print c + 0 }' "$SKILL")

# --- stub gh ---
mkdir -p "$ROOT/bin" "$ROOT/home" "$ROOT/work" "$ROOT/tmp" "$ROOT/ghconfig" "$ROOT/fx"
cat > "$ROOT/bin/gh" <<'GHEOF'
#!/usr/bin/env bash
# Stub gh. Never touches the network.
# - --jq is evaluated with real jq (gh applies it per page under --paginate; a fixture file holding
#   several JSON arrays is several pages). On an HTTP error `gh api` prints the error body to stdout.
# - Every call → $GH_CALLS; every pr edit / pr comment → $GH_WRITES as `ok|FAIL <argv as JSON>`.
# - Fixtures: GH_LOGIN GH_TRIAGE(true|false|absent) GH_CWD_REPO GH_LABELS GH_PR_LABELS GH_PR_HEAD
#   GH_PRS (file) GH_FX (dir holding comments-<N>.json / timeline-<N>.json) GH_KNOWN_REPO
# - Failure switches (any non-empty value): GH_USER_FAIL GH_REPO_API_FAIL GH_COMMENTS_FAIL
#   GH_TIMELINE_FAIL GH_REPO_VIEW_FAIL GH_LABEL_FAIL GH_PR_LIST_FAIL GH_PR_VIEW_FAIL
#   GH_EDIT_FAIL GH_COMMENT_FAIL
#   GH_USER_FAIL=net is a transport failure (nothing on stdout); any other value is an HTTP 403.
argv_json() { printf '%s\037' "$@" | jq -Rsc 'split("\u001f") | .[:-1]'; }
ARGV=$(argv_json "$@")
printf '%s\n' "$ARGV" >> "${GH_CALLS:-/dev/null}"
die() { printf 'gh-stub: %s\n' "$*" >&2; exit 1; }

KNOWN=${GH_KNOWN_REPO:-acme/widgets}
LABELS=${GH_LABELS-bug enhancement auto:needs-review auto:reviewing auto:needs-fixes auto:ready auto:needs-human}
sub=${1-}; [ $# -gt 0 ] && shift
pos=(); adds=(); flags=" "; jqf=""; hasjq=0; json=""; repo=""; label=""; state=""
while [ $# -gt 0 ]; do
  case "$1" in
    --paginate|--slurp) flags="$flags$1 "; shift ;;
    --jq|--json|--repo|--label|--state|--limit|--body|--add-label|--remove-label)
      [ $# -ge 2 ] || die "flag needs an argument: $1"
      flags="$flags$1 "
      case "$1" in
        --jq) hasjq=1; jqf=$2 ;;
        --json) json=$2 ;;
        --repo) repo=$2 ;;
        --label) label=$2 ;;
        --state) state=$2 ;;
        --add-label) adds+=("$2") ;;
      esac
      shift 2 ;;
    -*) die "unknown flag: $1" ;;
    *) pos+=("$1"); shift ;;
  esac
done

allow() { local f; for f in $flags; do case " $* " in *" $f "*) ;; *) die "unknown flag: $f" ;; esac; done; }
need_repo() {
  [ -n "$repo" ] || die "--repo is required"
  [ "$repo" = "$KNOWN" ] || { echo "GraphQL: Could not resolve to a Repository with the name '$repo'. (repository)" >&2; exit 1; }
}
need_num() { case "${pos[1]-}" in ''|*[!0-9]*) die "bad PR number: '${pos[1]-}'" ;; esac; }
need_json() { [ -n "$json" ] || die "the stub only emulates --json output"; }
project() { jq -c --arg f "$json" 'def p: . as $o | reduce ($f | split(",")[]) as $k ({}; .[$k] = $o[$k]); if type == "array" then map(p) else p end'; }
labels_json() { jq -cn --arg s "$1" '$s | split(" ") | map(select(length > 0) | {name: ., color: "ededed"})'; }
emit() {
  if [ "$hasjq" = 1 ]; then printf '%s\n' "$1" | jq -r "$jqf" || die "jq failed: $jqf"
  else printf '%s\n' "$1"; fi
}
emit_pages() {
  local f=$1; [ -f "$f" ] || { f="$(dirname "$GH_CALLS")/empty.json"; echo '[]' > "$f"; }
  if [ "$hasjq" = 1 ]; then jq -r "$jqf" "$f" || die "jq failed: $jqf"; else jq -c . "$f"; fi
}
api_fail() {
  jq -cn --arg s "$1" --arg m "$2" '{message: $m, documentation_url: "https://docs.github.com/rest", status: $s}'
  printf 'gh: %s (HTTP %s)\n' "$2" "$1" >&2; exit 1
}
write_call() { # write_call <fail switch> — records the attempt; returns 1 when switched to fail
  if [ -n "$1" ]; then printf 'FAIL %s\n' "$ARGV" >> "$GH_WRITES"; return 1; fi
  printf 'ok %s\n' "$ARGV" >> "$GH_WRITES"
}

case "$sub" in
  api)
    allow --paginate --slurp --jq
    case "$flags" in *" --slurp "*) [ "$hasjq" = 1 ] && die "the \`--slurp\` option is not supported with \`--jq\` or \`--template\`" ;; esac
    ep=${pos[0]-}
    case "$ep" in
      user)
        case "${GH_USER_FAIL-}" in
          "") ;;
          net) echo "error connecting to api.github.com" >&2; exit 1 ;;
          *) api_fail 403 "Resource not accessible by integration" ;;
        esac
        emit "$(jq -cn --arg l "${GH_LOGIN:-loopbot}" '{login: $l, id: 1, type: "User"}')" ;;
      repos/*)
        rest=${ep#repos/}; owner=${rest%%/*}; rest=${rest#*/}; name=${rest%%/*}
        subpath=""; case "$rest" in */*) subpath=${rest#*/} ;; esac
        [ "$owner/$name" = "$KNOWN" ] || api_fail 404 "Not Found"
        case "$subpath" in
          "")
            [ -n "${GH_REPO_API_FAIL-}" ] && api_fail 502 "Server Error"
            case "${GH_TRIAGE:-true}" in
              absent) emit "$(jq -cn --arg r "$KNOWN" '{full_name: $r}')" ;;
              *) emit "$(jq -cn --arg r "$KNOWN" --argjson t "${GH_TRIAGE:-true}" \
                   '{full_name: $r, permissions: {admin: false, maintain: false, push: $t, triage: $t, pull: true}}')" ;;
            esac ;;
          issues/*/comments|issues/*/timeline)
            n=${subpath#issues/}; n=${n%%/*}; kind=${subpath##*/}
            case "$n" in ''|*[!0-9]*) api_fail 404 "Not Found" ;; esac
            [ "$kind" = comments ] && [ -n "${GH_COMMENTS_FAIL-}" ] && api_fail 403 "API rate limit exceeded"
            [ "$kind" = timeline ] && [ -n "${GH_TIMELINE_FAIL-}" ] && api_fail 502 "Server Error"
            emit_pages "${GH_FX:-/nonexistent}/$kind-$n.json" ;;
          *) api_fail 404 "Not Found" ;;
        esac ;;
      *) die "unsupported api endpoint: $ep" ;;
    esac ;;
  repo)
    [ "${pos[0]-}" = view ] || die "unsupported: gh repo ${pos[0]-}"
    allow --json --jq; need_json
    [ -n "${GH_REPO_VIEW_FAIL-}" ] && { echo "failed to run git: fatal: not a git repository (or any of the parent directories): .git" >&2; exit 1; }
    emit "$(jq -cn --arg r "${GH_CWD_REPO:-$KNOWN}" '{nameWithOwner: $r}' | project)" ;;
  label)
    [ "${pos[0]-}" = list ] || die "unsupported: gh label ${pos[0]-}"
    allow --repo --limit --json --jq; need_repo; need_json
    [ -n "${GH_LABEL_FAIL-}" ] && { echo "HTTP 502: Server Error (https://api.github.com/graphql)" >&2; exit 1; }
    emit "$(labels_json "$LABELS" | project)" ;;
  pr)
    act=${pos[0]-}; n=${pos[1]-}
    case "$act" in
      list)
        allow --repo --state --label --limit --json --jq; need_repo; need_json
        [ -n "${GH_PR_LIST_FAIL-}" ] && { echo "HTTP 502: Server Error (https://api.github.com/graphql)" >&2; exit 1; }
        data='[]'; [ -n "${GH_PRS-}" ] && data=$(cat "$GH_PRS")
        emit "$(printf '%s' "$data" | jq -c --arg l "$label" --arg s "$state" \
          '[.[] | select(($s == "" or $s == "all" or (.state | ascii_downcase) == $s) and ($l == "" or any(.labels[]?; .name == $l)))]' | project)" ;;
      view)
        allow --repo --json --jq; need_repo; need_num; need_json
        [ -n "${GH_PR_VIEW_FAIL-}" ] && { echo "GraphQL: Could not resolve to a PullRequest with the number of $n. (repository.pullRequest)" >&2; exit 1; }
        emit "$(labels_json "${GH_PR_LABELS-auto:reviewing}" \
          | jq -c --argjson n "$n" --arg h "${GH_PR_HEAD-}" '{number: $n, labels: ., headRefOid: $h}' | project)" ;;
      edit)
        allow --repo --add-label --remove-label; need_repo; need_num
        case "$flags" in *-label*) ;; *) die "pr edit without a label flag" ;; esac
        for l in ${adds[@]+"${adds[@]}"}; do
          case " $LABELS " in *" $l "*) ;; *) printf 'FAIL %s\n' "$ARGV" >> "$GH_WRITES"; echo "'$l' not found" >&2; exit 1 ;; esac
        done
        write_call "${GH_EDIT_FAIL-}" || { echo "failed to update https://github.com/$KNOWN/pull/$n: HTTP 502" >&2; exit 1; }
        echo "https://github.com/$KNOWN/pull/$n" ;;
      comment)
        allow --repo --body; need_repo; need_num
        case "$flags" in *" --body "*) ;; *) die "pr comment without --body" ;; esac
        write_call "${GH_COMMENT_FAIL-}" || { echo "HTTP 403: Resource not accessible by integration" >&2; exit 1; }
        echo "https://github.com/$KNOWN/pull/$n#issuecomment-1" ;;
      *) die "unsupported: gh pr $act" ;;
    esac ;;
  *) die "unsupported: gh $sub" ;;
esac
GHEOF
chmod +x "$ROOT/bin/gh"
GH_WRITES="$ROOT/writes.log"; GH_CALLS="$ROOT/calls.log"; RESULTS="$ROOT/results.tsv"
: > "$RESULTS"
argv_json() { printf '%s\037' "$@" | jq -Rsc 'split("\u001f") | .[:-1]'; }

# --- constants + fixtures ---
R=acme/widgets; N=7; ME=loopbot; BOT='afk-loop[bot]'
SHA=0123456789abcdef0123456789abcdef01234567
OLD_SHA=fedcba9876543210fedcba9876543210fedcba98
MK="<!-- afk-review reviewed sha="
REASON_TXT='review crashed: no verdict line'
INJ='x" or true or "'
INJ_NL=$'loopbot\n" or true or "'
REASON_APOS="review didn't produce a verdict"
REASON_INJ="x'; touch $ROOT/pwned; echo '"'$(id)'
REASON_SED='a & b \1 \\ c | d / e `touch '"$ROOT"'/pwned` "q" %s'
NL=$'\n'

cfx() { # cfx <name> <login> <body> [<login> <body>]... → GH_FX dir; appends one page to comments-7.json
  local d="$ROOT/fx/$1"; shift; mkdir -p "$d"
  printf '%s\037' "$@" | jq -Rsc --argjson base "$(( $(cat "$d/comments-$N.json" 2>/dev/null | wc -l) * 100 + 1000 ))" \
    'split("\u001f")[:-1] as $a | [range(0; $a | length; 2) as $i | {id: ($base + $i), user: {login: $a[$i], type: "User"}, body: $a[$i + 1]}]' \
    >> "$d/comments-$N.json"
  printf '%s' "$d"
}
tfx() { # tfx <name> <pr> <created_at of the auto:reviewing label event | ""> — appends one timeline page
  local d="$ROOT/fx/$1"; mkdir -p "$d"
  jq -cn --arg t "$3" '[{event: "labeled", label: {name: "auto:needs-review"}, created_at: "2020-01-01T00:00:00Z"},
                       {event: "commented", created_at: "2020-01-01T00:05:00Z"}]
                       + (if $t == "" then [] else [{event: "labeled", label: {name: "auto:reviewing"}, created_at: $t}] end)' \
    >> "$d/timeline-$2.json"
  printf '%s' "$d"
}
pr_obj() { jq -cn --argjson n "$1" --arg s "$2" --arg st "$3" --arg l "$4" '{number: $n, headRefOid: $s, state: $st, title: "t", labels: [{name: $l}]}'; }

OLD=$(date -u -v-200M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '200 minutes ago' +%Y-%m-%dT%H:%M:%SZ)
NEW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

FX_R1=$(cfx r1 alice "LGTM, nice work" "$ME" "$MK$SHA -->")
FX_R1B=$(cfx r1b "$ME" "$MK$SHA verdict=ready -->")
FX_R1C=$(cfx r1c "$ME" "$MK$SHA verdict=needs-fixes -->")
FX_R2=$(cfx r2 alice "LGTM" mallory "$MK$SHA verdict=ready -->")
FX_R2B=$(cfx r2b mallory "$MK$SHA -->")
FX_R3=$(cfx r3 "$ME" "## Review${NL}No blockers.${NL}${NL}$MK$SHA verdict=ready -->${NL}")
FX_R4=$(cfx r4 "$ME" "$MK$OLD_SHA verdict=ready -->")
FX_R10=$(cfx r10 mallory "just a normal comment")
FX_R11=$(cfx r11 "$BOT" "$MK$SHA verdict=ready -->")
FX_R12=$(cfx r12 "$ME" "$MK$SHA verdict=maybe -->")
cfx r13 alice "first page" bob "still first page" >/dev/null
FX_R13=$(cfx r13 "$ME" "$MK$SHA verdict=needs-fixes -->")

FX_STALE=$(tfx stale 7 "$OLD")
FX_FRESH=$(tfx fresh 7 "$NEW")
FX_NOEVT=$(tfx noevt 7 "")
tfx twostale 7 "$OLD" >/dev/null; FX_TWO=$(tfx twostale 8 "$OLD")
tfx reapplied 7 "$OLD" >/dev/null; FX_REAPPLIED=$(tfx reapplied 7 "$NEW")

PRS_SWEEP1="$ROOT/fx/prs-sweep1.json"; PRS_SWEEP2="$ROOT/fx/prs-sweep2.json"; PRS_SELECT="$ROOT/fx/prs-select.json"
{ pr_obj 7 "$SHA" OPEN auto:reviewing; pr_obj 9 "$SHA" OPEN auto:needs-fixes; } | jq -sc . > "$PRS_SWEEP1"
{ pr_obj 7 "$SHA" OPEN auto:reviewing; pr_obj 8 "$OLD_SHA" OPEN auto:reviewing; } | jq -sc . > "$PRS_SWEEP2"
{ pr_obj 7 "$SHA" OPEN auto:needs-review; pr_obj 8 "$OLD_SHA" OPEN auto:needs-review
  pr_obj 9 "$SHA" OPEN auto:needs-fixes; pr_obj 10 "$SHA" CLOSED auto:needs-review; } | jq -sc . > "$PRS_SELECT"

# --- block runner ---
# Literal (non-regex) placeholder substitution: a value may hold any of & \ | / ' " $ ` and is
# inserted byte-for-byte, as the loop would write it.
subst() {
  P_REPO=$1 P_N=$2 P_SHA=$3 P_VERDICT=$4 P_REASON=$5 awk '
    function rep(s, ph, v,   out, i) {
      out = ""
      while ((i = index(s, ph)) > 0) { out = out substr(s, 1, i - 1) v; s = substr(s, i + length(ph)) }
      return out s
    }
    { l = rep($0, "<owner/repo>", ENVIRON["P_REPO"]); l = rep(l, "<N>", ENVIRON["P_N"])
      l = rep(l, "<SHA>", ENVIRON["P_SHA"]); l = rep(l, "<VERDICT>", ENVIRON["P_VERDICT"])
      print rep(l, "<REASON>", ENVIRON["P_REASON"]) }'
}
# runblk <block#> [@REPO=|@N=|@SHA=|@VERDICT=|@REASON= placeholder values] [VAR=value env for the block]...
# Sets OUT (stdout+stderr), RC, STATUS (AFKREV_* lines), WRITES, CALLS.
runblk() {
  BLK=$1; shift
  local p_repo=$R p_n=$N p_sha=$SHA p_verdict=ready p_reason=$REASON_TXT a script envs=()
  for a in "$@"; do
    case "$a" in
      @REPO=*) p_repo=${a#@REPO=} ;;
      @N=*) p_n=${a#@N=} ;;
      @SHA=*) p_sha=${a#@SHA=} ;;
      @VERDICT=*) p_verdict=${a#@VERDICT=} ;;
      @REASON=*) p_reason=${a#@REASON=} ;;
      *) envs+=("$a") ;;
    esac
  done
  script=$(block "$BLK" | subst "$p_repo" "$p_n" "$p_sha" "$p_verdict" "$p_reason")
  : > "$GH_WRITES"; : > "$GH_CALLS"
  # - env -i: a maintainer's own AFK_LOOP_LOGIN / GH_TOKEN must not leak into a case.
  # - GH_PR_HEAD defaults to the PR's head being unchanged since Step 2; a case's envs override it.
  OUT=$(cd "$ROOT/work" && env -i PATH="$ROOT/bin:$PATH" HOME="$ROOT/home" TMPDIR="$ROOT/tmp" \
    GH_CONFIG_DIR="$ROOT/ghconfig" GH_WRITES="$GH_WRITES" GH_CALLS="$GH_CALLS" GH_PR_HEAD="$SHA" \
    ${envs[@]+"${envs[@]}"} $SHCMD -c "$script" 2>&1 </dev/null)
  RC=$?
  STATUS=$(printf '%s\n' "$OUT" | grep -E '^AFKREV_(OK|SKIP|PROCEED|ERROR|ABORT)( |$)')
  WRITES=$(cat "$GH_WRITES"); CALLS=$(cat "$GH_CALLS")
}

# --- assertions: begin, any number of want_*, then done_case ---
PASS=0; FAIL=0
begin() { CID=$1; CDESC=$2; WHY=""; EXP=""; }
why() { WHY="$WHY        - $*$NL"; }
ind() { printf '%s' "$1" | sed 's/^/            /'; }
want_status() { [ "$STATUS" = "$1" ] || why "status: want '$1' | got '$STATUS'"; }
want_status_prefix() { case "$STATUS" in "$1"*) ;; *) why "status: want prefix '$1' | got '$STATUS'" ;; esac; }
want_out_has() { case "$OUT" in *"$1"*) ;; *) why "output lacks '$1'" ;; esac; }
want_out_lacks() { case "$OUT" in *"$1"*) why "output must not contain '$1'" ;; esac; }
want_rc() { [ "$RC" = "$1" ] || why "exit $RC, want $1"; }
want_eq() { [ "$2" = "$3" ] || why "$1: want '$3' | got '$2'"; }
want_no_writes() { [ -z "$WRITES" ] || why "unexpected writes:$NL$(ind "$WRITES")"; }
want_no_calls() { [ -z "$CALLS" ] || why "unexpected gh calls:$NL$(ind "$CALLS")"; }
want_call() { case "$CALLS" in *"$1"*) ;; *) why "no gh call containing $1" ;; esac; }
want_no_call() { case "$CALLS" in *"$1"*) why "unexpected gh call containing $1" ;; esac; }
exp() { local st=$1; shift; EXP="${EXP:+$EXP$NL}$st $(argv_json "$@")"; }   # one expected write line
want_writes() { [ "$WRITES" = "$EXP" ] || why "writes differ$NL          want:$NL$(ind "$EXP")$NL          got:$NL$(ind "${WRITES:-(none)}")"; }
done_case() {
  local p
  # block 3 (select) prints the PR list, not a status line, on success
  if [ "$BLK" != 3 ]; then
    [ "$(printf '%s' "$STATUS" | grep -c '^AFKREV_')" = 1 ] || why "want exactly one AFKREV_ status line"
  fi
  case "$STATUS" in
    AFKREV_OK*|AFKREV_SKIP*|AFKREV_PROCEED*) [ "$RC" = 0 ] || why "status ${STATUS%% *} but exit $RC" ;;
    AFKREV_ERROR*|AFKREV_ABORT*) [ "$RC" = 1 ] || why "status ${STATUS%% *} but exit $RC" ;;
  esac
  printf '%s\n' "$OUT" | grep -Eq '^(bash|zsh):' && why "shell diagnostic in output"
  for p in '<owner/repo>' '<N>' '<SHA>' '<VERDICT>' '<REASON>'; do
    case "$CALLS" in *"$p"*) why "unsubstituted $p reached gh" ;; esac
  done
  if [ -z "$WHY" ]; then
    PASS=$((PASS + 1)); printf '  PASS  [%s] %-4s %s\n' "$SHN" "$CID" "$CDESC"; res=PASS
  else
    FAIL=$((FAIL + 1)); printf '  FAIL  [%s] %-4s %s\n%s' "$SHN" "$CID" "$CDESC" "$WHY"
    printf '%s\n' "$OUT" | sed 's/^/        | /'; res=FAIL
  fi
  printf '%s\t%s\t%s\t%s\n' "$CID" "$SHN" "$res" "$CDESC" >> "$RESULTS"
}
hdr() { say "=== [$SHN] $* ==="; }

suite() {
  hdr "preconditions (block 1)"
  begin P1 "all good -> OK running as <login>"
  runblk 1; want_status "AFKREV_OK running as $ME"; want_no_writes; done_case
  begin P2 "/user 403, no override -> ABORT"
  runblk 1 GH_USER_FAIL=1; want_status_prefix "AFKREV_ABORT cannot resolve the GitHub login"; want_no_writes; done_case
  begin P2b "/user transport error, no override -> ABORT"
  runblk 1 GH_USER_FAIL=net; want_status_prefix "AFKREV_ABORT cannot resolve the GitHub login"; want_no_writes; done_case
  begin P3 "/user 403 + AFK_LOOP_LOGIN -> OK, unverified"
  runblk 1 GH_USER_FAIL=1 "AFK_LOOP_LOGIN=$BOT"; want_status "AFKREV_OK running as $BOT (unverified: /user unavailable)"
  want_call '["api","user",'; want_no_writes; done_case
  begin P3b "/user transport error + AFK_LOOP_LOGIN -> OK, unverified"
  runblk 1 GH_USER_FAIL=net "AFK_LOOP_LOGIN=$BOT"; want_status "AFKREV_OK running as $BOT (unverified: /user unavailable)"
  want_no_writes; done_case
  begin P4 "triage false -> ABORT naming the login"
  runblk 1 GH_TRIAGE=false; want_status_prefix "AFKREV_ABORT running as $ME, which cannot label PRs on $R"; want_no_writes; done_case
  begin P4b "repo API error -> ABORT as a gh error"
  runblk 1 GH_REPO_API_FAIL=1
  want_status "AFKREV_ABORT could not read permissions on $R (gh error — not a missing-permission condition)"; want_no_writes; done_case
  begin P4c "permissions absent -> ABORT"
  runblk 1 GH_TRIAGE=absent; want_status_prefix "AFKREV_ABORT running as $ME, which cannot label PRs on $R"; want_no_writes; done_case
  begin P5 "cwd repo mismatch -> ABORT"
  runblk 1 GH_CWD_REPO=someone/else; want_status_prefix "AFKREV_ABORT cwd repo is 'someone/else', not '$R'"; want_no_writes; done_case
  begin P5b "cwd not a checkout -> ABORT ('none')"
  runblk 1 GH_REPO_VIEW_FAIL=1; want_status_prefix "AFKREV_ABORT cwd repo is 'none', not '$R'"; want_no_writes; done_case
  begin P6 "label list gh error -> ABORT, no bootstrap hint"
  runblk 1 GH_LABEL_FAIL=1; want_status_prefix "AFKREV_ABORT could not list labels on $R (gh error"
  want_out_lacks bootstrap; want_no_writes; done_case
  begin P7 "missing label -> ABORT naming it"
  runblk 1 "GH_LABELS=bug auto:needs-review auto:reviewing auto:needs-fixes auto:ready"
  want_status_prefix "AFKREV_ABORT AFK label 'auto:needs-human' missing on $R"; want_out_has "bootstrap-afk-labels.cjs"; want_no_writes; done_case
  begin P7b "near-miss label name doesn't count"
  runblk 1 "GH_LABELS=auto:needs-review auto:reviewing auto:needs-fixes auto:ready-soon auto:needs-human"
  want_status_prefix "AFKREV_ABORT AFK label 'auto:ready' missing on $R"; want_no_writes; done_case
  # P8/P8b: /user unreachable, so the override meets the login validation rather than the mismatch check
  begin P8 "AFK_LOOP_LOGIN with jq metacharacters -> ABORT"
  runblk 1 GH_USER_FAIL=net "AFK_LOOP_LOGIN=$INJ"; want_status_prefix "AFKREV_ABORT cannot resolve the GitHub login"; want_no_writes; done_case
  begin P8b "multi-line AFK_LOOP_LOGIN -> ABORT"
  runblk 1 GH_USER_FAIL=net "AFK_LOOP_LOGIN=$INJ_NL"; want_status_prefix "AFKREV_ABORT cannot resolve the GitHub login"; want_no_writes; done_case
  begin P9 "override differs from /user -> ABORT"
  runblk 1 "AFK_LOOP_LOGIN=other-bot"; want_status "AFKREV_ABORT AFK_LOOP_LOGIN is other-bot but the token authenticates as $ME"
  want_no_writes; done_case
  begin P10 "override equals /user -> OK, verified"
  runblk 1 "AFK_LOOP_LOGIN=$ME"; want_status "AFKREV_OK running as $ME"; want_out_lacks unverified; want_no_writes; done_case

  hdr "stale-claim sweep (block 2)"
  begin SW1 "stale claim reclaimed; repo reaches gh"
  runblk 2 "GH_PRS=$PRS_SWEEP1" "GH_FX=$FX_STALE"; want_status "AFKREV_OK sweep done"; want_out_lacks "https://github.com/"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-review; want_writes
  want_call "[\"pr\",\"list\",\"--repo\",\"$R\",\"--state\",\"open\",\"--label\",\"auto:reviewing\","
  want_call "[\"api\",\"repos/$R/issues/7/timeline\",\"--paginate\",\"--jq\","; done_case
  begin SW2 "fresh claim left alone"
  runblk 2 "GH_PRS=$PRS_SWEEP1" "GH_FX=$FX_FRESH"; want_status "AFKREV_OK sweep done"; want_no_writes; done_case
  begin SW3 "list gh error -> sweep skipped"
  runblk 2 "GH_PRS=$PRS_SWEEP1" "GH_FX=$FX_STALE" GH_PR_LIST_FAIL=1
  want_status "AFKREV_OK sweep skipped (gh error listing auto:reviewing)"; want_no_call '/timeline"'; want_no_writes; done_case
  begin SW4 "timeline fetch fails -> claim left"
  runblk 2 "GH_PRS=$PRS_SWEEP1" "GH_FX=$FX_STALE" GH_TIMELINE_FAIL=1
  want_status "AFKREV_OK sweep done"; want_out_has "#7: timeline fetch failed"; want_no_writes; done_case
  begin SW5 "two stale claims -> both reclaimed"
  runblk 2 "GH_PRS=$PRS_SWEEP2" "GH_FX=$FX_TWO"; want_status "AFKREV_OK sweep done"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-review
  exp ok pr edit 8 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-review; want_writes; done_case
  begin SW6 "re-applied on a later page -> latest wins, left"
  runblk 2 "GH_PRS=$PRS_SWEEP1" "GH_FX=$FX_REAPPLIED"; want_status "AFKREV_OK sweep done"; want_no_writes; done_case
  begin SW7 "no labeled event -> left"
  runblk 2 "GH_PRS=$PRS_SWEEP1" "GH_FX=$FX_NOEVT"; want_status "AFKREV_OK sweep done"; want_no_writes; done_case
  begin SW8 "reclaim edit fails -> noted, sweep done"
  runblk 2 "GH_PRS=$PRS_SWEEP1" "GH_FX=$FX_STALE" GH_EDIT_FAIL=1; want_status "AFKREV_OK sweep done"
  want_out_has "#7: reclaim failed — will retry next sweep"
  exp FAIL pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-review; want_writes; done_case

  hdr "select (block 3)"
  begin S1 "prints open needs-review PRs; repo reaches gh"
  runblk 3 "GH_PRS=$PRS_SELECT"; want_rc 0
  want_eq "selected" "$(printf '%s' "$OUT" | jq -c 'map([.number, .headRefOid])' 2>&1)" "[[7,\"$SHA\"],[8,\"$OLD_SHA\"]]"
  want_eq "fields" "$(printf '%s' "$OUT" | jq -c 'map(keys) | add | unique' 2>&1)" '["headRefOid","number"]'
  want_call "$(argv_json pr list --repo "$R" --state open --label auto:needs-review --limit 200 --json number,headRefOid)"
  want_no_writes; done_case
  begin S2 "gh error -> ABORT"
  runblk 3 "GH_PRS=$PRS_SELECT" GH_PR_LIST_FAIL=1
  want_status "AFKREV_ABORT could not list auto:needs-review PRs (gh error)"; want_rc 1; want_no_writes; done_case
  begin S3 "none awaiting -> empty list"
  runblk 3; want_rc 0; want_eq "selected" "$(printf '%s' "$OUT" | jq -c . 2>&1)" '[]'; want_no_writes; done_case

  hdr "SHA-skip (block 4)"
  begin R1 "own legacy marker -> SKIP"
  runblk 4 "GH_FX=$FX_R1"; want_status "AFKREV_SKIP sha=$SHA already reviewed by $ME"
  want_call "[\"api\",\"repos/$R/issues/7/comments\",\"--paginate\",\"--jq\","; want_no_writes; done_case
  begin R1b "own verdict=ready marker -> SKIP"
  runblk 4 "GH_FX=$FX_R1B"; want_status "AFKREV_SKIP sha=$SHA already reviewed by $ME"; want_no_writes; done_case
  begin R1c "own verdict=needs-fixes marker -> SKIP"
  runblk 4 "GH_FX=$FX_R1C"; want_status "AFKREV_SKIP sha=$SHA already reviewed by $ME"; want_no_writes; done_case
  begin R2 "identical marker from another login -> PROCEED"
  runblk 4 "GH_FX=$FX_R2"; want_status "AFKREV_PROCEED"; want_no_writes; done_case
  begin R2b "forged legacy marker -> PROCEED"
  runblk 4 "GH_FX=$FX_R2B"; want_status "AFKREV_PROCEED"; want_no_writes; done_case
  begin R3 "own prose quoting the marker -> PROCEED"
  runblk 4 "GH_FX=$FX_R3"; want_status "AFKREV_PROCEED"; want_no_writes; done_case
  begin R4 "own marker for an older SHA -> PROCEED"
  runblk 4 "GH_FX=$FX_R4"; want_status "AFKREV_PROCEED"; want_no_writes; done_case
  begin R5 "empty SHA -> ERROR before any gh call"
  runblk 4 @SHA= "GH_FX=$FX_R1"; want_status "AFKREV_ERROR no valid head sha ('')"; want_no_calls; done_case
  begin R5b "non-hex SHA -> ERROR"
  runblk 4 "@SHA=${SHA%?}g" "GH_FX=$FX_R1"; want_status_prefix "AFKREV_ERROR no valid head sha"; want_no_calls; done_case
  begin R5c "short SHA -> ERROR"
  runblk 4 "@SHA=${SHA:0:7}" "GH_FX=$FX_R1"; want_status_prefix "AFKREV_ERROR no valid head sha"; want_no_calls; done_case
  begin R6 "/user fails -> ERROR, never SKIP"
  runblk 4 "GH_FX=$FX_R1" GH_USER_FAIL=1; want_status "AFKREV_ERROR cannot resolve this loop's GitHub login"; want_no_writes; done_case
  begin R7 "/user fails + AFK_LOOP_LOGIN -> SKIP"
  runblk 4 "GH_FX=$FX_R1" GH_USER_FAIL=1 "AFK_LOOP_LOGIN=$ME"; want_status "AFKREV_SKIP sha=$SHA already reviewed by $ME"; want_no_writes; done_case
  begin R8 "reader login differs from writer -> PROCEED"
  runblk 4 "GH_FX=$FX_R1B" GH_LOGIN=other-bot; want_status "AFKREV_PROCEED"; want_no_writes; done_case
  begin R9 "comments fetch fails -> ERROR, never SKIP"
  runblk 4 "GH_FX=$FX_R1" GH_COMMENTS_FAIL=1; want_status "AFKREV_ERROR comments fetch failed"; want_no_writes; done_case
  begin R10 "AFK_LOOP_LOGIN with jq metacharacters -> ERROR"
  runblk 4 "GH_FX=$FX_R10" "AFK_LOOP_LOGIN=$INJ"; want_status "AFKREV_ERROR cannot resolve this loop's GitHub login"
  want_no_call '/comments"'; done_case
  begin R10b "/user returns metacharacters -> ERROR"
  runblk 4 "GH_FX=$FX_R10" "GH_LOGIN=$INJ"; want_status "AFKREV_ERROR cannot resolve this loop's GitHub login"
  want_no_call '/comments"'; done_case
  begin R10c "multi-line AFK_LOOP_LOGIN -> ERROR"
  runblk 4 "GH_FX=$FX_R10" "AFK_LOOP_LOGIN=$INJ_NL"; want_status "AFKREV_ERROR cannot resolve this loop's GitHub login"
  want_no_call '/comments"'; done_case
  begin R11 "name[bot] login on both sides -> SKIP"
  runblk 4 "GH_FX=$FX_R11" "GH_LOGIN=$BOT"; want_status "AFKREV_SKIP sha=$SHA already reviewed by $BOT"; want_no_writes; done_case
  begin R12 "unknown verdict value -> PROCEED"
  runblk 4 "GH_FX=$FX_R12"; want_status "AFKREV_PROCEED"; want_no_writes; done_case
  begin R13 "own marker on page 2 -> SKIP"
  runblk 4 "GH_FX=$FX_R13"; want_status "AFKREV_SKIP sha=$SHA already reviewed by $ME"; want_no_writes; done_case

  hdr "claim (block 5) + not-eligible release (block 6)"
  begin C1 "claim succeeds -> exact edit"
  runblk 5; want_status "AFKREV_OK claimed"
  exp ok pr edit 7 --repo "$R" --add-label auto:reviewing --remove-label auto:needs-review; want_writes; done_case
  begin C2 "claim edit fails -> ERROR"
  runblk 5 GH_EDIT_FAIL=1; want_status "AFKREV_ERROR claim"
  exp FAIL pr edit 7 --repo "$R" --add-label auto:reviewing --remove-label auto:needs-review; want_writes; done_case
  begin L1 "release succeeds -> edit, no marker"
  runblk 6; want_status "AFKREV_OK released (not eligible)"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-review; want_writes; done_case
  begin L2 "release edit fails -> ERROR"
  runblk 6 GH_EDIT_FAIL=1; want_status "AFKREV_ERROR release"
  exp FAIL pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-review; want_writes; done_case

  hdr "transition + mark (block 7)"
  begin W1 "ready -> edit, then exact marker comment"
  runblk 7 @VERDICT=ready; want_status "AFKREV_OK auto:ready marked=$SHA"
  want_call "$(argv_json pr view 7 --repo "$R" --json headRefOid --jq .headRefOid)"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:ready
  exp ok pr comment 7 --repo "$R" --body "<!-- afk-review reviewed sha=$SHA verdict=ready -->"; want_writes; done_case
  BODY_READY=$(printf '%s\n' "$WRITES" | sed -n 's/^ok //p' | jq -r 'select(.[1] == "comment") | .[index("--body") + 1]')
  begin W1b "needs-fixes -> edit, then exact marker comment"
  runblk 7 @VERDICT=needs-fixes; want_status "AFKREV_OK auto:needs-fixes marked=$SHA"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-fixes
  exp ok pr comment 7 --repo "$R" --body "<!-- afk-review reviewed sha=$SHA verdict=needs-fixes -->"; want_writes; done_case
  BODY_NF=$(printf '%s\n' "$WRITES" | sed -n 's/^ok //p' | jq -r 'select(.[1] == "comment") | .[index("--body") + 1]')
  begin W2 "edit fails -> ERROR, no comment"
  runblk 7 GH_EDIT_FAIL=1; want_status "AFKREV_ERROR transition"; want_no_call '["pr","view",'
  exp FAIL pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:ready; want_writes; done_case
  begin W3 "empty SHA -> edit, no comment, marked=none"
  runblk 7 @SHA=; want_status "AFKREV_OK auto:ready marked=none"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:ready; want_writes; done_case
  begin W3b "non-hex SHA -> edit, no comment, marked=none"
  runblk 7 "@SHA=${SHA%?}g"; want_status "AFKREV_OK auto:ready marked=none"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:ready; want_writes; done_case
  begin W4 "comment fails -> still OK, marked=none"
  runblk 7 GH_COMMENT_FAIL=1; want_status "AFKREV_OK auto:ready marked=none"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:ready
  exp FAIL pr comment 7 --repo "$R" --body "<!-- afk-review reviewed sha=$SHA verdict=ready -->"; want_writes; done_case
  begin W6 "head moved during review -> edit only, marked=none"
  runblk 7 "GH_PR_HEAD=$OLD_SHA"; want_status "AFKREV_OK auto:ready marked=none"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:ready; want_writes; done_case
  begin W7 "head read fails -> edit only, marked=none"
  runblk 7 GH_PR_VIEW_FAIL=1; want_status "AFKREV_OK auto:ready marked=none"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:ready; want_writes; done_case
  begin W5 "unsubstituted verdict -> ERROR, no gh call"
  runblk 7 '@VERDICT=<VERDICT>'; want_status "AFKREV_ERROR bad verdict '<VERDICT>'"; want_no_calls; done_case
  begin W5b "bad verdict 'pass' -> ERROR, no gh call"
  runblk 7 @VERDICT=pass; want_status "AFKREV_ERROR bad verdict 'pass'"; want_no_calls; done_case

  hdr "round trip: block 7's marker read back by block 4"
  begin RT1 "W1's ready marker -> SKIP"
  if [ -n "$BODY_READY" ]; then runblk 4 "GH_FX=$(cfx "rt-ready-$SHN" "$ME" "$BODY_READY")"; want_status "AFKREV_SKIP sha=$SHA already reviewed by $ME"
  else BLK=4; OUT=""; STATUS=""; RC=""; WRITES=""; CALLS=""; why "W1 logged no comment body"; fi
  done_case
  begin RT2 "W1b's needs-fixes marker -> SKIP"
  if [ -n "$BODY_NF" ]; then runblk 4 "GH_FX=$(cfx "rt-nf-$SHN" "$ME" "$BODY_NF")"; want_status "AFKREV_SKIP sha=$SHA already reviewed by $ME"
  else BLK=4; OUT=""; STATUS=""; RC=""; WRITES=""; CALLS=""; why "W1b logged no comment body"; fi
  done_case

  hdr "escalate (block 8)"
  begin E1 "claim owned -> comment, then edit"
  runblk 8; want_status "AFKREV_OK needs-human"
  want_call "[\"pr\",\"view\",\"7\",\"--repo\",\"$R\",\"--json\",\"labels\",\"--jq\","
  exp ok pr comment 7 --repo "$R" --body "afk-review: escalating to needs-human — $REASON_TXT"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-human; want_writes; done_case
  begin E2 "claim lost -> ERROR, no writes"
  runblk 8 "GH_PR_LABELS=auto:needs-fixes"; want_status "AFKREV_ERROR lost claim — another run owns it, not escalating"; want_no_writes; done_case
  begin E2b "label lookup fails -> ERROR, no writes"
  runblk 8 GH_PR_VIEW_FAIL=1; want_status_prefix "AFKREV_ERROR lost claim"; want_no_writes; done_case
  begin E3 "comment fails -> ERROR, no edit"
  runblk 8 GH_COMMENT_FAIL=1; want_status "AFKREV_ERROR escalation comment failed"
  exp FAIL pr comment 7 --repo "$R" --body "afk-review: escalating to needs-human — $REASON_TXT"; want_writes; done_case
  begin E4 "edit fails after comment -> ERROR"
  runblk 8 GH_EDIT_FAIL=1; want_status "AFKREV_ERROR escalation label move failed"
  exp ok pr comment 7 --repo "$R" --body "afk-review: escalating to needs-human — $REASON_TXT"
  exp FAIL pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-human; want_writes; done_case
  begin E5 "reason with an apostrophe -> verbatim"
  runblk 8 "@REASON=$REASON_APOS"; want_status "AFKREV_OK needs-human"
  exp ok pr comment 7 --repo "$R" --body "afk-review: escalating to needs-human — $REASON_APOS"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-human; want_writes; done_case
  begin E6 "reason with shell injection -> verbatim, nothing runs"
  rm -f "$ROOT/pwned"; runblk 8 "@REASON=$REASON_INJ"; want_status "AFKREV_OK needs-human"
  exp ok pr comment 7 --repo "$R" --body "afk-review: escalating to needs-human — $REASON_INJ"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-human; want_writes
  [ -e "$ROOT/pwned" ] && why "reason text was executed: $ROOT/pwned exists"; done_case
  begin E6b "reason with & \\ | / and backticks -> verbatim"
  rm -f "$ROOT/pwned"; runblk 8 "@REASON=$REASON_SED"; want_status "AFKREV_OK needs-human"
  exp ok pr comment 7 --repo "$R" --body "afk-review: escalating to needs-human — $REASON_SED"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-human; want_writes
  [ -e "$ROOT/pwned" ] && why "reason text was executed: $ROOT/pwned exists"; done_case
  begin E8 "multi-line reason -> first line only, the rest never runs"
  rm -f "$ROOT/pwned"; runblk 8 "@REASON=first line${NL}touch $ROOT/pwned"; want_status "AFKREV_OK needs-human"
  exp ok pr comment 7 --repo "$R" --body "afk-review: escalating to needs-human — first line"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-human; want_writes
  [ -e "$ROOT/pwned" ] && why "reason text was executed: $ROOT/pwned exists"; done_case
  begin E7 "unsubstituted <REASON> -> ERROR, no gh call"
  runblk 8 '@REASON=<REASON>'; want_status "AFKREV_ERROR no escalation reason"; want_no_calls; done_case
  begin E7b "empty reason -> ERROR, no gh call"
  runblk 8 '@REASON='; want_status "AFKREV_ERROR no escalation reason"; want_no_calls; done_case
}

# --- preflight: block map + the stub shadows any real gh in every shell ---
[ "$nblocks" = 8 ] || { say "block map: found $nblocks \`\`\`bash blocks in $SKILL, expected 8 — update this harness's block indices"; exit 2; }
FP=("" 'gh label list' 'issues/$n/timeline' '--label auto:needs-review --limit 200 --json number,headRefOid'
    'issues/$N/comments' 'AFKREV_OK claimed' 'released (not eligible)' '--add-label "auto:$VERDICT"' 'escalating to needs-human')
for i in 1 2 3 4 5 6 7 8; do
  block "$i" | grep -qF -- "${FP[$i]}" || { say "block map: block $i no longer contains '${FP[$i]}' — update this harness's block indices"; exit 2; }
done
SHELLS="bash"
if command -v zsh >/dev/null 2>&1; then SHELLS="bash zsh"
else say "NOTICE: zsh not found — skipping the zsh variant of every case"; fi
for SHN in $SHELLS; do
  case "$SHN" in zsh) SHCMD="zsh -f" ;; *) SHCMD="bash" ;; esac
  got=$(env -i PATH="$ROOT/bin:$PATH" HOME="$ROOT/home" $SHCMD -c 'command -v gh')
  [ "$got" = "$ROOT/bin/gh" ] || { say "preflight [$SHN]: gh resolves to '$got', not the stub — refusing to run"; exit 2; }
  say "shell [$SHN]: $($SHCMD -c 'echo ${BASH_VERSION:-$ZSH_VERSION}')"
done
say "skill: $SKILL"

for SHN in $SHELLS; do
  case "$SHN" in zsh) SHCMD="zsh -f" ;; *) SHCMD="bash" ;; esac
  suite
done

say ""
say "=== case table ==="
awk -F'\t' '
  !($1 in seen) { seen[$1] = 1; ord[++k] = $1; d[$1] = $4 }
  { r[$1, $2] = $3 }
  END {
    printf "  %-5s %-5s %-5s %s\n", "case", "bash", "zsh", "description"
    for (i = 1; i <= k; i++) {
      id = ord[i]; z = ((id, "zsh") in r) ? r[id, "zsh"] : "skip"
      printf "  %-5s %-5s %-5s %s\n", id, r[id, "bash"], z, d[id]
    }
  }' "$RESULTS"
say ""
say "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
