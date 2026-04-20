---
name: reconcile-targets
description: |
  Agentically reconcile divergent calsuite-distributed skill/agent files across target
  repos. For each divergence surfaced by `configure-claude.js --sync`, spin up a scoped
  analysis, decide upstream vs cross-port vs keep-local with the user, and open PRs.
  Manual invocation only — costs tokens and time, not for the post-commit hook.
  Use after a multi-week drift, or when `--sync` reports N skipped files pending
  reconciliation and the user wants to catch up thoughtfully rather than pick one of
  `--force-adopt` / `--claim` blindly.
argument-hint: ""
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---

# Reconcile calsuite divergences across target repos

Second-layer agentic reconciliation on top of the mechanical `_origin` `--sync` protocol.
The mechanical layer (`scripts/lib/origin-protocol.cjs`) can only decide "overwrite" or
"skip" — it cannot reason about _why_ a target has diverged. This skill reads each
divergence, summarises both sides, and routes the user through the right resolution:
upstream to calsuite, cross-port to peer targets, keep-target-local, adopt-calsuite, or
three-way merge.

See `specs/personal-harness-refactor/design.md` for the two-layer split rationale. The
cheap/deterministic mechanical sync runs on every commit; the expensive agentic layer
only fires when the user invokes this skill.

## When to invoke

- After `node scripts/configure-claude.js --sync` prints an end-of-sync summary with
  N files skipped pending reconciliation, and you want to resolve them thoughtfully.
- After a multi-week drift where several targets have diverged and you want to catch
  up calsuite with the best ideas from each, rather than blindly claiming everything.
- **Not** from the post-commit hook. This skill is slow, non-deterministic, and costs
  tokens — explicit manual invocation only.

## Arguments

None. The skill scans `config/targets.json` automatically.

## Phase 0: Pre-flight — locate calsuite and enumerate divergences

Resolve the calsuite checkout the same way the installer does:

```bash
calsuite_dir="${CALSUITE_DIR:-$HOME/Projects/calsuite}"
if [ ! -f "$calsuite_dir/scripts/configure-claude.js" ]; then
  echo "✗ Calsuite installer not found at $calsuite_dir/scripts/configure-claude.js"
  echo "  Set \$CALSUITE_DIR to your calsuite checkout, or clone it to ~/Projects/calsuite"
  exit 1
fi
```

Run a fresh mechanical sync from the calsuite root and capture stdout. This both
refreshes the divergence state (target edits may have landed since the last sync) and
gives us the canonical list to iterate:

```bash
sync_log="$(mktemp)"
(cd "$calsuite_dir" && node scripts/configure-claude.js --sync) | tee "$sync_log"
```

Parse the end-of-sync block. The mechanical sync prints lines shaped like:

```
<target>/.claude/skills/<name>/SKILL.md
  skip-diverged: user-modified since <sha>
```

or

```
<target>/.claude/agents/<name>.md
  skip-unknown: no _origin marker and content diverges from current calsuite
```

Extract each target-relative path and the action/reason. Group by target. If zero
divergences: announce "No divergences found — mechanical sync is clean" and **STOP**.

If you ever need to re-enumerate without re-running `--sync` (e.g. the log was lost),
the source of truth is each target's `.claude/skills/*/SKILL.md` and
`.claude/agents/*.md` — walk those and call `origin-protocol.decideFileAction` on each.
Re-running `--sync` is simpler and always correct; the walk is the fallback.

## Phase 1: Pull diffs for each divergence

For each divergence file, gather the context a human reviewer would need:

1. **Target's local history** — what the target changed and why:
   ```bash
   git -C <target-path> log -p --follow -- <relative-path>
   ```
2. **Calsuite's drift since install sha** — what calsuite has changed on its side since
   the file was last stamped. The install sha lives in the target file's `_origin:
   calsuite@<sha>` frontmatter (for `skip-diverged`; `skip-unknown` has no sha and you
   compare against calsuite HEAD):
   ```bash
   install_sha=$(awk '/^_origin: calsuite@/ { sub("_origin: calsuite@", ""); print; exit }' <target-path>/<rel-path>)
   git -C "$calsuite_dir" log -p "${install_sha}..HEAD" -- <calsuite-relative-path>
   ```
3. **Side-by-side diff** — calsuite current vs target current, for the Phase 2 prompt.

Dispatch a read-only Agent to summarise each divergence in 3–5 bullets:

```text
prompt: "Summarise why <target> and calsuite have diverged on <rel-path>.
  - Target's local history (attached)
  - Calsuite's changes since the install sha (attached)
  - Current diff between the two (attached)
