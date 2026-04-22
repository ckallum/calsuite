---
name: reconcile
description: |
  Wrap configure-claude.js --reconcile <path> for a single divergent skill/agent file.
  Aliases: reconcile <path>, three-way merge <path>, resolve divergence <path>,
  merge calsuite changes into <path>, fix this divergent file, merge this file,
  reconcile one file, single-file reconciliation. Pre-flights path validity,
  calsuite location, and `$EDITOR`; runs the interactive 3-way merge; interprets
  the exit state. For cross-target bulk reconciliation use /reconcile-targets
  instead. Calsuite-internal: lives in this repo, not distributed to targets.
argument-hint: "[<path>]  # omit for interactive picker"
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---

# Reconcile one divergent skill/agent file

Thin wrapper around `configure-claude.js --reconcile <path>` — the interactive three-way merge primitive. This skill adds pre-flight (calsuite reachable, `$EDITOR` set, file is actually divergent) and post-run interpretation. The real merge UI is the installer's; this is just the polished entry point.

Use when **one specific file** needs reconciling. For bulk handling across multiple targets or files, use `/reconcile-targets`. For "I just want to claim this file and keep my edits," use `/customise` (which fuses edit + claim).

## When to invoke

- `/sync` surfaced a single flagged file (`skip-diverged` or `skip-unknown`) and you want to merge calsuite's newer version with your local edits.
- You've been notified of a specific divergence and don't want the overhead of an agentic pass.
- You know which file is stuck and want the shortest path from "stuck" to "merged."

## When NOT to invoke

- **Multiple divergent files** — run `/reconcile-targets` for the agentic cross-target pass, or `/sync-preview` to see scope first.
- **You want to take calsuite's version wholesale** — use `--force-adopt <path> --yes`. No merge UI needed.
- **You want to keep your version verbatim** — use `--claim <path>` (or `/customise <skill-name>` for edit-and-claim).
- **The file isn't actually divergent** — `--reconcile` on a pristine file is a waste of `$EDITOR` time. Step 2 warns you.

## Step 0: Pre-flight

```bash
calsuite_dir="${CALSUITE_DIR:-$HOME/Projects/calsuite}"
if [ ! -f "$calsuite_dir/scripts/configure-claude.js" ]; then
  echo "✗ Calsuite installer not found at $calsuite_dir/scripts/configure-claude.js"
  echo "  Set \$CALSUITE_DIR to your calsuite checkout, or clone it to ~/Projects/calsuite"
  exit 1
fi

# $EDITOR is required for the 3-way merge pane. vi is the installer's fallback,
# but warn if the user hasn't set anything — vi panic is a bad first experience.
if [ -z "$EDITOR" ] && [ -z "$VISUAL" ]; then
  echo "⚠ Neither \$EDITOR nor \$VISUAL is set. The installer will fall back to vi."
  echo "  If that's not what you want, Ctrl-C now, export EDITOR=<your-editor>, and re-run."
fi
```

## Step 1: Resolve the path

`$ARGUMENTS` contains the path — absolute or relative to the current working directory. If absent, fall back to interactive mode.

**Path provided:**

Resolve the parent dir to an absolute path, checking existence explicitly. A plain `cd … 2>/dev/null && pwd` would silently yield an empty string on failure, producing a bogus `/<basename>` abs_path that only blows up two steps later — error up front instead.

```bash
raw_path="$ARGUMENTS"
parent_dir="$(dirname "$raw_path")"
if [ ! -d "$parent_dir" ]; then
  echo "✗ $raw_path — parent directory not found ($parent_dir)"
  exit 1
fi
abs_path="$(cd "$parent_dir" && pwd)/$(basename "$raw_path")"
```

The `-d` guard means the `cd` inside the command substitution cannot fail, so no `&&` fallback gymnastics needed.

**No arguments — interactive mode:**

Run the sync preview in JSON, extract skip-diverged + skip-unknown candidates across all targets, prompt the user with `AskUserQuestion` to pick one:

```bash
node "$calsuite_dir/scripts/sync-preview.cjs" --json
```

Parse the output: for each target, concatenate `files["skip-diverged"]` and `files["skip-unknown"]`. Build a picker list like:

```
A) verity/.claude/skills/ship/SKILL.md (skip-unknown — no _origin)
B) verity/.claude/skills/review/SKILL.md (skip-diverged — since a49a827)
C) timeline/.claude/skills/ship/SKILL.md (skip-unknown)
...
```

Prefix each option with the target name + relative path. If the list is empty, tell the user "No divergent files across any target. Nothing to reconcile." and stop — don't open an empty `--reconcile`.

## Step 2: Validate and check state

Before invoking, assert the path is reconcile-eligible. The installer does these same checks, but doing them in the skill lets you explain each failure in plain English:

| Check | Failure message |
|---|---|
| File exists | `✗ <abs_path> does not exist` |
| Ends in `.md` | `✗ --reconcile only supports markdown files` |
| Path contains `/.claude/skills/` or `/.claude/agents/` | `✗ File is not under a target's .claude/skills or .claude/agents` |

