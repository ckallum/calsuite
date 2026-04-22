---
name: sync-preview
description: |
  Read-only preview of calsuite --sync across every target in config/targets.json.
  Aliases: sync-preview, sync --preview, what would sync do, preview sync, dry-run sync,
  show divergence, divergence report, which skills have diverged, what will --sync change,
  check target drift, target drift report.
  Reports per-target counts of files that would be written/updated/migrated/skipped,
  plus a full list of diverged files with reasons. Writes nothing — safe any time.
  Run BEFORE /reconcile-targets to understand scope. Calsuite-internal: lives in
  this repo, not distributed to targets.
argument-hint: "[--target <name>] [--json]"
allowed-tools:
  - Bash
  - Read
---

# Preview what calsuite --sync would do

Read-only snapshot of every target's divergence state against calsuite's current HEAD. Tells you:

- How many files are pristine (would safely update)
- How many are pre-protocol but byte-identical to current calsuite (auto-migrate silently)
- How many **need reconciliation** (diverged or pre-protocol with local edits) — the ones stuck on every `--sync` until resolved

This skill never writes. Its only job is to produce a readable report.

## When to invoke

- **Before `/reconcile-targets`** — scope check. If `skip-unknown` + `skip-diverged` sum to 3, you can handle it manually; if they sum to 30, you want the agentic pass.
- **After a long absence** — multi-week drift catch-up. Preview first, decide how many sessions this is, then act.
- **After bulk calsuite changes** — shipped a new lint pack or renamed a skill? Preview to see the blast radius before syncing.
- **Debugging a "why is this file still flagged" loop** — the per-file reasons (`user-modified since <sha>` / `no _origin marker and content diverges`) show exactly which matrix row a file lands in.

## When NOT to invoke

- **Daily hygiene** — the post-commit auto-sync already handles the clean cases. Don't run this for routine commits; it's for divergence investigation.
- **Inside a target** — sync-preview walks calsuite's `config/targets.json` and reads calsuite's source tree. Run from calsuite itself.

## Step 0: Pre-flight

The script lives at `scripts/sync-preview.cjs` inside calsuite and is tracked in the repo. You must run from a directory where calsuite is reachable.

```bash
calsuite_dir="${CALSUITE_DIR:-$HOME/Projects/calsuite}"
if [ ! -f "$calsuite_dir/scripts/sync-preview.cjs" ]; then
  echo "✗ sync-preview not found at $calsuite_dir/scripts/sync-preview.cjs"
  echo "  Set \$CALSUITE_DIR to your calsuite checkout, or run this skill from inside calsuite."
  exit 1
fi
```

## Step 1: Parse arguments

`$ARGUMENTS` is optional. Supported flags, passed straight to the script:

| Flag | Effect |
|---|---|
| `--target <name>` | Scope to a single target by basename (e.g. `verity`). |
| `--json` | Machine-readable output. Useful when piping into another tool; humans should omit. |

If no arguments, preview every target in `config/targets.json`.

## Step 2: Run the script

```bash
node "$calsuite_dir/scripts/sync-preview.cjs" $ARGUMENTS
```

The script exits non-zero only on fatal errors (missing `targets.json`, malformed config). Any divergence count is still exit 0 — that's informational, not failure.

## Step 3: Interpret the output

Human output has three sections:

1. **Header** — `Calsuite HEAD: <sha>` and `Targets: N`.
2. **Per-target breakdown** — for each target: counts per action, then detail lists for `skip-diverged`, `skip-unknown`, `skip-claimed`, and up to 8 `write-new` files.
3. **Grand total** — summed across all targets, plus a one-liner pointing to resolution commands.

Action semantics (copy-paste into your summary if useful):

| Action | Meaning | Action needed |
|---|---|---|
| `write-new` | File exists in calsuite but not yet at target. | None — `--sync` will create it. |
| `write-update` | File carries `_origin: calsuite@<sha>` and still matches calsuite's content at that sha. | None — `--sync` will safely overwrite. |
| `migrate` | Pre-protocol file byte-identical to current calsuite. | None — `--sync` will stamp `_origin` silently. |
| `skip-diverged` | File has `_origin: calsuite@<sha>` but local edits on top. | `--reconcile <path>` (merge), `--claim <path>` (keep local), or `--force-adopt <path>` (take calsuite's). |
| `skip-unknown` | File has no `_origin` AND differs from calsuite's current. Pre-protocol edit or stale copy — indistinguishable. | Same three commands as `skip-diverged`. Or `/reconcile-targets` for agentic handling. |
| `skip-claimed` | File has `_origin: <target-name>`. Working as designed. | None — this is deliberate divergence. |

## Step 4: Summarise for the user

Produce a terse, actionable takeaway. Examples:

- **"All clean"**: `No reconciliation needed across N targets.` Don't belabor it.
- **"Small scope, manual-fixable"**: `3 files stuck across 2 targets. Suggested commands: ...` with the exact `--reconcile`/`--claim`/`--force-adopt` invocations.
- **"Large scope"**: `28 files stuck across 3 targets. Scope makes /reconcile-targets the right next step. Before invoking, review the top-N files to spot obvious intentional divergences (e.g. verity's /ship customisations) — those should be --claim, not --reconcile.`
- **"Concentrated on one target"**: call that out explicitly. If verity has 20/28, the user's real question is about verity — say so.

Don't repaste the full script output — the user already saw it. Add the interpretation layer that turns counts into decisions.

## Arguments

- `--target <name>` — optional. Filter to one target by basename (the last segment of its path in `config/targets.json`).
- `--json` — optional. Emit machine-readable output instead of human-readable. Set when piping into scripts or other skills.

## Related

- `/reconcile-targets` — the agentic per-file reconciler this skill front-runs. Preview first, then reconcile.
- `configure-claude.js --reconcile <path>` — single-file three-way merge. Use when the scope is tiny.
- `configure-claude.js --claim <path>` — mark a file user-owned. Use when you've intentionally diverged (cross-ref `/customise` which fuses edit + claim).
- `configure-claude.js --force-adopt <path>` — discard local edits, take calsuite's. Use when you know the local edits were accidental.
- `configure-claude.js --prune-stale` — different operation: DELETES stale row-6 files rather than reconciling them. Use sparingly; destructive.

## Gotchas

- **`write-new` counts can overshoot.** The preview enumerates every calsuite source file missing from a target, but at real sync time the profile resolver filters — a `python`-profile target won't actually receive every `typescript` skill. The preview intentionally overcounts because its job is to reveal max possible drift, not reproduce the installer's filter logic. Trust the `skip-*` buckets exactly; take `write-new` as an upper bound.
- **Script path is calsuite-local.** Running sync-preview from inside a target will fail the Step 0 guard. That's the design — targets don't need a sync-preview; they're subjects of it.
- **`_origin` parse tolerance.** Malformed frontmatter (e.g. hand-edited YAML that broke syntax) parses as "no `_origin`" and routes the file to `skip-unknown`. If a file shows up unexpectedly, check its frontmatter block by eye.
