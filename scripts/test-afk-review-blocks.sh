#!/usr/bin/env bash
# Execution harness for skills/afk-review/SKILL.md.
# - Extracts each ```bash block verbatim (indented list-item fences included), substitutes the
#   placeholders, and runs it as its OWN process under bash and zsh, the way the loop executes it.
# - gh is a stub that evaluates --jq with real jq against fixture JSON, so the skill's filters are
#   under test, not canned answers. It logs every write (pr edit / pr comment) with its exact argv.
# - Asserts on the block's AFKREV_* status line, its exit code, and the write log.
#
# usage: test-afk-review-blocks.sh [--mutation-check] [path to afk-review SKILL.md]
#   --mutation-check  run the suite against the skill and against a copy with block 4's author check
#                     removed. Passes only if R2 passes on the skill and, on the mutant, fails solely
#                     because the other login's marker is trusted (AFKREV_SKIP), and every other case
#                     the mutant breaks is in MUT_AUTHOR_CASES.
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
if [ "${AFK_REQUIRE_ZSH-}" = 1 ] && ! command -v zsh >/dev/null 2>&1; then
  say "FAIL: AFK_REQUIRE_ZSH=1 but zsh is not on PATH — install zsh, or unset AFK_REQUIRE_ZSH to run bash only"; exit 1
fi
NL=$'\n'
R=acme/widgets; N=7; ME=loopbot; BOT='afk-loop[bot]'
SHA=0123456789abcdef0123456789abcdef01234567
OLD_SHA=fedcba9876543210fedcba9876543210fedcba98

if [ "$MODE" = mutation ]; then
  # Cases whose fixture is a marker by a login other than the one block 4 is given (R17b: no login).
  MUT_AUTHOR_CASES="R2 R2b R7 R8 R17b"
  MUTANT="$ROOT/SKILL.md"
  sed 's/((\.user\.login \/\/ [^)]*) | ascii_downcase) == \\"\$LC_LOGIN\\" and //' "$SKILL" > "$MUTANT"
  d=$(diff "$SKILL" "$MUTANT")
  if [ "$(printf '%s\n' "$d" | grep -c '^<')" != 1 ] || ! printf '%s\n' "$d" | grep -q '^<.*issues/\$N/comments'; then
    say "MUTATION CHECK: mutation did not apply to exactly block 4's comments filter — its author check changed shape; update the sed"; exit 2
  fi
  say "=== mutant: block 4 author check removed ==="
  printf '%s\n' "$d" | sed 's/^/  /'
  real=$(bash "$SELF" "$SKILL" 2>&1); mut=$(bash "$SELF" "$MUTANT" 2>&1)
  heads() { printf '%s\n' "$1" | grep -E "^  (PASS|FAIL)  \[(bash|zsh)\] $2 "; }
  # the "- …" reason lines printed under each FAIL header of case $2
  reasons() {
    printf '%s\n' "$1" | awk -v id="$2" '
      /^  (PASS|FAIL)  \[[a-z]+\] / { grab = ($1 == "FAIL" && $3 == id); next }
      grab && /^        - / { sub(/^        - /, ""); print; next }
      { grab = 0 }'
  }
  fails() { printf '%s\n' "$1" | awk '/^  FAIL  \[[a-z]+\] / { print $3 }' | sort -u; }
  # header + reason lines of case $2, in output order
  show() {
    printf '%s\n' "$1" | awk -v id="$2" '
      /^  (PASS|FAIL)  \[[a-z]+\] / { grab = ($3 == id); if (grab) print; next }
      grab && /^        - / { print; next }
      { grab = 0 }'
  }
  say "--- R2 on the skill:"; show "$real" R2
  say "--- R2 on the mutant:"; show "$mut" R2
  new_fails=$(comm -13 <(fails "$real") <(fails "$mut") | tr '\n' ' ')
  say "--- cases failing only on the mutant: ${new_fails:-(none)}"
  nsh=$(heads "$real" R2 | wc -l | tr -d ' ')
  want_why="status: want 'AFKREV_PROCEED' | got 'AFKREV_SKIP sha=$SHA already reviewed by $ME'"
  bad=""
  [ "$nsh" -ge 1 ] && [ "$(heads "$real" R2 | grep -c '^  PASS')" = "$nsh" ] || bad="${bad}R2 does not pass on the skill; "
  [ "$(heads "$mut" R2 | grep -c '^  FAIL')" = "$nsh" ] || bad="${bad}R2 does not fail on the mutant in every shell; "
  [ "$(reasons "$mut" R2 | sort -u)" = "$want_why" ] && [ "$(reasons "$mut" R2 | wc -l | tr -d ' ')" = "$nsh" ] \
    || bad="${bad}R2's mutant failure is not solely the trusted foreign marker; "
  for c in $new_fails; do
    case " $MUT_AUTHOR_CASES " in *" $c "*) ;; *) bad="${bad}$c breaks on the mutant but does not depend on the author check; " ;; esac
  done
  if [ -z "$bad" ]; then
    say "MUTATION CHECK: caught — R2 passes on the skill and fails on the mutant only because the other login's marker is trusted"; exit 0
  fi
  say "MUTATION CHECK: NOT meaningful — ${bad%; }"; exit 1
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
# - Fixtures: GH_LOGIN GH_TRIAGE(true|false|absent) GH_CWD_REPO GH_LABELS GH_PR_HEAD
#   GH_PRS (file) GH_FX (dir holding comments-<N>.json / timeline-<N>.json) GH_KNOWN_REPO
# - PR labels are state under $GH_STATE: seeded from GH_PR_LABELS_<n>, else GH_PR_LABELS; a successful
#   pr edit applies its removes/adds. A concurrent writer landing with a PR's first edit adds
#   GH_EDIT_RACE_ADD and removes GH_EDIT_RACE_REMOVE.
# - GH_EDIT_FAIL_NTH=<k> fails the k-th pr edit of the run (1-based), whatever its PR.
# - Failure switches (any non-empty value): GH_USER_FAIL GH_REPO_API_FAIL GH_COMMENTS_FAIL
#   GH_TIMELINE_FAIL GH_REPO_VIEW_FAIL GH_LABEL_FAIL GH_PR_LIST_FAIL GH_PR_VIEW_FAIL
#   GH_HEAD_VIEW_FAIL (only `pr view --json headRefOid`) GH_EDIT_FAIL GH_COMMENT_FAIL
#   GH_LABELS_VIEW_FAIL_AFTER_EDIT (only `pr view --json labels`, once that PR has been edited)
#   GH_USER_FAIL=net is a transport failure (nothing on stdout); any other value is an HTTP 403.
# - Per-PR failure switches (space-separated PR numbers): GH_TIMELINE_FAIL_PR GH_EDIT_FAIL_PR GH_PR_VIEW_FAIL_PR
argv_json() { printf '%s\037' "$@" | jq -Rsc 'split("\u001f") | .[:-1]'; }
ARGV=$(argv_json "$@")
printf '%s\n' "$ARGV" >> "${GH_CALLS:-/dev/null}"
die() { printf 'gh-stub: %s\n' "$*" >&2; exit 1; }

