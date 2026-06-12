#!/usr/bin/env bash
#
# tmux-multi-launch.sh — spawn one tmux pane per identifier, each running a
# fresh Claude Code instance for an independent task.
#
# Shared by the --multi modes of /execute, /receiving-pr-feedback, and /review.
# Those skills used to re-implement this block verbatim (parse IDs, validate
# against shell injection, spawn N panes via `tmux split-window`). This script
# is the single source of truth for that mechanism — see issue #103.
#
# Usage:
#   tmux-multi-launch.sh \
#     --mode {issue|pr|spec} \
#     --ids "1,2,3" \
#     --prompt 'Run /execute issue {ID}. Implement the issue fully ...' \
#     --label 'Execution of issue #{ID} complete' \
#     [--summary-label "Multi execution"]
#
# {ID} in --prompt and --label is replaced with each identifier in turn.
#
# Validation by mode:
#   issue, pr  → each id must match ^[0-9]+$ (rejects $(...), backticks, etc.
#                before they reach the double-quoted tmux command)
#   spec       → each id (a slug) must match ^[A-Za-z0-9._-]+$
#
# Exit codes:
#   0  panes launched
#   1  usage error (missing/bad flag, no ids)
#   2  an id failed validation
#   3  not inside a tmux session
#   4  tmux not installed

set -euo pipefail

die() { echo "$1" >&2; exit "${2:-1}"; }

MODE=""
IDS=""
PROMPT=""
LABEL=""
SUMMARY_LABEL="Multi launch"

while [ $# -gt 0 ]; do
  case "$1" in
    --mode)          MODE="${2:-}"; shift 2 ;;
    --ids)           IDS="${2:-}"; shift 2 ;;
    --prompt)        PROMPT="${2:-}"; shift 2 ;;
    --label)         LABEL="${2:-}"; shift 2 ;;
    --summary-label) SUMMARY_LABEL="${2:-}"; shift 2 ;;
    *) die "Unknown argument: $1" 1 ;;
  esac
done

[ -n "$MODE" ]   || die "--mode is required (issue|pr|spec)" 1
[ -n "$IDS" ]    || die "--ids is required (comma-separated identifiers)" 1
[ -n "$PROMPT" ] || die "--prompt is required (per-pane Claude prompt, use {ID})" 1
[ -n "$LABEL" ]  || die "--label is required (per-pane completion label, use {ID})" 1

case "$MODE" in
  issue|pr) PATTERN='^[0-9]+$' ;;
  spec)     PATTERN='^[A-Za-z0-9._-]+$' ;;
  *) die "Invalid --mode '$MODE' (expected issue, pr, or spec)" 1 ;;
esac

# Split comma-separated ids into an array, trimming surrounding whitespace.
IFS=',' read -ra RAW_IDS <<< "$IDS"
PARSED=()
for raw in "${RAW_IDS[@]}"; do
  id="$(printf '%s' "$raw" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  [ -n "$id" ] || continue
  PARSED+=("$id")
done

[ "${#PARSED[@]}" -gt 0 ] || die "No identifiers found in --ids '$IDS'" 1

# Validate BEFORE touching tmux: a value containing $(...), backticks, or other
# shell metacharacters would fire command substitution inside the double-quoted
# tmux command below.
for id in "${PARSED[@]}"; do
  [[ "$id" =~ $PATTERN ]] || die "Invalid $MODE identifier: '$id' (must match $PATTERN)" 2
done

# Require tmux and an active session — split-window has nowhere to put panes
# outside one.
command -v tmux >/dev/null 2>&1 || die "tmux is not installed. Install tmux, then re-run." 4
TARGET="$(tmux display-message -p '#S:#I' 2>/dev/null)" \
  || die "--multi requires an active tmux session. Start tmux first, then re-run." 3
[ -n "$TARGET" ] \
  || die "--multi requires an active tmux session. Start tmux first, then re-run." 3

for id in "${PARSED[@]}"; do
  pane_prompt="${PROMPT//\{ID\}/$id}"
  pane_label="${LABEL//\{ID\}/$id}"
  tmux split-window -t "$TARGET" -h \
    "claude --dangerously-skip-permissions --print '${pane_prompt}' 2>&1; echo '--- ${pane_label}. Press Enter to close. ---'; read"
  tmux select-layout -t "$TARGET" tiled
done

printf '%s launched:\n' "$SUMMARY_LABEL"
printf '  Mode: %s\n' "$MODE"
printf '  Items: %s\n' "$(IFS=', '; echo "${PARSED[*]}")"
printf '  Panes: %d new tmux pane(s) created\n' "${#PARSED[@]}"
printf '  Each instance runs independently in a fresh context.\n\n'
printf 'Watch progress in the tmux panes. This instance is done.\n'
