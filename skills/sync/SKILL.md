---
name: sync
description: |
  Manually run calsuite's mechanical --sync across every target in config/targets.json,
  then interpret the divergence summary and suggest next steps. Aliases: sync, run sync,
  push calsuite to targets, flow calsuite changes, propagate calsuite, sync calsuite,
  kick off sync. Supports `/sync preview` for a read-only dry run (delegates to
  /sync-preview). Calsuite-internal: lives in this repo, not distributed.
argument-hint: "[preview] [--target <name>]"
allowed-tools:
  - Bash
  - Read
---

# Run calsuite --sync with interpretation

Fires calsuite's mechanical sync protocol across every target in `config/targets.json`, then reads the end-of-sync summary and tells you what needs follow-up. Delegate to `/sync-preview` when you only want the read-only report.

The post-commit hook already auto-syncs on every calsuite commit. This skill is for **manual** invocation: re-syncing after an out-of-band calsuite change, kicking the protocol after editing a target's `.claude/skills` file, or forcing a refresh when something drifted.

## When to invoke

- You edited a skill in calsuite and want it distributed immediately (before the next commit fires the post-commit hook).
- A target's `.claude/` got mutated outside calsuite's flow and you want to reset it.
- Post-commit hook was disabled for some reason and you're catching up manually.
- **You want a dry-run first** — use `/sync preview`.

## When NOT to invoke

- **Daily development** — the post-commit hook handles routine sync for free. Don't double-fire.
- **For reconciling diverged files** — `--sync` skips those. Use `/reconcile-targets`, `--reconcile <path>`, `--force-adopt`, or `--claim` instead.
- **For deleting stale state** — that's `--prune-stale`.

## Step 0: Pre-flight

```bash
calsuite_dir="${CALSUITE_DIR:-$HOME/Projects/calsuite}"
if [ ! -f "$calsuite_dir/scripts/configure-claude.js" ]; then
  echo "✗ Calsuite installer not found at $calsuite_dir/scripts/configure-claude.js"
  echo "  Set \$CALSUITE_DIR to your calsuite checkout, or clone it to ~/Projects/calsuite"
  exit 1
fi
```

## Step 1: Parse arguments

`$ARGUMENTS` is optional. Two modes:

- **Preview mode** — if the first word is `preview`, delegate entirely to `/sync-preview` and stop here. Pass remaining arguments through:
  ```bash
  # user invoked /sync preview --target verity
  node "$calsuite_dir/scripts/sync-preview.cjs" --target verity
  ```
  Preview never writes. Do not run the real `--sync` afterward.

- **Real sync mode** — default. Proceed to Step 2.

Any other flags (`--target <name>`, etc.) are not currently supported by `--sync`; reject with a helpful error if provided in real mode (`--sync` always walks every target).

## Step 2: Run the sync

```bash
node "$calsuite_dir/scripts/configure-claude.js" --sync
```

Stream output directly to the user. Capture the last ~40 lines for Step 3 (the end-of-sync divergence summary, if any).

## Step 3: Read the summary

`--sync` prints a divergence summary when files were skipped pending reconciliation. Look for the block delimited by `───────────` separators — inside it:

- `N file(s) skipped pending reconciliation:` — overall count
- Per-file lines: `• <target>/.claude/skills/ship/SKILL.md` + reason (`skip-diverged: user-modified since <sha>` OR `skip-unknown: no _origin marker and content diverges`)

If no summary block appeared, sync ran clean — say so and stop.

## Step 4: Interpret and suggest next steps

Pick the smallest-viable follow-up and propose exact commands. Rules of thumb:

| Situation | Recommendation |
|---|---|
| 0 skipped | `All clean.` Don't belabor. |
| 1–3 skipped, concentrated on one target | Suggest `--reconcile <path>` (or `--claim`/`--force-adopt`) for each specific file. Paste the exact commands. |
| 4–10 skipped across multiple targets | Suggest `/reconcile-targets` for the agentic pass. Offer `/sync preview` first if the user wants the full picture before committing. |
| 10+ skipped | Strongly recommend `/sync preview` then `/reconcile-targets`. Don't paste individual commands — the volume is not hand-fixable. |
| Any `skip-diverged` files | Note that these are `_origin`-stamped + user-edited. Usually want `--reconcile` (merge) or `--claim` (keep local). |
| Any `skip-unknown` files | Pre-protocol edits or stale copies — indistinguishable. `/reconcile-targets` can reason about each; blunt `--force-adopt` loses any intentional edits. |

When suggesting commands, always use absolute paths so the user can copy-paste without re-resolving:

```
node "$calsuite_dir/scripts/configure-claude.js" --reconcile "/Users/me/Projects/verity/.claude/skills/ship/SKILL.md"
```

## Arguments

- `preview` — first positional. Switches to read-only mode; delegates to `/sync-preview`. No other `--sync` args are respected when preview is set.
- `--target <name>` — only respected in preview mode (passed through to `sync-preview.cjs`). Real `--sync` always walks every target.

## Related

- `/sync-preview` — the read-only dry-run. Invoked directly by `/sync preview`.
- `/reconcile-targets` — agentic per-file reconciler for the skipped files.
- `configure-claude.js --reconcile <path>` — single-file three-way merge.
- `configure-claude.js --force-adopt <path>` / `--claim <path>` — single-file blunt resolvers.
- `configure-claude.js --prune-stale` — **different** operation: deletes stale state rather than syncing.

## Gotchas

- **`--sync` only skips; it never destroys.** Whatever's flagged in the summary is still on disk exactly as it was. Resolving via `--claim` preserves content; `--force-adopt` is the only loss path and it's explicit.
- **The post-commit hook runs this same command.** If you manually `/sync` immediately after a calsuite commit, the second run will be a no-op for everything the hook already wrote — that's fine.
- **Target basename matters for `_origin: <target-name>`.** Under the hood, `--sync` uses each target's basename (e.g. `verity`). If you renamed a target directory, the next sync will see `_origin: old-name` as "claimed by a different target" and skip it. Use `--force-adopt` or `--claim` with the new name to recover.