KNOWN=${GH_KNOWN_REPO:-acme/widgets}
LABELS=${GH_LABELS-bug enhancement auto:needs-review auto:reviewing auto:needs-fixes auto:ready auto:needs-human}
sub=${1-}; [ $# -gt 0 ] && shift
pos=(); adds=(); rems=(); flags=" "; jqf=""; hasjq=0; json=""; repo=""; label=""; state=""
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
        --remove-label) rems+=("$2") ;;
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
cur_labels() { # cur_labels <n>
  local v
  if [ -f "${GH_STATE:-/nonexistent}/labels-$1" ]; then cat "$GH_STATE/labels-$1"
  elif v=$(printenv "GH_PR_LABELS_$1"); then printf '%s' "$v"
  else printf '%s' "${GH_PR_LABELS-auto:reviewing}"; fi
}
apply_edit() { # apply_edit <n> — after a successful pr edit
  local cur l
  [ -d "${GH_STATE-}" ] || die "GH_STATE is not a directory"
  local race_add="" race_rem=""
  [ -f "$GH_STATE/edited-$1" ] || { race_add=${GH_EDIT_RACE_ADD-}; race_rem=${GH_EDIT_RACE_REMOVE-}; }
  cur=" $(cur_labels "$1") "
  # the edit's own changes, then the concurrent writer's
  for l in ${rems[@]+"${rems[@]}"}; do cur=${cur// $l / }; done
  for l in ${adds[@]+"${adds[@]}"}; do case "$cur" in *" $l "*) ;; *) cur="$cur$l " ;; esac; done
  for l in $race_rem; do cur=${cur// $l / }; done
  for l in $race_add; do case "$cur" in *" $l "*) ;; *) cur="$cur$l " ;; esac; done
  printf '%s' "$cur" > "$GH_STATE/labels-$1"; : > "$GH_STATE/edited-$1"
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
            [ "$kind" = timeline ] && case " ${GH_TIMELINE_FAIL_PR-} " in *" $n "*) api_fail 502 "Server Error" ;; esac
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
        case " ${GH_PR_VIEW_FAIL_PR-} " in *" $n "*) echo "HTTP 502: Server Error (https://api.github.com/graphql)" >&2; exit 1 ;; esac
        [ -n "${GH_HEAD_VIEW_FAIL-}" ] && [ "$json" = headRefOid ] && { echo "HTTP 502: Server Error (https://api.github.com/graphql)" >&2; exit 1; }
        [ -n "${GH_LABELS_VIEW_FAIL_AFTER_EDIT-}" ] && [ "$json" = labels ] && [ -f "${GH_STATE-}/edited-$n" ] \
          && { echo "HTTP 502: Server Error (https://api.github.com/graphql)" >&2; exit 1; }
        emit "$(labels_json "$(cur_labels "$n")" \
          | jq -c --argjson n "$n" --arg h "${GH_PR_HEAD-}" '{number: $n, labels: ., headRefOid: $h}' | project)" ;;
      edit)
        allow --repo --add-label --remove-label; need_repo; need_num
        case "$flags" in *-label*) ;; *) die "pr edit without a label flag" ;; esac
        for l in ${adds[@]+"${adds[@]}"}; do
          case " $LABELS " in *" $l "*) ;; *) printf 'FAIL %s\n' "$ARGV" >> "$GH_WRITES"; echo "'$l' not found" >&2; exit 1 ;; esac
        done
        efail=${GH_EDIT_FAIL-}; case " ${GH_EDIT_FAIL_PR-} " in *" $n "*) efail=1 ;; esac
        k=$(( $(cat "${GH_STATE:?}/edit-count" 2>/dev/null || echo 0) + 1 )); echo "$k" > "$GH_STATE/edit-count"
        [ "${GH_EDIT_FAIL_NTH-}" = "$k" ] && efail=1
        write_call "$efail" || { echo "failed to update https://github.com/$KNOWN/pull/$n: HTTP 502" >&2; exit 1; }
        apply_edit "$n"
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

# --- fixtures (R N ME BOT SHA OLD_SHA are defined at the top) ---
MK="<!-- afk-review reviewed sha="
REASON_TXT='review crashed: no verdict line'
INJ='x" or true or "'
INJ_NL=$'loopbot\n" or true or "'
REASON_APOS="review didn't produce a verdict"
REASON_INJ="x'; touch $ROOT/pwned; echo '"'$(id)'
REASON_SED='a & b \1 \\ c | d / e `touch '"$ROOT"'/pwned` "q" %s'
# Shell-safe inside LOGIN='…', but jq string interpolation: unvalidated, it makes every author match.
LOGIN_JQ='\(.user.login)'
LOGIN_NL="$ME${NL}$LOGIN_JQ"

