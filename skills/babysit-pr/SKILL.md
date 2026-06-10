---
name: babysit-pr
version: 1.0.0
description: |
  watch this PR, monitor CI, babysit, watch CI, is CI done, check PR status,
  watch for merge, keep an eye on this.
  Monitor a PR through to merge. Polls CI (ETag-based, zero rate-limit cost),
  retries flaky failures once, notifies when checks pass, detects merge conflicts.
  Auto-spawned after `gh pr create` or invoke manually.
argument-hint: [<pr-number>] [--status] [--stop] [--logs]
allowed-tools:
  - Bash
  - Read
---

# /babysit-pr: PR Babysitter

Monitors a PR from creation to merge. The watching happens in a detached background daemon (`scripts/hooks/babysit-pr-daemon.cjs`); this skill only spawns it and reads the files it writes. You hear from the daemon only when something needs your attention.

## How the daemon behaves

The daemon takes `<owner/repo> <pr-number>` and runs a fixed loop — there is no per-user config to set. On every invocation it:

1. **Polls CI checks** every 30s via the GitHub REST API with an `If-None-Match` ETag (a `304` response costs zero rate limit).
2. **Retries flaky CI once** — on a failed check it runs `gh run rerun <id> --failed` for the failed workflow runs at the current head SHA. One retry per push; the counter resets when you push new commits.
3. **Notifies when green** — fires a macOS notification (`osascript display notification`) when all checks pass. Merging is always manual; the daemon never merges.
4. **Detects merge conflicts** — when the PR's `mergeable_state` is `dirty`, writes `conflict` and notifies.
5. **Watches until merged** — notifies and exits when the PR merges, closes, or after the 60-minute cap.

Notifications are macOS-only (`osascript`). On non-macOS hosts the `osascript` call is a no-op, but the status and log files are still written.

### Files the daemon writes

- **Status** — `/tmp/claude-babysit-<pr>.json` (overwritten each poll)
- **Log** — `/tmp/claude-babysit-<pr>.log` (appended)

Both live in `os.tmpdir()` and are cleared on reboot.

Status file schema (from `writeStatus` in the daemon):

```json
{
  "pr": 123,
  "repo": "owner/name",
  "url": "https://github.com/owner/name/pull/123",
  "pid": 54321,
  "state": "watching",
  "detail": "CI running: 2/3 complete",
  "retriesUsed": 0,
  "notifiedReady": false,
  "updatedAt": "2026-06-10T12:00:00.000Z"
}
```

`state` is one of: `watching`, `retrying`, `ready`, `merged`, `closed`, `conflict`, `checks-failed`, `timeout`, `error`.

## Prerequisites

- **`gh` must be authenticated.** The daemon pulls the API token from `gh auth token`; if that fails it writes `state: "error"` and exits immediately. Confirm with `gh auth status` before spawning.

## Auto-trigger

You usually don't invoke this manually. The `ci-monitor.cjs` PostToolUse hook (wired in `hooks/hooks.json`) matches `gh pr create`, extracts the PR URL from the command output, and spawns the daemon detached. No action needed.

## Workflow

Parse `$ARGUMENTS` and dispatch on the flag. The PR number is the first bare argument; if omitted, treat it as `--status` over all babysitters.

### `--status` (or no PR number, no flag)

List every active babysitter and report its state.

1. Find the status files:
   ```bash
   ls /tmp/claude-babysit-*.json 2>/dev/null
   ```
2. If the listing is empty, report "No active babysitters." and stop.
3. For each file, read the relevant fields:
   ```bash
   jq -r '"PR #\(.pr) [\(.state)] \(.detail) — \(.url) (updated \(.updatedAt))"' /tmp/claude-babysit-<pr>.json
   ```
4. Summarise each PR's number, state, detail, URL, and `updatedAt`. Flag any in `conflict`, `checks-failed`, or `error` as needing the user's attention (see States table).

### `<pr> --logs`

Print the daemon's log for that PR.

1. ```bash
   cat /tmp/claude-babysit-<pr>.log 2>/dev/null
   ```
2. If the file is missing, report that no log exists for PR #<pr> (the daemon may never have started, or `/tmp` was cleared on reboot).

### `<pr> --stop`