If all three pass, peek at the file's `_origin` to set expectations:

- **No `_origin` + content differs from calsuite current** (`skip-unknown`) — 2-way merge. Warn: "No `_origin` marker; merging with calsuite's current only (no ancestor pane)."
- **`_origin: calsuite@<sha>`** — check `git show <sha>:<calsuite-rel-path>` in calsuite. If present → full 3-way. If not → "install sha unknown to calsuite; falling back to 2-way merge."
- **`_origin: <non-calsuite>`** — tell user: "File is claimed (`_origin: <value>`). `--reconcile` will short-circuit. Use `--force-adopt` to overwrite or leave as-is."
- **`_origin: calsuite@<sha>` + byte-identical to that sha** (would route to `write-update`) — `--reconcile` still works but there's nothing to merge. Ask via `AskUserQuestion`: "File is currently pristine. Proceed with reconcile anyway?" Default no.

## Step 3: Run --reconcile

```bash
node "$calsuite_dir/scripts/configure-claude.js" --reconcile "$abs_path"
```

Stream stdout to the user; the installer takes over the TTY during the editor phase. Claude Code will pause while `$EDITOR` has the terminal.

When the command returns, capture its exit code. Possible outcomes:

| Exit code | Stdout marker | Meaning |
|---|---|---|
| 0 | `✓ Merged. <path> ← calsuite@<sha> (user-resolved)` | Merge completed, file stamped. |
| 0 | `✓ Kept target's version.` | User picked [k] — same as `--claim`. |
| 0 | `✓ Adopted calsuite's current version.` | User picked [a] — same as `--force-adopt`. |
| 0 | `⊘ Skipped.` | User picked [s] — file untouched, still flagged. |
| 0 | `⊘ File is claimed (_origin: <x>).` | Short-circuited; nothing happened. |
| 1 | `✗ Editor exited with status N` | Editor crashed or user `:cq`'d; original file untouched. |
| 1 | `✗ Conflict markers still present` | User saved without resolving; tmp file preserved, path in the message. |
| 1 | Any other `✗ ...` | Validation error (missing path, non-md, etc.) — should be prevented by Step 2. |

## Step 4: Summarise

Produce a short, factual report:

- **Success**: `Merged <rel-path>. _origin now: calsuite@<current-sha>.`
- **Kept**: `Kept your version. <rel-path> is now user-claimed (_origin: <target-name>). Subsequent --sync will leave it alone.`
- **Adopted**: `Adopted calsuite's version. Your previous edits to <rel-path> are gone.`
- **Skipped**: `Skipped. <rel-path> is still flagged — re-run /reconcile or /reconcile-targets when ready.`
- **Aborted (editor nonzero)**: `Editor exited non-zero. Original <rel-path> untouched. Conflict-marked tmp file kept at /tmp/calsuite-reconcile-... — resume from there or delete it.`
- **Aborted (markers left)**: `Conflict markers still present. Original <rel-path> untouched. Re-run /reconcile when you're ready to finish.`

Don't re-print the full `--reconcile` output the user already saw. Just interpret.

## Arguments

- `<path>` — optional. Absolute or relative path to the divergent file inside a target's `.claude/skills/<name>/*.md` or `.claude/agents/*.md`. Omit to enter interactive picker mode (lists all divergent files across targets via `/sync-preview`).

## Related

- `/sync-preview` — surfaces the list of divergent files. Run this before deciding to reconcile.
- `/reconcile-targets` — agentic cross-target pass for when scope is large.
- `/customise <skill-name>` — the edit-then-claim workflow. Use when you're intentionally diverging, not merging.
- `configure-claude.js --force-adopt <path> --yes` — take calsuite's version; destroys local edits.
- `configure-claude.js --claim <path>` — keep your version; stamps `_origin: <target-name>`.

## Gotchas

- **Interactive mode TTY requirement.** `--reconcile` requires a TTY for the `$EDITOR` handoff and the k/a/m/s prompt. This skill's interactive picker (Step 1) also needs a TTY for `AskUserQuestion`. If you're running inside a pipeline or non-interactive shell, provide `<path>` explicitly.
- **`$EDITOR` pitfalls.** The installer uses `$EDITOR` → `$VISUAL` → `vi`. If your editor is a GUI that forks (e.g. `code` without `--wait`), the merge will proceed before you've actually saved. Use `code --wait`, `subl -w`, or set `$EDITOR=vim`/`nano`/`emacs -nw` for a blocking terminal editor.
- **Running from a target vs calsuite.** Step 1's path resolution uses `pwd`. Relative paths work from any cwd as long as they resolve to a real file under some target's `.claude/`. Absolute paths always work.
- **Nested targets.** If one target repo contains a submodule with its own `.claude/skills/` (unusual), `--reconcile` will treat the submodule path as a valid target path. That's probably not what you want — pass absolute paths to be unambiguous.