cfx() { # cfx <name> <login> <body> [<login> <body>]... → GH_FX dir; appends one page to comments-7.json
  local d="$ROOT/fx/$1"; shift; mkdir -p "$d"
  printf '%s\037' "$@" | jq -Rsc --argjson base "$(( $(cat "$d/comments-$N.json" 2>/dev/null | wc -l) * 100 + 1000 ))" \
    'split("\u001f")[:-1] as $a | [range(0; $a | length; 2) as $i | {id: ($base + $i), user: {login: $a[$i], type: "User"}, body: $a[$i + 1],
       created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z"}]' \
    >> "$d/comments-$N.json"
  printf '%s' "$d"
}
# tfx <name> <pr> <created_at of an auto:reviewing event | ""> [labeled|unlabeled] — appends one timeline page
# - A labeled auto:reviewing comes with the claim's unlabeled auto:needs-review at the same instant.
tfx() {
  local d="$ROOT/fx/$1"; mkdir -p "$d"
  jq -cn --arg t "$3" --arg e "${4:-labeled}" '[{event: "labeled", label: {name: "auto:needs-review"}, created_at: "2020-01-01T00:00:00Z"},
                       {event: "commented", created_at: "2020-01-01T00:05:00Z"}]
                       + (if $t == "" then []
                          elif $e == "labeled" then [{event: "labeled", label: {name: "auto:reviewing"}, created_at: $t},
                                                     {event: "unlabeled", label: {name: "auto:needs-review"}, created_at: $t}]
                          else [{event: "unlabeled", label: {name: "auto:reviewing"}, created_at: $t}] end)' \
    >> "$d/timeline-$2.json"
  printf '%s' "$d"
}
pr_obj() { jq -cn --argjson n "$1" --arg s "$2" --arg st "$3" --arg l "$4" '{number: $n, headRefOid: $s, state: $st, title: "t", labels: [{name: $l}]}'; }

OLD=$(date -u -v-200M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '200 minutes ago' +%Y-%m-%dT%H:%M:%SZ)
OLD2=$(date -u -v-100M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '100 minutes ago' +%Y-%m-%dT%H:%M:%SZ)
NEW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