Kill the daemon for that PR and clean up its files.

1. Read the PID from the status file:
   ```bash
   jq -r '.pid' /tmp/claude-babysit-<pr>.json 2>/dev/null
   ```
   If the file is missing or `.pid` is `null`, report "No babysitter running for PR #<pr>." and stop.
2. Verify the PID is actually this daemon before killing anything (PIDs get recycled):
   ```bash
   ps -p <pid> -o command= | grep babysit-pr-daemon
   ```
   If that grep finds nothing, the process is gone or is something else — skip the `kill`, just remove the stale files.
3. Kill it and clean up:
   ```bash
   kill <pid>
   rm -f /tmp/claude-babysit-<pr>.json /tmp/claude-babysit-<pr>.log
   ```
4. Confirm "Stopped babysitter for PR #<pr>."

### `<pr>` (no flag) — start watching

1. Check whether a babysitter is already live for this PR:
   ```bash
   jq -r '.state' /tmp/claude-babysit-<pr>.json 2>/dev/null
   ```
   If the file exists and its state is non-terminal (`watching`, `retrying`, `ready`, `conflict`, or `checks-failed`), don't spawn a second one — show its current status (run the `--status` step for this PR) and stop. Terminal states (`merged`, `closed`, `timeout`, `error`) mean the old run finished, so proceed.
2. Confirm `gh` auth, since the daemon needs a token:
   ```bash
   gh auth status
   ```
   If this fails, tell the user to run `gh auth login` and stop — spawning now would just write `state: "error"`.
3. Resolve `owner/repo` from the current checkout:
   ```bash
   gh repo view --json nameWithOwner --jq '.nameWithOwner'
   ```
4. Spawn the daemon detached. The daemon lives in calsuite, not in the target repo — reference it through `$CALSUITE_DIR`, which the installer resolves to an absolute path:
   ```bash
   node "$CALSUITE_DIR/scripts/hooks/babysit-pr-daemon.cjs" <owner/repo> <pr-number> &
   disown
   ```
   If `$CALSUITE_DIR` isn't exported in the shell, substitute the absolute path to your calsuite checkout's `scripts/hooks/babysit-pr-daemon.cjs` (the `ci-monitor.cjs` hook locates it via `__dirname`, so the auto-trigger path never depends on the env var).
5. Confirm "Babysitter started for PR #<n>. You'll get a notification when something needs attention."

## States

| State | Meaning | Action |
|-------|---------|--------|
| `watching` | Polling CI checks | None — daemon is working |
| `retrying` | Flaky CI detected, rerunning | None — daemon is retrying |
| `ready` | All CI green | **You can merge the PR** |
| `merged` | PR merged | Done — daemon has exited |
| `closed` | PR closed without merge | Done — daemon has exited |
| `conflict` | Merge conflicts detected | **You need to resolve conflicts** |
| `checks-failed` | CI failed after retry | **You need to fix the failure** |
| `timeout` | Daemon hit the 60-min cap | Re-run `/babysit-pr <n>` to restart |
| `error` | Daemon couldn't run (e.g. no `gh` token) | Check logs with `/babysit-pr <n> --logs` |

## Important rules

1. **Never block the user.** The daemon runs detached in the background; the skill only spawns it and reads its files.
2. **Notifications are for action items.** The daemon notifies on ready, conflict, failure, and merge — not on routine `watching` ticks.
3. **One retry per push.** The daemon retries failed CI once, then writes `checks-failed`. Persistent failures need a human.
4. **Keep watching after conflicts/failures.** The daemon stays in the loop so it picks up your fix push without you restarting it.

## Gotchas

- **`/tmp/` is cleared on reboot.** Status and log files don't survive a restart; re-run `/babysit-pr <n>` to start fresh.
- **Merging is always human.** The daemon never merges, even with auto-merge enabled on the repo — it only notifies.
- **ETag polling needs `gh` auth.** If `gh auth token` fails, the daemon writes `error` and exits at once.
- **No notification config.** The daemon always uses macOS `osascript` plus the status/log files — there is no terminal-bell or silent mode to choose.
- **One daemon per PR.** Before spawning, the skill checks for a non-terminal status file so two daemons don't poll the same PR.