Call out: (1) whether target's edits look project-specific or generic, (2) whether
calsuite's changes would conflict with target's edits if adopted, (3) whether the
changes overlap semantically (edited the same lines) or are orthogonal."
description: "Analyse divergence: <target>/<rel-path>"
```

Collect the summaries — they feed Phase 2.

## Phase 2: Per-file decision prompt

For each divergence, present the summary to the user via `AskUserQuestion` and route to
one of five actions:

| Choice | Semantics | Default when |
|---|---|---|
| **upstream-to-calsuite** | Port target's edit back to calsuite. Other targets will pick it up on next sync. | Target's change looks generic (bug fix, typo, better wording). |
| **cross-port** | Apply target's change to _other_ listed targets as well (and optionally to calsuite). | Multiple targets want the same divergence; change is near-generic. |
| **keep-target-local** | Mark target's version as user-owned. Runs `--claim`. | Target's edit is project-specific (e.g. a verity-only Lambda step). |
| **adopt-calsuite** | Discard target's edits, take calsuite's current. Runs `--force-adopt`. | Target's edit was a stale/accidental change; calsuite has since evolved in the right direction. |
| **three-way-merge** | Interactive merge of calsuite-current, calsuite-at-install-sha, and target-current. Runs `--reconcile` (see v2.8 in CHANGELOG). | Both sides have non-trivial edits that need to coexist. |

Show the default in the prompt, interactively confirm. Never auto-act without the user
picking.

## Phase 3: Act on decisions

Apply each decision. Never force-push, never bypass hooks. All PR creation goes through
`gh pr create`; commits stay local and explicit.

### upstream-to-calsuite

1. In `$calsuite_dir`, create a branch: `git checkout -b upstream/<target>-<skill-name>`.
2. Apply the target's diff to the calsuite source file. Preserve YAML frontmatter
   (source files do **not** carry `_origin` — the installer stamps it on distribution).
3. Bump the CHANGELOG if the change is user-visible.
4. `git add <path> && git commit -m "<type>: <summary> (upstreamed from <target>)"`.
5. Push and open a PR: `gh pr create --title ... --body ...`. Include a Development
   Flow diagram only if a session flow-trace exists.
6. After the PR merges, the next `--sync` will flow the change to every other target
   automatically — no extra work needed.

### cross-port

1. Upstream to calsuite first (as above) — this is the cheapest way to reach N targets.
2. If the user wants the change in other targets _before_ the calsuite PR merges, run
   per-target:
   ```bash
   node "$calsuite_dir/scripts/configure-claude.js" --only <skill-name> <target-path>
   ```
   This pushes calsuite's current version of that single skill into the target. If the
   target has diverged, you'll need to `--force-adopt` first or apply the patch
   directly by hand and re-claim.

### keep-target-local

Run calsuite's `--claim` to stamp the target's file as user-owned. After this, future
syncs skip the file silently:

```bash
node "$calsuite_dir/scripts/configure-claude.js" --claim "<target-path>/<rel-path>"
```

`--claim` infers the target name from the directory structure (e.g.
`~/Projects/verity/.claude/skills/ship/SKILL.md` → `_origin: verity`).

### adopt-calsuite

Overwrite the target's file with calsuite's current version. Destructive — always
confirm once more before running. `--yes` skips the installer's own prompt:

```bash
node "$calsuite_dir/scripts/configure-claude.js" --force-adopt "<target-path>/<rel-path>" --yes
```

### three-way-merge

Hand off to `configure-claude.js --reconcile` (v2.8, closes #42). This is an
**interactive TTY flow** — it opens `$EDITOR` with conflict markers including the
ancestor block. This skill cannot drive `$EDITOR`; exit to the user:

```text
Three-way merge requires a TTY. Run this in your shell, then reply here when done:

  node "$calsuite_dir/scripts/configure-claude.js" --reconcile "<target-path>/<rel-path>"

I'll resume with the next divergence when you're back.
```

When the user returns, verify the file is now stamped (`grep '^_origin:'` on the
target file) and move on.

## Phase 4: Summary

Report every decision and its resulting action. Keep it terse:

```text
Reconciled N divergences across M targets:

  verity/.claude/skills/ship/SKILL.md         → upstreamed (PR: <url>)
  timeline/.claude/skills/review/SKILL.md     → claimed (_origin: timeline)
  museli/.claude/agents/code-reviewer.md      → adopted calsuite current
  cake/.claude/skills/plan/SKILL.md           → three-way merge (user resolved)

PRs opened:
  - <url> (upstream verity's /ship Lambda-deploy step to calsuite)
  - ...

Next `--sync` will be clean for the resolved files.
```

## Safety

- **No force-push.** All branch pushes use `git push -u origin <branch>` with no `-f`.
- **No branch deletion in targets.** This skill never runs `git branch -D` against a
  target repo.
- **Never hand-edit `_origin`.** The protocol is load-bearing — use `--claim` /
  `--force-adopt` / `--reconcile` exclusively. A wrong value puts the file into an
  unexpected state in the safe-overwrite decision matrix.
- **Confirm before destructive or PR-opening steps.** Every action that opens a PR,
  pushes a branch, or discards local edits goes through `AskUserQuestion` first, even
  if a default was suggested in Phase 2.
- **No auto-advance on errors.** If a `gh pr create` fails or `--reconcile` reports a
  non-zero exit, stop and surface the error — do not silently skip to the next
  divergence.

## Out of scope

- **Running automatically or on a schedule.** Explicitly manual. The mechanical
  `--sync` layer covers the every-commit case; agentic reconciliation is opt-in.
- **Hook scripts and settings files.** Hooks live in `settings.local.json` and are
  rewritten wholesale by the installer; they are not subject to the `_origin` protocol.
  This skill is scoped to `skills/*/SKILL.md` and `agents/*.md` divergences only.
- **Three-way merging non-markdown files.** The `_origin` protocol only applies to
  markdown under `skills/` and `agents/`. JSON configs, supporting `.cjs` scripts, and
  other non-markdown files are copy-no-overwrite by the installer.

## Gotchas

- **Re-running `--sync` may reveal _new_ divergences** between when the user invoked
  this skill and Phase 0. That's fine — the Phase 0 list is authoritative for this run.
- **`--only <skill>` cross-port will skip a diverged target** unless you first resolve
  the divergence. Cross-porting a target-local edit without going through calsuite
  requires `--force-adopt` + patch apply + `--claim`, not `--only`.
- **Upstreamed commits don't auto-reach other targets until calsuite's PR merges AND
  the next `--sync` runs.** The post-commit hook handles the second step; the first
  is on you.
- **`--reconcile` is interactive.** If the user skips it (`[s]`), the file stays
  divergent and re-appears on the next `--sync`. That's the intended escape hatch, not
  a bug.