FX_R1=$(cfx r1 alice "LGTM, nice work" "$ME" "$MK$SHA -->")
FX_R1B=$(cfx r1b "$ME" "$MK$SHA verdict=ready -->")
FX_R1C=$(cfx r1c "$ME" "$MK$SHA verdict=needs-fixes -->")
FX_R2=$(cfx r2 alice "LGTM" mallory "$MK$SHA verdict=ready -->")
FX_R2B=$(cfx r2b mallory "$MK$SHA -->")
FX_R3=$(cfx r3 "$ME" "## Review${NL}No blockers.${NL}${NL}$MK$SHA verdict=ready -->${NL}")
FX_R4=$(cfx r4 "$ME" "$MK$OLD_SHA verdict=ready -->")
FX_R11=$(cfx r11 "$BOT" "$MK$SHA verdict=ready -->")
FX_R12=$(cfx r12 "$ME" "$MK$SHA verdict=maybe -->")
cfx_edit() { # cfx_edit <dir> — every comment in the fixture was edited after posting
  local f="$1/comments-$N.json"; jq -c 'map(.updated_at = "2026-01-02T00:00:00Z")' "$f" > "$f.tmp" && mv "$f.tmp" "$f"; printf '%s' "$1"
}
cfx r13 alice "first page" bob "still first page" >/dev/null
FX_R13=$(cfx r13 "$ME" "$MK$SHA verdict=needs-fixes -->")
FX_R15B=$(cfx r15b LoopBot "$MK$SHA verdict=ready -->")
nullfx() { # nullfx <name> [<login> <body>]... — page 1 is a marker comment with "user": null, then cfx's comments
  local d="$ROOT/fx/$1"; shift; mkdir -p "$d"
  jq -cn --arg b "$MK$SHA verdict=ready -->" '[{id: 999, user: null, body: $b, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z"}]' > "$d/comments-$N.json"
  [ $# -gt 0 ] && cfx "${d##*/}" "$@" >/dev/null; printf '%s' "$d"
}
FX_R17=$(nullfx r17 "$ME" "$MK$SHA verdict=ready -->")
FX_R17B=$(nullfx r17b mallory "LGTM")
FX_R16=$(cfx_edit "$(cfx r16 "$ME" "$MK$SHA verdict=ready -->")")

FX_STALE=$(tfx stale 7 "$OLD")
FX_FRESH=$(tfx fresh 7 "$NEW")
FX_NOEVT=$(tfx noevt 7 "")
tfx twostale 7 "$OLD" >/dev/null; FX_TWO=$(tfx twostale 8 "$OLD")
tfx reapplied 7 "$OLD" >/dev/null; FX_REAPPLIED=$(tfx reapplied 7 "$NEW")
tfx unl 7 "$OLD" >/dev/null; FX_UNL=$(tfx unl 7 "$OLD2" unlabeled)
for i in 7 8 9 10; do tfx mix "$i" "$OLD" >/dev/null; done; FX_MIX=$(tfx mix 9 "$OLD2" unlabeled)

PRS_SWEEP1="$ROOT/fx/prs-sweep1.json"; PRS_SWEEP2="$ROOT/fx/prs-sweep2.json"; PRS_SELECT="$ROOT/fx/prs-select.json"
{ pr_obj 7 "$SHA" OPEN auto:reviewing; pr_obj 9 "$SHA" OPEN auto:needs-fixes; } | jq -sc . > "$PRS_SWEEP1"
{ pr_obj 7 "$SHA" OPEN auto:reviewing; pr_obj 8 "$OLD_SHA" OPEN auto:reviewing; } | jq -sc . > "$PRS_SWEEP2"
PRS_SWEEP4="$ROOT/fx/prs-sweep4.json"
for i in 7 8 9 10; do pr_obj "$i" "$SHA" OPEN auto:reviewing; done | jq -sc . > "$PRS_SWEEP4"
{ pr_obj 7 "$SHA" OPEN auto:needs-review; pr_obj 8 "$OLD_SHA" OPEN auto:needs-review
  pr_obj 9 "$SHA" OPEN auto:needs-fixes; pr_obj 10 "$SHA" CLOSED auto:needs-review; } | jq -sc . > "$PRS_SELECT"

# --- block runner ---
# Literal (non-regex) placeholder substitution: a value may hold any of & \ | / ' " $ ` and is
# inserted byte-for-byte, as the loop would write it.
subst() {
  P_REPO=$1 P_N=$2 P_SHA=$3 P_VERDICT=$4 P_REASON=$5 P_LOGIN=$6 awk '
    function rep(s, ph, v,   out, i) {
      out = ""
      while ((i = index(s, ph)) > 0) { out = out substr(s, 1, i - 1) v; s = substr(s, i + length(ph)) }
      return out s
    }
    { l = rep($0, "<owner/repo>", ENVIRON["P_REPO"]); l = rep(l, "<N>", ENVIRON["P_N"])
      l = rep(l, "<SHA>", ENVIRON["P_SHA"]); l = rep(l, "<VERDICT>", ENVIRON["P_VERDICT"])
      l = rep(l, "<LOGIN>", ENVIRON["P_LOGIN"]); print rep(l, "<REASON>", ENVIRON["P_REASON"]) }'
}
# runblk <block#> [@REPO=|@N=|@SHA=|@VERDICT=|@REASON=|@LOGIN= placeholder values] [VAR=value env for the block]...
# - @LOGIN defaults to the stub's /user login, i.e. what block 1 prints for an unconfigured run.
# Sets OUT (stdout+stderr), RC, STATUS (AFKREV_* lines), WRITES, CALLS.
runblk() {
  BLK=$1; shift
  local p_repo=$R p_n=$N p_sha=$SHA p_verdict=ready p_reason=$REASON_TXT p_login=$ME a script envs=()
  for a in "$@"; do
    case "$a" in
      @REPO=*) p_repo=${a#@REPO=} ;;
      @N=*) p_n=${a#@N=} ;;
      @SHA=*) p_sha=${a#@SHA=} ;;
      @VERDICT=*) p_verdict=${a#@VERDICT=} ;;
      @REASON=*) p_reason=${a#@REASON=} ;;
      @LOGIN=*) p_login=${a#@LOGIN=} ;;
      *) envs+=("$a") ;;
    esac
  done
  script=$(block "$BLK" | subst "$p_repo" "$p_n" "$p_sha" "$p_verdict" "$p_reason" "$p_login")
  : > "$GH_WRITES"; : > "$GH_CALLS"; rm -rf "$ROOT/state"; mkdir -p "$ROOT/state"
  # - env -i: a maintainer's own AFK_LOOP_LOGIN / GH_TOKEN must not leak into a case.
  # - GH_PR_HEAD defaults to the PR's head being unchanged since Step 2; a case's envs override it.
  # - Label state starts fresh each block, as each block is its own run against the PR.
  OUT=$(cd "$ROOT/work" && env -i PATH="$ROOT/bin:$PATH" HOME="$ROOT/home" TMPDIR="$ROOT/tmp" \
    GH_CONFIG_DIR="$ROOT/ghconfig" GH_WRITES="$GH_WRITES" GH_CALLS="$GH_CALLS" GH_STATE="$ROOT/state" GH_PR_HEAD="$SHA" \
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
# want_calls <tag>... — the exact gh call sequence. Tags: "pr view <--json fields>", "api <endpoint>",
# else "<command> <subcommand>" (e.g. "pr edit").
want_calls() {
  local want got
  want=$(printf '%s\n' "$@")
  got=$(printf '%s\n' "$CALLS" | jq -r 'if .[0] == "pr" and .[1] == "view" then "pr view " + .[index("--json") + 1]
    elif .[0] == "api" then "api " + .[1] else .[0] + " " + .[1] end' 2>&1)
  [ "$got" = "$want" ] || why "gh calls differ$NL          want:$NL$(ind "$want")$NL          got:$NL$(ind "${got:-(none)}")"
}
# want_labels <n> <set> — PR #n's auto:* labels after the block (sorted, space-joined), from the stub's state
want_labels() {
  local got
  got=$(tr ' ' '\n' < "$ROOT/state/labels-$1" 2>/dev/null | grep '^auto:' | sort | tr '\n' ' '); got=${got% }
  [ "$got" = "$2" ] || why "auto labels on #$1 after the block: want '$2' | got '$got'"
}
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
  for p in '<owner/repo>' '<N>' '<SHA>' '<VERDICT>' '<REASON>' '<LOGIN>'; do
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
  begin P4c "permissions absent -> OK, triage unverified"
  runblk 1 GH_TRIAGE=absent; want_status "AFKREV_OK running as $ME (triage unverified: no permissions in the repo response)"
  want_no_writes; done_case
  begin P4d "/user 403 + AFK_LOOP_LOGIN + permissions absent -> OK, both notes"
  runblk 1 GH_USER_FAIL=1 "AFK_LOOP_LOGIN=$BOT" GH_TRIAGE=absent
  want_status "AFKREV_OK running as $BOT (unverified: /user unavailable) (triage unverified: no permissions in the repo response)"
  want_no_writes; done_case
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
  begin P11 "override differs from /user only in case -> OK, not ABORT"
  runblk 1 "AFK_LOOP_LOGIN=LoopBot"; want_status "AFKREV_OK running as LoopBot"; want_no_writes; done_case
  begin P10 "override equals /user -> OK, verified"
  runblk 1 "AFK_LOOP_LOGIN=$ME"; want_status "AFKREV_OK running as $ME"; want_out_lacks unverified; want_no_writes; done_case

  hdr "stale-claim sweep (block 2)"
  begin SW1 "stale claim, re-read only auto:reviewing -> back to needs-review; repo reaches gh"
  runblk 2 "GH_PRS=$PRS_SWEEP1" "GH_FX=$FX_STALE"; want_status "AFKREV_OK sweep done reclaimed=1"; want_out_lacks "https://github.com/"
  want_calls "pr list" "api repos/$R/issues/7/timeline" "pr view labels" "pr edit"; want_labels 7 auto:needs-review
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-review; want_writes
  want_call "[\"pr\",\"list\",\"--repo\",\"$R\",\"--state\",\"open\",\"--label\",\"auto:reviewing\","
  want_call "[\"api\",\"repos/$R/issues/7/timeline\",\"--paginate\",\"--jq\","; done_case
  begin SW2 "fresh claim left alone"
  runblk 2 "GH_PRS=$PRS_SWEEP1" "GH_FX=$FX_FRESH"; want_status "AFKREV_OK sweep done reclaimed=0"; want_no_writes; done_case
  begin SW3 "list gh error -> ERROR, sweep skipped"
  runblk 2 "GH_PRS=$PRS_SWEEP1" "GH_FX=$FX_STALE" GH_PR_LIST_FAIL=1
  want_status "AFKREV_ERROR sweep skipped (gh error listing auto:reviewing)"; want_calls "pr list"; want_no_writes; done_case
  begin SW4 "timeline fetch fails -> ERROR naming #7:timeline, claim left"
  runblk 2 "GH_PRS=$PRS_SWEEP1" "GH_FX=$FX_STALE" GH_TIMELINE_FAIL=1
  want_status "AFKREV_ERROR sweep incomplete reclaimed=0 failed=1 (#7:timeline)"; want_no_writes; done_case
  begin SW5 "two stale claims -> both reclaimed"
  runblk 2 "GH_PRS=$PRS_SWEEP2" "GH_FX=$FX_TWO"; want_status "AFKREV_OK sweep done reclaimed=2"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-review
  exp ok pr edit 8 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-review; want_writes; done_case
  begin SW6 "re-applied on a later page -> latest wins, left"
  runblk 2 "GH_PRS=$PRS_SWEEP1" "GH_FX=$FX_REAPPLIED"; want_status "AFKREV_OK sweep done reclaimed=0"; want_no_writes; done_case
  begin SW7 "no labeled event -> left"
  runblk 2 "GH_PRS=$PRS_SWEEP1" "GH_FX=$FX_NOEVT"; want_status "AFKREV_OK sweep done reclaimed=0"; want_no_writes; done_case
  begin SW8 "reclaim edit fails -> ERROR naming #7:edit"
  runblk 2 "GH_PRS=$PRS_SWEEP1" "GH_FX=$FX_STALE" GH_EDIT_FAIL=1; want_status "AFKREV_ERROR sweep incomplete reclaimed=0 failed=1 (#7:edit)"
  exp FAIL pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-review; want_writes; done_case
  begin SW9 "#7 timeline fails -> #8 still reclaimed, ERROR"
  runblk 2 "GH_PRS=$PRS_SWEEP2" "GH_FX=$FX_TWO" GH_TIMELINE_FAIL_PR=7
  want_status "AFKREV_ERROR sweep incomplete reclaimed=1 failed=1 (#7:timeline)"
  want_calls "pr list" "api repos/$R/issues/7/timeline" "api repos/$R/issues/8/timeline" "pr view labels" "pr edit"
  exp ok pr edit 8 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-review; want_writes; done_case
  begin SW10 "#7 reclaim edit fails -> #8 still reclaimed, ERROR"
  runblk 2 "GH_PRS=$PRS_SWEEP2" "GH_FX=$FX_TWO" GH_EDIT_FAIL_PR=7
  want_status "AFKREV_ERROR sweep incomplete reclaimed=1 failed=1 (#7:edit)"
  exp FAIL pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-review
  exp ok pr edit 8 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-review; want_writes; done_case
  begin SW11 "latest auto:reviewing event is unlabeled -> left, no re-read"
  runblk 2 "GH_PRS=$PRS_SWEEP1" "GH_FX=$FX_UNL"; want_status "AFKREV_OK sweep done reclaimed=0"
  want_calls "pr list" "api repos/$R/issues/7/timeline"; want_no_writes; done_case
  begin SW12 "re-read shows auto:ready -> no edit, not counted"
  runblk 2 "GH_PRS=$PRS_SWEEP1" "GH_FX=$FX_STALE" GH_PR_LABELS=auto:ready; want_status "AFKREV_OK sweep done reclaimed=0"
  want_calls "pr list" "api repos/$R/issues/7/timeline" "pr view labels"; want_no_writes; done_case
  begin SW12b "re-read shows auto:reviewing + auto:needs-human -> claim removed only, reclaimed"
  runblk 2 "GH_PRS=$PRS_SWEEP1" "GH_FX=$FX_STALE" "GH_PR_LABELS=auto:reviewing auto:needs-human"
  want_status "AFKREV_OK sweep done reclaimed=1"; want_labels 7 auto:needs-human
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing; want_writes; done_case
  begin SW12c "half-applied claim (auto:reviewing + auto:needs-review) -> claim removed only"
  runblk 2 "GH_PRS=$PRS_SWEEP1" "GH_FX=$FX_STALE" "GH_PR_LABELS=auto:needs-review auto:reviewing"
  want_status "AFKREV_OK sweep done reclaimed=1"; want_labels 7 auto:needs-review
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing; want_writes; done_case
  begin SW12d "remove-only edit fails -> ERROR, failed=1"
  runblk 2 "GH_PRS=$PRS_SWEEP1" "GH_FX=$FX_STALE" "GH_PR_LABELS=auto:reviewing auto:needs-human" GH_EDIT_FAIL=1
  want_status "AFKREV_ERROR sweep incomplete reclaimed=0 failed=1 (#7:edit)"
  exp FAIL pr edit 7 --repo "$R" --remove-label auto:reviewing; want_writes; done_case
  begin SW13 "re-read fails -> ERROR naming #7:labels, no edit"
  runblk 2 "GH_PRS=$PRS_SWEEP1" "GH_FX=$FX_STALE" GH_PR_VIEW_FAIL=1
  want_status "AFKREV_ERROR sweep incomplete reclaimed=0 failed=1 (#7:labels)"; want_no_writes; done_case
  begin SW14 "mix: #7 re-read fails, #8 moved on, #9 unlabeled, #10 reclaimed"
  runblk 2 "GH_PRS=$PRS_SWEEP4" "GH_FX=$FX_MIX" GH_PR_VIEW_FAIL_PR=7 GH_PR_LABELS_8=auto:ready
  want_status "AFKREV_ERROR sweep incomplete reclaimed=1 failed=1 (#7:labels)"
  want_calls "pr list" "api repos/$R/issues/7/timeline" "pr view labels" "api repos/$R/issues/8/timeline" "pr view labels" \
    "api repos/$R/issues/9/timeline" "api repos/$R/issues/10/timeline" "pr view labels" "pr edit"
  exp ok pr edit 10 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-review; want_writes; done_case
  begin SW15 "two failures -> tags in processing order (#7:timeline #8:edit)"
  runblk 2 "GH_PRS=$PRS_SWEEP2" "GH_FX=$FX_TWO" GH_TIMELINE_FAIL_PR=7 GH_EDIT_FAIL_PR=8
  want_status "AFKREV_ERROR sweep incomplete reclaimed=0 failed=2 (#7:timeline #8:edit)"
  exp FAIL pr edit 8 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-review; want_writes; done_case
  begin SW16 "stray auto:merge beside a lone stale claim -> full reclaim, not a yield"
  runblk 2 "GH_PRS=$PRS_SWEEP1" "GH_FX=$FX_STALE" "GH_PR_LABELS=auto:merge auto:reviewing"
  want_status "AFKREV_OK sweep done reclaimed=1"; want_labels 7 "auto:merge auto:needs-review"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-review; want_writes; done_case

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
  want_call "[\"api\",\"repos/$R/issues/7/comments\",\"--paginate\",\"--jq\","
  want_calls "api repos/$R/issues/7/comments"; want_no_writes; done_case
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
  begin R6 "/user would fail -> never asked, SKIP on <LOGIN>"
  runblk 4 "GH_FX=$FX_R1" GH_USER_FAIL=1; want_status "AFKREV_SKIP sha=$SHA already reviewed by $ME"
  want_calls "api repos/$R/issues/7/comments"; want_no_writes; done_case
  begin R7 "AFK_LOOP_LOGIN=<marker author> in env -> ignored, PROCEED"
  runblk 4 "GH_FX=$FX_R2" AFK_LOOP_LOGIN=mallory; want_status "AFKREV_PROCEED"; want_no_writes; done_case
  begin R7b "AFK_LOOP_LOGIN=<other login> in env -> ignored, SKIP"
  runblk 4 "GH_FX=$FX_R1" AFK_LOOP_LOGIN=other-bot; want_status "AFKREV_SKIP sha=$SHA already reviewed by $ME"; want_no_writes; done_case
  begin R8 "reader login differs from writer -> PROCEED"
  runblk 4 "GH_FX=$FX_R1B" @LOGIN=other-bot; want_status "AFKREV_PROCEED"; want_no_writes; done_case
  begin R9 "comments fetch fails -> ERROR, never SKIP"
  runblk 4 "GH_FX=$FX_R1" GH_COMMENTS_FAIL=1; want_status "AFKREV_ERROR comments fetch failed"; want_no_writes; done_case
  begin R10 "login with jq interpolation -> ERROR, no gh call"
  runblk 4 "GH_FX=$FX_R2" "@LOGIN=$LOGIN_JQ"
  want_status "AFKREV_ERROR no valid login ('$LOGIN_JQ') — substitute the login the preconditions printed"; want_no_calls; done_case
  begin R10b "multi-line login -> ERROR, no gh call"
  runblk 4 "GH_FX=$FX_R2" "@LOGIN=$LOGIN_NL"; want_status_prefix "AFKREV_ERROR no valid login ('$ME"; want_no_calls; done_case
  begin R10c "login with a double quote -> ERROR, no gh call, no shell breakage"
  runblk 4 "GH_FX=$FX_R2" "@LOGIN=$INJ"
  want_status "AFKREV_ERROR no valid login ('$INJ') — substitute the login the preconditions printed"; want_no_calls; done_case
  begin R14 "unsubstituted <LOGIN> -> ERROR, no gh call"
  runblk 4 "GH_FX=$FX_R1" '@LOGIN=<LOGIN>'
  want_status "AFKREV_ERROR no valid login ('<LOGIN>') — substitute the login the preconditions printed"; want_no_calls; done_case
  begin R14b "empty login -> ERROR, no gh call"
  runblk 4 "GH_FX=$FX_R1" @LOGIN=; want_status_prefix "AFKREV_ERROR no valid login ('')"; want_no_calls; done_case
  begin R11 "name[bot] login on both sides -> SKIP"
  runblk 4 "GH_FX=$FX_R11" "@LOGIN=$BOT"; want_status "AFKREV_SKIP sha=$SHA already reviewed by $BOT"; want_no_writes; done_case
  begin R12 "unknown verdict value -> PROCEED"
  runblk 4 "GH_FX=$FX_R12"; want_status "AFKREV_PROCEED"; want_no_writes; done_case
  begin R15 "mixed-case <LOGIN> vs author loopbot -> SKIP"
  runblk 4 "GH_FX=$FX_R1B" @LOGIN=LoopBot; want_status "AFKREV_SKIP sha=$SHA already reviewed by LoopBot"; want_no_writes; done_case
  begin R15b "author LoopBot vs <LOGIN> loopbot -> SKIP"
  runblk 4 "GH_FX=$FX_R15B"; want_status "AFKREV_SKIP sha=$SHA already reviewed by $ME"; want_no_writes; done_case
  begin R16 "own marker edited after posting -> PROCEED"
  runblk 4 "GH_FX=$FX_R16"; want_status "AFKREV_PROCEED"; want_no_writes; done_case
  begin R17 "a null-user marker, then our own marker -> no error, SKIP"
  runblk 4 "GH_FX=$FX_R17"; want_status "AFKREV_SKIP sha=$SHA already reviewed by $ME"; want_no_writes; done_case
  begin R17b "a null-user marker and no own marker -> no error, PROCEED"
  runblk 4 "GH_FX=$FX_R17B"; want_status "AFKREV_PROCEED"; want_no_writes; done_case
  begin R13 "own marker on page 2 -> SKIP"
  runblk 4 "GH_FX=$FX_R13"; want_status "AFKREV_SKIP sha=$SHA already reviewed by $ME"; want_no_writes; done_case

  hdr "claim (block 5) + not-eligible release (block 6)"
  begin C1 "claim succeeds -> exact edit"
  runblk 5 "GH_PR_LABELS=bug auto:needs-review"; want_status "AFKREV_OK claimed"
  want_call "[\"pr\",\"view\",\"7\",\"--repo\",\"$R\",\"--json\",\"labels\",\"--jq\","
  exp ok pr edit 7 --repo "$R" --add-label auto:reviewing --remove-label auto:needs-review; want_writes; done_case
  begin C1b "stray auto:merge beside auto:needs-review -> claimed"
  runblk 5 "GH_PR_LABELS=auto:merge auto:needs-review"; want_status "AFKREV_OK claimed"
  exp ok pr edit 7 --repo "$R" --add-label auto:reviewing --remove-label auto:needs-review; want_writes; done_case
  begin C2 "claim edit fails -> ERROR"
  runblk 5 "GH_PR_LABELS=auto:needs-review" GH_EDIT_FAIL=1; want_status "AFKREV_ERROR claim"
  exp FAIL pr edit 7 --repo "$R" --add-label auto:reviewing --remove-label auto:needs-review; want_writes; done_case
  begin C3 "escalated by another run -> SKIP, no writes"
  runblk 5 "GH_PR_LABELS=auto:needs-human"; want_status "AFKREV_SKIP not claimable (auto labels: 'auto:needs-human')"; want_no_writes; done_case
  begin C3b "needs-review beside another auto label -> SKIP, no writes"
  runblk 5 "GH_PR_LABELS=auto:needs-review auto:needs-human"
  want_status "AFKREV_SKIP not claimable (auto labels: 'auto:needs-human auto:needs-review')"; want_no_writes; done_case
  begin C3c "already claimed by a sibling -> SKIP, no writes"
  runblk 5 "GH_PR_LABELS=auto:reviewing"; want_status_prefix "AFKREV_SKIP not claimable"; want_no_writes; done_case
  begin C3d "no auto:* labels -> SKIP, no writes"
  runblk 5 GH_PR_LABELS=bug; want_status "AFKREV_SKIP not claimable (auto labels: '')"; want_no_writes; done_case
  begin C4 "label read fails -> ERROR, no writes"
  runblk 5 GH_PR_VIEW_FAIL=1; want_status "AFKREV_ERROR claim label read failed"; want_no_writes; done_case
  begin L1 "release succeeds -> edit, no marker"
  runblk 6; want_status "AFKREV_OK released (not eligible)"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-review; want_writes; done_case
  begin L2 "release edit fails -> ERROR"
  runblk 6 GH_EDIT_FAIL=1; want_status "AFKREV_ERROR release"
  exp FAIL pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-review; want_writes; done_case
  begin L3 "claim lost -> ERROR, no writes"
  runblk 6 "GH_PR_LABELS=auto:needs-human"; want_status "AFKREV_ERROR lost claim (auto labels: 'auto:needs-human') — not releasing"
  want_no_writes; done_case
  begin L3b "auto:reviewing beside auto:needs-human -> ERROR, no writes"
  runblk 6 "GH_PR_LABELS=auto:reviewing auto:needs-human"
  want_status "AFKREV_ERROR lost claim (auto labels: 'auto:needs-human auto:reviewing') — not releasing"; want_no_writes; done_case
  begin L4 "claim check fails -> ERROR, no writes"
  runblk 6 GH_PR_VIEW_FAIL=1; want_status "AFKREV_ERROR claim check failed"; want_no_writes; done_case

  hdr "transition + mark (block 7)"
  begin W1 "ready -> edit, then exact marker comment"
  runblk 7 @VERDICT=ready; want_status "AFKREV_OK auto:ready marked=$SHA"
  want_call "$(argv_json pr view 7 --repo "$R" --json headRefOid --jq .headRefOid)"
  want_calls "pr view labels" "pr edit" "pr view labels" "pr view headRefOid" "pr comment"; want_labels 7 auto:ready
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:ready
  exp ok pr comment 7 --repo "$R" --body "<!-- afk-review reviewed sha=$SHA verdict=ready -->"; want_writes; done_case
  BODY_READY=$(printf '%s\n' "$WRITES" | sed -n 's/^ok //p' | jq -r 'select(.[1] == "comment") | .[index("--body") + 1]')
  begin W1b "needs-fixes, beside a non-auto label -> edit, then exact marker comment"
  runblk 7 @VERDICT=needs-fixes "GH_PR_LABELS=bug auto:reviewing"; want_status "AFKREV_OK auto:needs-fixes marked=$SHA"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-fixes
  exp ok pr comment 7 --repo "$R" --body "<!-- afk-review reviewed sha=$SHA verdict=needs-fixes -->"; want_writes; done_case
  BODY_NF=$(printf '%s\n' "$WRITES" | sed -n 's/^ok //p' | jq -r 'select(.[1] == "comment") | .[index("--body") + 1]')
  begin W1c "stray auto:merge on the PR -> transition and marker as usual"
  runblk 7 "GH_PR_LABELS=auto:merge auto:reviewing"; want_status "AFKREV_OK auto:ready marked=$SHA"; want_labels 7 "auto:merge auto:ready"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:ready
  exp ok pr comment 7 --repo "$R" --body "<!-- afk-review reviewed sha=$SHA verdict=ready -->"; want_writes; done_case
  begin W2 "edit fails -> ERROR, no comment"
  runblk 7 GH_EDIT_FAIL=1; want_status "AFKREV_ERROR transition"; want_calls "pr view labels" "pr edit"
  exp FAIL pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:ready; want_writes; done_case
  begin W3 "empty SHA -> labels re-read, no head read, marked=none (invalid sha)"
  runblk 7 @SHA=; want_status "AFKREV_OK auto:ready marked=none (invalid sha)"; want_calls "pr view labels" "pr edit" "pr view labels"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:ready; want_writes; done_case
  begin W3b "non-hex SHA -> labels re-read, no head read, marked=none (invalid sha)"
  runblk 7 "@SHA=${SHA%?}g"; want_status "AFKREV_OK auto:ready marked=none (invalid sha)"; want_calls "pr view labels" "pr edit" "pr view labels"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:ready; want_writes; done_case
  begin W3c "short SHA -> labels re-read, no head read, marked=none (invalid sha)"
  runblk 7 "@SHA=${SHA:0:7}" "GH_PR_HEAD=${SHA:0:7}"; want_status "AFKREV_OK auto:ready marked=none (invalid sha)"
  want_calls "pr view labels" "pr edit" "pr view labels"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:ready; want_writes; done_case
  begin W4 "comment fails -> still OK, marked=none (comment failed)"
  runblk 7 GH_COMMENT_FAIL=1; want_status "AFKREV_OK auto:ready marked=none (comment failed)"
  want_calls "pr view labels" "pr edit" "pr view labels" "pr view headRefOid" "pr comment"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:ready
  exp FAIL pr comment 7 --repo "$R" --body "<!-- afk-review reviewed sha=$SHA verdict=ready -->"; want_writes; done_case
  begin W6 "head moved during review -> edit only, marked=none (head moved)"
  runblk 7 "GH_PR_HEAD=$OLD_SHA"; want_status "AFKREV_OK auto:ready marked=none (head moved)"
  want_calls "pr view labels" "pr edit" "pr view labels" "pr view headRefOid"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:ready; want_writes; done_case
  begin W9 "head read fails -> edit only, marked=none (head read failed)"
  runblk 7 GH_HEAD_VIEW_FAIL=1; want_status "AFKREV_OK auto:ready marked=none (head read failed)"
  want_calls "pr view labels" "pr edit" "pr view labels" "pr view headRefOid"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:ready; want_writes; done_case
  LC="AFKREV_ERROR labels changed under the transition"
  begin W10 "auto:needs-review lands with the edit -> yield auto:ready, ERROR, no head read, no marker"
  runblk 7 GH_EDIT_RACE_ADD=auto:needs-review
  want_status "$LC (auto labels: 'auto:needs-review auto:ready') — removed auto:ready, no marker"
  want_calls "pr view labels" "pr edit" "pr view labels" "pr edit"; want_labels 7 auto:needs-review
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:ready
  exp ok pr edit 7 --repo "$R" --remove-label auto:ready; want_writes; done_case
  begin W10b "needs-fixes; auto:needs-human lands with the edit -> yield auto:needs-fixes"
  runblk 7 @VERDICT=needs-fixes GH_EDIT_RACE_ADD=auto:needs-human
  want_status "$LC (auto labels: 'auto:needs-fixes auto:needs-human') — removed auto:needs-fixes, no marker"
  want_labels 7 auto:needs-human
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-fixes
  exp ok pr edit 7 --repo "$R" --remove-label auto:needs-fixes; want_writes; done_case
  begin W10c "head moved AND labels changed -> the labels-changed yield, not 'head moved'"
  runblk 7 "GH_PR_HEAD=$OLD_SHA" GH_EDIT_RACE_ADD=auto:needs-review
  want_status "$LC (auto labels: 'auto:needs-review auto:ready') — removed auto:ready, no marker"
  want_calls "pr view labels" "pr edit" "pr view labels" "pr edit"; want_labels 7 auto:needs-review
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:ready
  exp ok pr edit 7 --repo "$R" --remove-label auto:ready; want_writes; done_case
  begin W10d "every auto label gone after the edit -> ERROR, no yield edit"
  runblk 7 GH_EDIT_RACE_REMOVE=auto:ready; want_status "$LC (auto labels: '') — no marker"
  want_calls "pr view labels" "pr edit" "pr view labels"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:ready; want_writes; done_case
  begin W10f "own label already replaced (human swap to needs-human) -> ERROR, no yield edit, no false 'removed'"
  runblk 7 GH_EDIT_RACE_REMOVE=auto:ready GH_EDIT_RACE_ADD=auto:needs-human
  want_status "$LC (auto labels: 'auto:needs-human') — no marker"; want_labels 7 "auto:needs-human"
  want_calls "pr view labels" "pr edit" "pr view labels"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:ready; want_writes; done_case
  begin W10e "yield edit fails -> ERROR without 'removed', both labels left"
  runblk 7 GH_EDIT_RACE_ADD=auto:needs-review GH_EDIT_FAIL_NTH=2
  want_status "$LC (auto labels: 'auto:needs-review auto:ready') — no marker"; want_labels 7 "auto:needs-review auto:ready"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:ready
  exp FAIL pr edit 7 --repo "$R" --remove-label auto:ready; want_writes; done_case
  CV="AFKREV_ERROR conflicting verdicts from overlapping runs (auto labels: 'auto:needs-fixes auto:ready')"
  begin W15 "ready; auto:needs-fixes lands with the edit -> move to auto:needs-human, ERROR, no marker"
  runblk 7 GH_EDIT_RACE_ADD=auto:needs-fixes; want_status "$CV — moved to auto:needs-human, no marker"
  want_calls "pr view labels" "pr edit" "pr view labels" "pr edit"; want_labels 7 auto:needs-human
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:ready
  exp ok pr edit 7 --repo "$R" --add-label auto:needs-human --remove-label auto:ready --remove-label auto:needs-fixes; want_writes; done_case
  begin W15b "needs-fixes; auto:ready lands with the edit -> move to auto:needs-human, ERROR"
  runblk 7 @VERDICT=needs-fixes GH_EDIT_RACE_ADD=auto:ready; want_status "$CV — moved to auto:needs-human, no marker"
  want_labels 7 auto:needs-human
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:needs-fixes
  exp ok pr edit 7 --repo "$R" --add-label auto:needs-human --remove-label auto:ready --remove-label auto:needs-fixes; want_writes; done_case
  begin W15c "conflicting verdicts, the move fails -> ERROR ending '— no marker', both verdicts left"
  runblk 7 GH_EDIT_RACE_ADD=auto:needs-fixes GH_EDIT_FAIL_NTH=2; want_status "$CV — no marker"
  want_labels 7 "auto:needs-fixes auto:ready"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:ready
  exp FAIL pr edit 7 --repo "$R" --add-label auto:needs-human --remove-label auto:ready --remove-label auto:needs-fixes; want_writes; done_case
  begin W11 "post-edit label read fails -> OK marked=none (label read failed), no head read, no comment"
  runblk 7 GH_LABELS_VIEW_FAIL_AFTER_EDIT=1; want_status "AFKREV_OK auto:ready marked=none (label read failed)"
  want_calls "pr view labels" "pr edit" "pr view labels"
  exp ok pr edit 7 --repo "$R" --remove-label auto:reviewing --add-label auto:ready; want_writes; done_case
  begin W7 "claim check fails -> ERROR, no writes"
  runblk 7 GH_PR_VIEW_FAIL=1; want_status "AFKREV_ERROR claim check failed"; want_calls "pr view labels"; want_no_writes; done_case
  begin W8 "claim lost to an escalation -> ERROR, no writes"
  runblk 7 "GH_PR_LABELS=auto:needs-human"
  want_status "AFKREV_ERROR lost claim (auto labels: 'auto:needs-human') — not transitioning"; want_calls "pr view labels"; want_no_writes; done_case
  begin W8b "claim swept back to needs-review -> ERROR, no writes"
  runblk 7 "GH_PR_LABELS=auto:needs-review" @VERDICT=needs-fixes
  want_status "AFKREV_ERROR lost claim (auto labels: 'auto:needs-review') — not transitioning"; want_no_writes; done_case
  begin W8c "auto:reviewing beside auto:needs-human -> ERROR, no writes"
  runblk 7 "GH_PR_LABELS=auto:reviewing auto:needs-human"
  want_status "AFKREV_ERROR lost claim (auto labels: 'auto:needs-human auto:reviewing') — not transitioning"; want_no_writes; done_case
  begin W8d "auto:reviewing beside auto:needs-review -> ERROR, no writes"
  runblk 7 "GH_PR_LABELS=auto:reviewing auto:needs-review"
  want_status "AFKREV_ERROR lost claim (auto labels: 'auto:needs-review auto:reviewing') — not transitioning"; want_no_writes; done_case
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
  begin E2b "label lookup fails -> ERROR claim check failed, no writes"
  runblk 8 GH_PR_VIEW_FAIL=1; want_status "AFKREV_ERROR claim check failed"; want_calls "pr view labels"; want_no_writes; done_case
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
