# Changelog

All notable changes to this repository.

Current version: **2.25**

## [2.25] — 2026-04-30

### Fixed

- **`scripts/lib/origin-protocol.cjs` + `scripts/configure-claude.js`** — `--sync` no longer rewrites the `_origin: calsuite@<sha>` marker on files whose content is byte-identical to the calsuite source. Closes [#77](https://github.com/ckallum/calsuite/issues/77). Adds a new `'no-op'` action to `decideFileAction`'s return enum, fired when dest content matches both the install-sha content (calsuite-managed) and current calsuite HEAD (no rewrite needed). Sync logs now surface the count as `N unchanged` alongside `written` / `skipped`.

### Why

Every calsuite content change was creating a wave of zero-content drift PRs in target repos: 16 in verity, 23 in timeline, 23 in museli after [#75](https://github.com/ckallum/calsuite/issues/75) merged, all of them single-line `_origin` SHA bumps with no actual content delta. The marker's purpose (knowing which calsuite revision distributed each file, for divergence detection) is preserved — a stale marker still uniquely identifies a real calsuite revision, and the next *real* content change will refresh it.

## [2.24] — 2026-04-30

### Added

- **`skills/humanize/SKILL.md`** — on-demand prose audit skill condensed from [Anbeeld's WRITING.md](https://github.com/Anbeeld/WRITING.md) (MIT). Use for blog posts, external docs, READMEs, long-form PR bodies. Resolves input from a file path, `above`/`last` (most recent assistant message), inline text, or asks. Embeds the full compact ruleset: workflow, medium routing, safety rails, 10 core rules, required checks, watchlist. Explicitly forbids fake-human moves (invented typos, programmed sentence-length wobble, staged messiness) — calibrates stance to genre instead.
- **`skills/humanize/ambient.md`** — drop-in mini ruleset (~155 words) for global `CLAUDE.md` / `AGENTS.md`. Always-on prose guidance scoped to commit messages, PR bodies, READMEs, docs, external copy; explicitly skips terse status updates and one-line comments. Points to `/humanize` for the long-form audit pass.

### Why

Reviewed two AI-writing rulesets the user surfaced: Anbeeld's principled WRITING.md and a checklist-style "Humanizer" skill. Anbeeld won on the always-on layer (no fake-voice injection, calibrated to genre, refuses to break grammar to dodge detection). Split deployment: mini-ruleset embedded as ambient guidance, full audit gated behind an explicit `/humanize` invocation so it doesn't bleed into routine work output.

## [2.23] — 2026-04-28

### Added

- **`skills/zoom-out/SKILL.md`** — new single-purpose skill: agent goes one layer up and produces a callers/collaborators/peers/entry-points map for an unfamiliar area. Reads `CONTEXT.md` if present and uses its vocabulary verbatim. No grilling, no proposing changes — orientation only.
- **`skills/improve-architecture/SKILL.md` + `LANGUAGE.md`** — new periodic codebase-health skill. Surfaces deepening opportunities (shallow modules → deep modules) using the deletion test. Fixed architectural vocabulary (Module / Interface / Implementation / Depth / Seam / Adapter / Leverage / Locality) lives in `LANGUAGE.md` with a "Rejected framings" section. Read-and-decide tool — hands off to `/plan review` → `/execute` for implementation. Writes audit notes to `.context/architecture-audits/YYYY-MM-DD.md`.
- **`skills/plan/SKILL.md`** — `--grill` modifier flag. Switches INTERVIEW/BRAINSTORM/REVIEW questioning into one-question-at-a-time decision-tree-walking mode: always lead with the recommended answer, prefer codebase exploration over asking, challenge user terms against `CONTEXT.md` inline, propose ADRs only for hard-to-reverse / surprising / real-tradeoff decisions.
- **`templates/CONTEXT.md`** — template for the per-repo domain glossary. Lazy-create when the first term is resolved; opinionated single-sentence definitions, `_Avoid_` aliases, relationships, example domain dialogue, flagged ambiguities. Multi-context repos keep `CONTEXT-MAP.md` at root.
- **`templates/adr/0000-template.md`** — template for Architecture Decision Records. Hard rule: only write when **all three** are true (hard to reverse, surprising without context, real trade-off). Filename `NNNN-kebab-title.md`, verb-led titles, immutable once accepted, supersession via new ADRs.
- **`skills/sweep-issues/SKILL.md`** — `.out-of-scope/` durable rejection knowledge base. Step 2 now searches both GitHub issues and `.out-of-scope/<slug>.md` rejection records before creating duplicates. New section explains how to record rejections with format frontmatter (`slug`, `rejected`, `related-issues`) and a "What would change our minds" trigger for re-opening.
- **AFK / HITL labelling** across `/guardian`, `/sweep-issues`, `/execute`. AFK = agent can complete unattended; HITL = needs human-in-the-loop. `/guardian` adopts AFK/HITL as aliases for autonomous/supervised. `/sweep-issues` tags every created issue with one of `afk` / `hitl` labels (auto-creates the labels if missing) and uses them as the routing signal for downstream skills.
- **CONTEXT.md / ADR awareness** wired into `/plan`, `/execute`, `/review`, `/debug`, `/learn`. Each skill now reads `CONTEXT.md` (and `CONTEXT-MAP.md` for multi-context repos) plus relevant `docs/adr/` files before doing its work and uses the glossary vocabulary verbatim. `/learn` distinguishes learnings (small-scale durable facts) from CONTEXT.md updates (domain terms) from ADRs (hard-to-reverse architectural decisions).
- **`skills/skill-builder/SKILL.md`** — Step 6 review checklist: 10 concrete checks (description has triggers, names modes, body length, no time-sensitive info, consistent terminology, concrete examples, references one level deep, gotchas section exists, allowed-tools minimal, no redundant instructions). Step 7 confirmation reports outcome.
- **`skills/debug/SKILL.md`** — Phase 1 reframed as "Build a feedback loop" with the explicit principle that **the loop IS the skill**. Adds the 10-tactic ladder (failing test → curl → CLI → headless browser → trace replay → throwaway harness → fuzz → bisect → differential → HITL script), iterate-the-loop discipline (faster / sharper / more deterministic), non-deterministic bug guidance (raise the rate, don't chase clean repro), and explicit "stop and ask" path when no loop is buildable. Don't proceed to Phase 2 until you have a loop you believe in.
- **`README.md`** — bucketed Skills overview section: Daily code work, Daily workflow, Occasional, Calsuite-internal. Replaces flat skill discovery with usage-frequency triage.

### Why

Adopted patterns from [mattpocock/skills](https://github.com/mattpocock/skills) that fill gaps calsuite had no answer for: vocabulary infrastructure (`CONTEXT.md` + ADRs), pre-implementation grilling (`/plan --grill`), proactive codebase health (`/improve-architecture`), durable rejection memory (`.out-of-scope/`), AFK/HITL labelling, orientation micro-skill (`/zoom-out`), feedback-loop framing in `/debug`, and skill-builder review checklist. Pulled the philosophy stack (domain glossary discipline, deletion test, deepening over abstraction) without adopting his distribution model — calsuite keeps the `_origin` protocol and multi-target sync since those serve different goals.

## [2.22] — 2026-04-25

### Added

- `agents/code-reviewer.md` — **Doc Completeness Checklist** (informational) ported from verity's fork. New Step 6 cross-checks newly added files and architectural changes against project CLAUDE.md files at relevant layers (root + per-package in monorepos). Flags new public modules without CLAUDE.md updates, architectural changes without diagrams, new patterns without review-checklist rules, new env vars without doc updates, new specs under `.claude/specs/`. Step 1 adds `git diff --cached --name-only --diff-filter=A` to surface newly added files; Step 2 retains discovered CLAUDE.md paths for cross-reference. Findings are always `info` severity — surface in PASS Notes or as trailing `[info]` entries under BLOCKED, never block on their own. All existing PASS/BLOCKED verdict machinery, review-stamp write, severity tiers, and generic checklist preserved.

### Why

The Doc Completeness pattern is a generic insight from verity: layered CLAUDE.mds (root + workspace-specific) drift out of sync with code changes without a deliberate prompt during review. Surfacing this as a non-blocking check nudges the reviewer to notice missed doc updates without gating the commit on stylistic judgment. Fully generic — verity's specific CLAUDE.md paths, helper names, and ID formats excluded.

## [2.21] — 2026-04-24

### Added

- `skills/execute/SKILL.md` — **`--multi` tmux mode** ported from verity. `/execute --multi issue:1,2,3` or `/execute --multi spec:foo,bar` spawns one Claude Code instance per task in separate tmux panes via `tmux split-window` + `tiled` layout. Each pane runs its own task independently, allowing parallel execution across multiple issues or specs. Pre-flights tmux availability before spawning; rejects raw prompts (no identifier to split on). Frontmatter `argument-hint` + description updated; invocation block adds two new examples. Existing SPEC/RAW/ISSUE mode structure preserved byte-identical. Version bump `2.0.0 → 2.1.0`.

### Why

Verity derived this pattern from day-to-day "work 3 independent issues in parallel" needs. It's fully generic — no verity-specific content in the multi-mode mechanics — and adds a natural parallel-execution path to calsuite's existing single-task flow. User explicitly invokes `--multi`, so this is a directed parallel pattern, not an autonomous loop.

## [2.20] — 2026-04-24

### Added

- `skills/review/SKILL.md` — bundled generic feature upgrades ported from verity's fork. **Step 0: `--multi` tmux mode** — `/review pr 123,124,125 --multi` spawns one Claude Code instance per PR in separate tmux panes (`tmux split-window` + `tiled` layout) for parallel review without context pollution. **Step 7: PR comment posting** — in PR mode, consolidate all findings plus the Step 5.5 flow diagram into a single `gh pr comment <num> --body` call instead of iterating with AskUserQuestion. Local mode keeps the interactive loop. **Explicit signal-gating** — replace prose "only dispatch Agent X if..." with a scripted block that computes `F_COUNT`/`G_COUNT`/`H_COUNT`/`SPEC_DIR`/`VERSIONED_STRUCT` from a cached `$DIFF_FILE` via `grep -c`; each conditional agent explicitly checks its counter and skips when 0. **Step 6: hash-both-diffs review stamp** — sha256 now covers `git diff origin/main` + `git diff` concatenated, catching unstaged drift that previously masked stale stamps. **Node snippet safety** — review stamp uses `execFileSync('git', [...], ...)` with explicit argv instead of shell-interpolated `execSync`. Version bump `3.0.x → 3.1.0`.

### Why

These five upgrades are generic infrastructure improvements that verity derived from live usage. Without them, calsuite's review skill runs conditional agents based on prose heuristics (hard to debug when something doesn't fire), loses review-stamp fidelity when unstaged edits drift, and can't parallel-review multiple PRs without the user manually spawning instances. All five are fully generic — verity-specific agent prompts and critical-check lists were intentionally stripped.

## [2.19] — 2026-04-23

### Changed

- `skills/retro/SKILL.md` — telemetry framing upgrades ported from verity. Step 13 now explicitly labels skill-usage telemetry as "an additive signal, not a dependency" (clarifies that missing telemetry is not a bug). Step 14 "Learning Loop" header renamed to "Learning Loop (opt-in)" so the opt-in nature is discoverable from the outline. Step 1 fetch+RETRO_AUTHOR resolution collapsed into one block with an added note about `config.json` overriding `git config user.email`. Version bump `1.0.0 → 1.1.0`.

### Why

Verity's retro fork made the optional telemetry framing explicit after users repeatedly treated missing telemetry as a broken-skill signal. Same clarifications make sense upstream: telemetry is best-effort observability, not a hard dependency, and that should be readable from the skill source without having to trace through the code paths.

## [2.18] — 2026-04-23

### Added

- Per-target `workspaces: "skip"` option in `config/targets.json`. When set, `--sync`, `--only`, and direct `node configure-claude.js <target>` invocations install the harness only at the monorepo root — workspace subdirs (`backend/`, `frontend/`) are left alone. Default remains `"full"` (every workspace gets a mirrored `.claude/`), so existing target configs are unaffected. Documented in `config/targets.example.json`.
- `--prune-stale` Category D — sweeps orphan workspace `.claude/` dirs on targets opted into `workspaces: "skip"`. Single-target and all-targets modes both consult `targets.json` for the `workspaces` field. Dry-run by default; `--yes` prompts per-dir like Category C (irreversible recursive delete, TTY required).

### Why

Claude Code uses the nearest `.claude/` walking up from cwd, so a monorepo root `.claude/` already covers commands run from `backend/` or `frontend/`. The workspace mirror was distributing a second copy of every skill, agent, and permissions block — drift was guaranteed and the duplicates added nothing. Before this flag, removing workspace harness content in a target repo (e.g., [verity#463](https://github.com/verityaml/verity/pull/463)) didn't stick — the next calsuite commit's post-commit `--sync` regenerated the files via `write-new` (skills with no destination file are always written fresh; the `_origin` safe-overwrite protocol can't short-circuit a missing file). `workspaces: "skip"` stops the installer iterating workspaces at all, so deletions stay deleted.

Category D closes the loop: opting a target into `workspaces: "skip"` doesn't delete the pre-existing workspace dirs, but `--prune-stale` now surfaces them as orphan calsuite state and prompts to remove them interactively. No `--yes` bulk delete — recursive directory removal always prompts.

## [2.17] — 2026-04-22

### Added

- `skills/review/checklist.md` — 10 generic defensive rules ported from verity's review gate, genericized (no project-specific helpers, table lists, or file paths). New CRITICAL bullets in SQL & Data Safety (LIKE metacharacter injection), Race Conditions & Concurrency (stale in-memory state after DB write), Auth & Security Boundaries (querySelector/querySelectorAll DOM injection). New CRITICAL category **React Lifecycle & Cleanup** (setTimeout/setInterval cleanup, polling `document.hidden` check, `useSearchParams()` + `<Suspense>`). New INFORMATIONAL categories: **React 19 State Patterns** (derive-during-render-must-sync, `useEffect(() => setX(...), [prop])` forbidden), **React Async Patterns** (async polling, error vs empty state, feature-flag inference from API failure, external-URL host whitelist, server-component self-fetch), **Aggregation Source Consistency** (totals from different sources, sentinel values treated as data), **Sibling Helper Drift** (two wrappers around the same upstream library must agree on error handling), **Test Mock Staleness** (`vi.mock()`/`jest.mock()` drift when imports change). Two new Error Handling bullets (empty `catch {}` blocks, redirect-on-error without logging). Gate Classification tree updated.

### Changed

- `README.md` refreshed to document the full sync/reconcile toolchain in one place. Adds `targets.json` setup to **Getting started**; replaces the thin "when a sync flags divergence" block with a proper **Syncing and reconciling** section covering `/sync`, `/sync-preview`, `/reconcile`, `/reconcile-targets`, `/customise`, `--force-adopt`, `--claim`, and `--prune-stale` with intent-based routing tables; new **Internal vs distributed skills** subsection explains the `INTERNAL_SKILLS` / `profiles.json` split from v2.16. Removes the stale `(issue #42, planned)` marker on `--reconcile` — it shipped in v2.8.

### Why

The reconcile/sync toolchain shipped across v2.8–v2.16 (8 versions, 6 PRs) without a cross-cutting narrative in the top-level README. The README was both outdated (`--reconcile planned`) and underdocumented — any skill shipped after v2.7 was invisible to a new reader. This refresh makes the README the single landing point for both *what* exists and *when to use what*.

Verity's review checklist has accumulated 10+ hard-won defensive patterns from real PR incidents that are fully generic — they apply to any React/Next.js project, any ORM with raw predicates, any codebase with DB mutations and in-memory derivation. Upstreaming them to calsuite makes them available to every target without each project having to re-derive them from its own incidents. Verity-specific content (orgId filters, helper names, specific file paths, PR numbers) intentionally excluded.

## [2.16] — 2026-04-22

### Changed

- Added `reconcile-targets` to the `INTERNAL_SKILLS` allowlist in `scripts/configure-claude.js`. v2.11 shipped the skill but forgot to mark it internal, so the last syncs distributed a broken skill to every target (a target invoking `/reconcile-targets` would fail at phase 0 — no `config/targets.json` to walk).
- Removed all six internal skills (`configure-claude`, `skill-builder`, `sync`, `sync-preview`, `reconcile`, `reconcile-targets`) from `config/profiles.json` `base.skills` and `monorepo-root.skills`. They were dead data there — filtered via `INTERNAL_SKILLS` at install time — but v2.14 described that as "listed for completeness". The completeness framing invited the exact confusion that made this PR necessary: "is this skill getting distributed or not?" was answerable only by reading the installer. Now the two lists are disjoint: `profiles.json` is the opt-in distribution roster, `INTERNAL_SKILLS` is the calsuite-only marker.

### Why

Every hub-level skill added to calsuite (installer wrappers, cross-target orchestrators) needs the same two edits: append to `INTERNAL_SKILLS`, append to `profiles.json`. Forgetting either one is invisible at commit time and surfaces as either (a) a broken skill in every downstream repo or (b) dead data in the config. Making the lists non-overlapping removes half the footgun and makes the remaining rule — "if internal, add ONLY to `INTERNAL_SKILLS`" — trivially enforceable.

### Manual target cleanup

Existing target repos still carry `<target>/.claude/skills/reconcile-targets/` on disk from the v2.11 sync. The installer no longer touches it — remove manually when convenient:

```bash
rm -rf ~/Projects/{verity,timeline,museli}/.claude/skills/reconcile-targets
```

## [2.15] — 2026-04-22

### Added

- `/reconcile [<path>]` calsuite-internal skill — thin wrapper around `configure-claude.js --reconcile <path>` for single-file three-way merges. Adds pre-flight (calsuite reachable, `$EDITOR` set, path validity), peeks at `_origin` to warn about 2-way-fallback / already-pristine / claimed-elsewhere cases before invoking the installer, and interprets the installer's exit state (merged / kept / adopted / skipped / editor-aborted / markers-left) in plain English. Interactive picker mode when invoked without a path: runs `sync-preview --json`, lists every skip-diverged + skip-unknown file across targets, and prompts the user to pick one via `AskUserQuestion`. Added to `INTERNAL_SKILLS` so it's filtered at install time — calsuite-only, like `/sync` and `/sync-preview`.

### Why

The single-file reconciliation path was the last gap in the skill palette. `/sync` surfaces divergence but points at raw installer commands; `/reconcile-targets` covers bulk agentic handling; `/customise` covers edit-and-claim; `--force-adopt` and `--claim` are one-liners worth keeping direct. `/reconcile` fills the remaining "one specific file, want to merge not discard" slot — where the 3-way merge UI actually matters and the pre-flight / post-run interpretation earn their keep.

## [2.14] — 2026-04-21

### Added

- `scripts/sync-preview.cjs` — read-only preview of what `configure-claude.js --sync` would do across every target in `config/targets.json`. Walks each target's installed `.claude/skills` + `.claude/agents` markdown, calls `decideFileAction` per file, aggregates into `write-new` / `write-update` / `migrate` / `skip-diverged` / `skip-unknown` / `skip-claimed` buckets with per-target and grand-total counts. Supports `--target <name>` to scope and `--json` for machine-readable output. Writes nothing — safe any time.
- `/sync-preview` calsuite-internal skill — wraps the script, interprets the output (e.g. 28 skip-unknowns → suggest `/reconcile-targets`; 3 skip-diverged on one target → suggest per-file `--reconcile` commands). Never distributed to targets.
- `/sync` calsuite-internal skill — wraps `configure-claude.js --sync` with pre-flight, interpretation of the divergence summary, and proactive suggestions (picks the smallest-viable follow-up: direct commands for 1–3 files, `/reconcile-targets` for 4+). Supports `/sync preview` which delegates to `/sync-preview` for dry-run.
- `sync` and `sync-preview` added to `INTERNAL_SKILLS` in `configure-claude.js` so they're listed in the `base`/`monorepo-root` profiles for completeness but filtered out at install time — the skills only make sense inside the calsuite repo itself.

### Why

Previously, the manual-sync workflow required remembering to type `node scripts/configure-claude.js --sync` and interpreting raw output. The two new skills collapse that into a command-palette interaction plus inline interpretation of what's next. `/sync-preview` in particular turns the "what's the current divergence state" question into a one-line command that produces a readable report — useful before kicking off the heavier `/reconcile-targets` agentic pass.

## [2.13] — 2026-04-21

### Changed

- `config/targets.json` is now **gitignored and untracked**. Each user maintains their own local target list. A committed `config/targets.example.json` ships as the template — copy it to `config/targets.json` to populate. Removes the personal-info leak where target repo names (previously checked in) were visible in the public repo. Existing forks keep their in-history copies; to scrub history, rewrite with `git filter-repo` separately.
- Installer error messages for `--sync` and `--prune-stale` now distinguish "file missing" from "file empty" and point users to the example file.

### Why

`targets.json` was the only personally-identifying thing in the tracked tree — a list of the user's side projects. Nothing secret, but nothing anyone else needs either. Moving to an example-plus-local split mirrors how every other user-specific file in the repo works (`~/.mcp.json`, `settings.local.json`, etc.) and removes a small ongoing leak with each new entry.

## [2.12] — 2026-04-21

### Added

- `configure-claude.js --prune-stale [path]` — opt-in cleanup of orphaned calsuite state from prior distribution models. Three categories: **[A]** parent-level symlinks under `~/Projects/.claude/{skills,agents}` that point into calsuite (no longer discovered by Claude Code post-refactor); **[B]** mixed `<target>/.claude/scripts/{hooks,lib}` dirs where calsuite symlinks coexist with user files (the existing `--sync` pure-symlink-dir auto-cleanup skips mixed dirs); **[C]** skill/agent markdown files with no `_origin` that diverge from calsuite's current (row 6 of the safe-overwrite matrix — `decideFileAction → skip-unknown`). Without a path, iterates every target in `config/targets.json`; with a path, scopes to that single target and skips the global category A sweep. Dry-run by default — pass `--yes` to apply. Categories A & B remove automatically under `--yes`; category C always prompts per-file because deleting a potentially-edited file is irreversible. Non-TTY + `--yes` + category C candidates errors out rather than silently skipping or deleting. Respects user-added files by only considering category C candidates whose basename matches a calsuite source (cleaner signal than parsing `.gitignore`). Closes [#41](https://github.com/ckallum/calsuite/issues/41).

### Why

The v2.6 personal-harness-refactor intentionally left orphaned state on disk — deleting across five target repos is a footgun that belongs to the user, not the installer. `--prune-stale` is the clean way to reconcile that orphan state when the user is ready. Complements the certain-safe pure-symlink-dir cleanup that `--sync` already performs automatically.

## [2.11] — 2026-04-21

### Added

- `/reconcile-targets` skill — second-layer agentic reconciliation on top of the mechanical `_origin` `--sync` protocol. Runs `configure-claude.js --sync` to enumerate divergent skill/agent files across every target in `config/targets.json`, pulls target-side local history and calsuite-side changes since each file's install sha, dispatches a read-only agent to summarise why each side diverged, then routes the user through five per-file decisions: upstream-to-calsuite (port the target's edit back), cross-port (apply to other targets too), keep-target-local (invokes `--claim`), adopt-calsuite (invokes `--force-adopt --yes`), or three-way-merge (hands off to interactive `--reconcile`). Opens PRs only with explicit confirmation; never force-pushes, never stamps `_origin` by hand. Explicitly manual — not wired into the post-commit hook. Scoped to markdown divergences under `skills/` and `agents/`; hooks and settings are out of scope. Added to `base` and `monorepo-root` profiles. Closes [#40](https://github.com/ckallum/calsuite/issues/40).

### Why

v2.6's mechanical sync is cheap and deterministic but binary — `skip-diverged` files either stay stuck or get resolved by blunt `--force-adopt` / `--claim` flags that discard one side. v2.8's `--reconcile` added a three-way merge primitive for the single-file case. `/reconcile-targets` composes both into the cross-target catch-up workflow the personal-harness design doc called out as future work: when verity's `/ship` has a custom Lambda step and calsuite's `/ship` gained a new Development Flow section, both should coexist — and the decision of which side to prefer, per file, needs an LLM in the loop. Fires only when the user invokes it, so the token cost stays bounded to actual divergences.

## [2.10] — 2026-04-21

### Added

- **Rust silent-failure lint pack** in `config/lint-configs/agent-rules.json` — 5 patterns (`let _ = .await`, `if let Ok(Some(...`, `.ok()` on a non-chained/non-`?` result, `debug_assert!`, `.contains("...not active")`) scoped to `**/*.rs` via the `files` glob. Fires through the existing `lint-gate.cjs` hook — no runtime changes. Adding a pack for another language is just more rule entries with a different `files` glob.
- **`/plan` — signal-gated state × event matrix.** Path signals (`session/`, `actor/`, `state_machine/`, `lifecycle/`, `fsm/`) + content signals (`enum *State|Lifecycle|Status`, `impl *Manager`) + explicit `--lifecycle` flag trigger matrix emission in INTERVIEW, BRAINSTORM, and REVIEW outputs. Skipped for CRUD/stateless work.
- **`/review` — format-consistency agent (H).** Parallel agent that greps the full module around each changed file for mixed datetime writers, mixed `ORDER BY` directions, and snake/camel serialization drift. Rust-first; TS/JS/Python/Go/SQL patterns included.
- **`/review` — spec-contract deviation agent (I).** Reads the active `.claude/specs/<slug>/design.md` + `tasks.md`, flags MISSING (spec promises / diff drops) and EXTRA (diff builds / spec silent) deviations.
- **`/review` — versioned-struct checklist pass** (signal-gated on `const *_VERSION` / `version:` fields). Checks deserialize-path version check, degraded fallback, serialize/deserialize symmetry, and `.truncate(cap)` on capped arrays.
- **`/ship` — Step 7.2 Sweep and Fix Inline** — ported from the pre-existing `.claude/skills/ship/SKILL.md` divergence (commit `4454110`) back to canonical source. Triages deferred items into "fix now" (coherent with this PR) vs "defer" before PR creation; Step 9 now consumes the `DEFERRED_ITEMS` handoff instead of rescanning.
- **`/ship` — Pre-PR Gates (Step 7.4):**
  1. PR-size warning when `> 400` lines added — cites dominant files, does not block.
  2. Test-presence gate — universal multi-language heuristic (Rust/TS/JS/Py/Go/Ruby test function counting) warning when `code_additions > 50 && new_tests == 0`. Optional strict mode via `.claude/ship-config.json` `criticalPaths` glob list; `strict: true` upgrades warning to block.
  3. Spec-contract deviation — same detection as `/review` Agent I, with AskUserQuestion remediate-or-addendum flow. Option B mutates `design.md`/`tasks.md` with strikethrough + dated addendum.
- **`/ship` — PR-claim-vs-diff grep (Step 8.5).** Extracts backticked symbol claims from the drafted PR body; flags any that `grep -F` can't find in the diff.

### Why

PR `ckallum/museli#173` needed 3 review rounds and ~29 findings before landing. The retrospective bucketed those findings into 6 root causes: silent failures (6 bugs), cross-file invariant drift (4), lifecycle/restart gaps (5), promised-but-not-persisted state (3), defensive-programming gaps (3), and missing tests (systemic). This release encodes deterministic catches for each: lint rules for silent failures, format-consistency agent for drift, state matrix for lifecycle, PR-claim grep for promised-state, versioned-struct pass for defensive gaps, test-presence gate for coverage. Signal-gated passes only fire when the codebase matches — zero overhead on unrelated work.

### How to apply

- Rust lint rules auto-fire on `git commit` in any repo with the shared config (target repos inherit via calsuite installer).
- `/plan` matrix triggers on the signals automatically; use `/plan review <slug> --lifecycle` to force it.
- `/review` runs H + I + versioned-struct whenever signals match; all conditional — no overhead otherwise.
- `/ship` gates always run, but only surface findings when they fire. Add `.claude/ship-config.json` per-repo for strict test-presence on critical paths.

## [2.9] — 2026-04-20

### Fixed

- `configure-claude.js --force-adopt` and `--claim` no longer reject paths inside nested `.claude/` directories (e.g. calsuite's own git worktrees at `calsuite/.claude/worktrees/<id>/.claude/skills/…`). `destToCalsuiteRel()` and `deriveTargetName()` now anchor on the innermost `.claude/` via `lastIndexOf` instead of the outermost via `indexOf`. Both helpers moved to a new `scripts/lib/path-helpers.cjs` with inline unit tests covering the flat and nested-worktree cases.

### Why

Running `/customise` or `--force-adopt <path>` from inside a calsuite worktree resolved the `.claude/` boundary against the outer `calsuite/.claude/`, so the first path segment became `worktrees` instead of `skills` or `agents` — the installer rejected every path as "not under a target's .claude/skills or .claude/agents". With the innermost-boundary fix, worktree-authored edits can be adopted/claimed through the normal divergence-resolution flow.

## [2.8] — 2026-04-20

### Added

- `configure-claude.js --reconcile <path>` — interactive three-way merge helper for divergent skill/agent files. Shows three panes (calsuite current, calsuite at install sha, target current), then offers: [k] keep target's version (stamps `_origin: <target-name>`, same effect as `--claim`), [a] adopt calsuite's current (same as `--force-adopt`), [m] three-way merge in `$EDITOR` with git-style conflict markers (including `|||||||` ancestor block when the install sha is available), or [s] skip. On [m], the resolved file is stamped with a fresh `_origin: calsuite@<current-sha>`; leftover conflict markers or a non-zero editor exit abort the operation with the original file untouched. Requires a TTY. Closes [#42](https://github.com/ckallum/calsuite/issues/42).

### Why

The v2.6 refactor made `--force-adopt` and `--claim` the two escape hatches for the mechanical sync protocol — they cover the "take calsuite's" and "keep mine" ends of the spectrum. `--reconcile` closes the middle case: the user wants _both_ sides — calsuite's upstream changes merged on top of their local edits — which the blunt flags can't express without data loss. Feeds the planned `/reconcile-targets` agentic layer ([#40](https://github.com/ckallum/calsuite/issues/40)).

## [2.7] — 2026-04-19

### Added

- `/customise <skill-name> [instructions]` skill — fuses "edit a calsuite skill" and "claim it locally" into one atomic action. Invoked from any target repo; applies edits (via an implementer agent if instructions are given, otherwise interactively), then calls `configure-claude.js --claim` so the next `--sync` skips the file. Prevents the footgun of editing a skill and forgetting to claim, which would have logged the file as divergent on every future sync.
- `customise` added to the `base` and `monorepo-root` profile skill lists so every target picks it up.

### Why

The v2.6 protocol introduced `--claim` as the way to diverge a skill locally without losing edits to `--sync`. In practice, users edit first and claim later (or forget). `/customise` makes the intent explicit and claims automatically. Overlaps with but doesn't replace the planned interactive `--reconcile` helper ([#42](https://github.com/ckallum/calsuite/issues/42)) — that one merges calsuite's updates with local edits; `/customise` deliberately breaks that propagation.

## [2.6] — 2026-04-19

### Breaking / migration notes

Calsuite no longer writes per-machine paths into a target's committed
`.claude/settings.json`, and no longer clobbers local skill/agent edits on
re-sync. See [specs/personal-harness-refactor/design.md](./specs/personal-harness-refactor/design.md) for the full rationale.

**First `--sync` after upgrading will behave differently:**

- Calsuite hook wiring (previously merged into `.claude/settings.json`) now
  lives in `.claude/settings.local.json` (gitignored). Any legacy
  `_origin=calsuite` hook entries already in `settings.json` are stripped
  on first sync. Project-specific hook entries (no `_origin` tag) are
  preserved.
- `.claude/scripts/hooks/` and `.claude/scripts/lib/` that previously held
  symlinks into calsuite are auto-removed if every entry is still a
  calsuite-pointing symlink. User-added scripts or foreign symlinks
  short-circuit the cleanup.
- `.gitignore` gets a `.claude/settings.local.json` line added (root and
  every detected monorepo workspace) if not already present.
- Every distributed skill/agent `.md` file gets an `_origin: calsuite@<sha>`
  frontmatter marker. Existing pristine copies (byte-identical to calsuite's
  current version) auto-migrate silently. Locally-edited copies are skipped
  and flagged — resolve with `--force-adopt <path>` (take calsuite's),
  `--claim <path>` (keep local, mark user-owned), or wait for
  `--reconcile <path>` ([issue #42](https://github.com/ckallum/calsuite/issues/42)).

Expected first-sync output for a target with local edits:

```
  ✓ Removed stale pre-refactor scripts/hooks, scripts/lib dir(s)
  ✓ Added .claude/settings.local.json to .gitignore
  ✓ Skills: 24 written, 2 skipped
  ✓ Wrote 19 calsuite hook(s) to settings.local.json (preserved 3 project hook(s))
  ✓ Removed 19 legacy calsuite hook(s) from settings.json

  ─────────────────────────────────────────────────
  2 file(s) skipped pending reconciliation:
    • <target>/.claude/skills/ship/SKILL.md
      skip-diverged: user-modified since a49a827
    ...
  Resolve with: --force-adopt / --claim / --reconcile
  ─────────────────────────────────────────────────
```

### Added

- `scripts/lib/origin-protocol.cjs` — safe-overwrite utilities: `parseFrontmatter`, `readOrigin`, `stampOrigin`, `normalizeForCompare`, `contentAtSha` (via `git show`), `currentCalsuiteSha`, `decideFileAction` (the full matrix from the design doc).
- `--force-adopt <path>` flag — overwrite a target skill/agent file with calsuite's current version, stamping fresh `_origin`.
- `--claim <path>` flag — mark a target skill/agent file as user-owned (`_origin: <target-name>`), preserved across future syncs.
- End-of-sync divergence summary — lists every `skip-diverged` and `skip-unknown` file plus the three resolution commands.
- `resolveCalsuiteDir()` — `$CALSUITE_DIR` env var → `~/Projects/calsuite` → installer-relative fallback.
- `substituteCalsuiteDir()` — pre-resolves the `${CALSUITE_DIR}` placeholder in `hooks/hooks.json` to a literal absolute path before writing.
- Auto `.gitignore` management — adds `.claude/settings.local.json` to target root and each detected monorepo workspace.
- Auto-cleanup of pre-refactor `.claude/scripts/{hooks,lib}/` dirs when every entry is still a calsuite-pointing symlink.
- Design spec at `specs/personal-harness-refactor/design.md` documenting the whole model, decisions, and risk matrix.

### Changed

- Hook wiring migrated from `.claude/settings.json` (team-shared, committed) to `.claude/settings.local.json` (per-user, gitignored). Calsuite writes literal absolute `$CALSUITE_DIR/...` paths there; the Claude Code hook runner doesn't shell-expand command strings, so paths have to be pre-resolved but not committed.
- Skill/agent distribution moved from unconditional `copyDirSync` / `copyFileSync` to the `_origin` safe-overwrite protocol (see origin-protocol module).
- `hooks/hooks.json` placeholder renamed from `${CLAUDE_CONFIG_DIR}` to `${CALSUITE_DIR}` to match the actual semantic (18 occurrences).
- `settings.json` now only carries `enabledPlugins` and `permissions` — both portable across machines.

### Fixed

- `--only <skill>` mode (`installOnly`) now routes through the `_origin` safe-overwrite protocol. Previously it used `copyDirSync` / `copyFileSync` directly, bypassing the whole point of the refactor — an explicit `--only review` would silently clobber local edits.
- `currentCalsuiteSha` throws on git failure instead of returning the sentinel string `'unknown'`. The old fallback would have stamped every file with `_origin: calsuite@unknown`, permanently breaking future `contentAtSha` lookups.
- `contentAtSha` distinguishes benign "path not in git at that sha" from infra failures (git not installed, shallow-clone pruning, corrupt repo). Only the former returns null; anything else throws with a clear message.
- `readJsonSync` throws on `SyntaxError` (malformed JSON) instead of silently returning null. The `|| {}` idiom at callsites would otherwise rebuild broken `settings.json` from scratch, wiping user hooks/plugins/permissions silently. ENOENT still returns null (benign).
- `--force-adopt` prompts for confirmation before overwriting; `--yes` / `-y` flag skips the prompt for non-interactive use. Aligns with the design spec's explicit "one-line confirmation prompt; `--yes` to skip" requirement.
- `stampOrigin` uses a function replacer instead of a string replacement — defends against `$` sequences in `originValue` (e.g. target basenames in unusual directories).
- `skip-exists` counter separated from `skip-claimed` so log lines don't mislabel non-markdown-file no-overwrites as "user-claimed".
- `guardian-rules.json` and `agent-rules.json` are now copy-no-overwrite (per design spec S4 row). Previously they were unconditionally overwritten on every install, clobbering any local tuning.
- Top-level `try/catch` in `main()` prints clean error messages for thrown exceptions (no Node stack traces for user-facing failures).

### Removed

- `syncParentAssets()` and `PARENT_CLAUDE_DIR` — they created symlinks at `~/Projects/.claude/` under the assumption that Claude Code inherits skills from parent-directory `.claude/` dirs. Per the [official docs](https://code.claude.com/docs/en/skills), only enterprise/personal/project/plugin levels are discovered — parent-dir inheritance is not a supported feature.
- `resolveHookPaths()` — pre-resolving `${CLAUDE_CONFIG_DIR}` into an absolute path inside `settings.json` was exactly the bug that broke collaborators' checkouts.
- `symlinkDirSync` and `symlinkOrSkip` helpers — no longer referenced (scripts no longer symlinked into targets).
- `--copy` flag — removed entirely. Its only effect was toggling script symlink-vs-copy, and scripts are no longer copied into targets at all. Now errors with "Unknown flag" instead of silently no-opping.

## [2.5] — 2026-04-19

### Added
- `scripts/lib/pr-body-parser.cjs` — utility for splitting/reassembling PR bodies on level-2 (`##`) headers. Used by `/receiving-pr-feedback` to regenerate dynamic sections across feedback rounds.
- `/receiving-pr-feedback` Step 4.5 — update PR description after fixes land. Regenerates Summary / Important Files / Test Results / Development Flow, preserves static sections (How It Works / Pre-Landing Review / Doc Completeness), and appends a Revision History entry per round.
- `/ship` Step 7.5 — generate a Mermaid `flowchart TD` Development Flow diagram from `.claude/flow-trace-${CLAUDE_SESSION_ID}.jsonl` (same rules as `/flow`). Skipped silently when no trace exists.
- `/review` checklist — three additional checks: lifecycle state-variable resets on deactivation, completeness grep for mechanical "all X converted" refactors, and tests for changed return types or error contracts.

### Changed
- `skills/ship/pr-template.md` — documented as the shared template for `/ship`, `/execute`, `/receiving-pr-feedback`, and parallel agents. Adds a `## Revision History` placeholder (omitted on initial PR, appended by `/receiving-pr-feedback`) and tightens the Development Flow copy.
- `/ship` Step 8 — inserts `## Development Flow` between How It Works and Important Files when trace data exists.

## [2.4] — 2026-04-16

### Added
- `--sync` flag — re-runs installer against all repos listed in `config/targets.json`
- `--copy` flag — falls back to file copying instead of symlinks (for portability)
- `config/targets.json` — manifest of target repos for `--sync`
- Git post-commit hook — auto-syncs to targets when hooks/skills/agents/scripts/config change
- `syncParentAssets()` — symlinks shared skills and agents into `~/Projects/.claude/` for hierarchy-based inheritance
- `mergeHooks()` — origin-aware hook merge that preserves project-specific hooks across re-installs

### Changed
- Hook scripts now symlinked instead of copied — changes in calsuite propagate instantly
- Lib scripts now symlinked instead of copied
- `hooks.json` entries tagged with `"_origin": "calsuite"` to enable merge-aware installs
- `installForProfile()` accepts `opts.copy` to control symlink vs copy behavior

## [2.3] — 2026-04-15

### Added
- `/learn` skill — manage cross-session learnings (patterns, pitfalls, preferences). Review, search, prune, export. Stored at `.context/learnings/` per project.
- CLAUDE.md "Routing" section — intent → file pointer table so sessions don't re-read the whole file.
- CLAUDE.md "Codify on repeat" rule — propose a skill the second time a request shape repeats.
- `/retro` Step 14 — reads `~/.claude/analytics/skill-usage.jsonl` and surfaces skills used heavily / abandoned / never used.
- `/retro` Step 15 — learning loop: for each "Improve" item, propose a concrete rule update to the responsible skill file.

### Changed
- CLAUDE.md slimmed to a routing document; full changelog moved here.

## [2.2]

Flow trace and ship sweep-fix: `flow-trace.cjs` PreToolUse hook captures Skill/Agent invocations to per-session JSONL, `/flow` skill generates Mermaid workflow diagrams, `/ship` embeds Development Flow in PR body, `/ship` Step 8 now triages swept issues and fixes minor items inline before PR creation.

## [2.1]

Lint-directed agents: ESLint config auto-install, `agent-rules.json` structural lint rules, `lint-gate.js` pre-commit hook, `eslint-check.js` post-edit hook, `/lint-rule-gen` skill, Guardian architectural boundary rules (cross-layer imports, test colocation, file placement).

## [2.0]

Consolidated skills: `/plan` (interview + brainstorm + review), `/plan-ceo` (founder-mode plan review), `/ship` (automated test + review + PR pipeline), `/retro` (weekly engineering retrospective with trend tracking).

## [1.9]

Pre-commit review gate: `review-gate.js` hook + `@code-reviewer` agent for convention-aware code reviews before commits.

## [1.8]

Guardian autonomous approval system: smart PreToolUse hook with configurable deny/warn rules, audit logging, and mode-based permissions.

## [1.7]

Context7 MCP server and `/context7` skill for current library documentation lookup.

## [1.6]

`@browser` agent (agent-browser CLI), Excalidraw MCP integration for `@doc-updater` diagrams, MCP auto-installation in configure script, monorepo workspace plugin check fix.

## [1.5]

Mono-repo support + spec-driven development: profile-based installer (`config/profiles.json`), spec/doc templates, `@context-loader` and `@doc-updater` agents, `/update-docs` skill, spec-aware session hooks.

## [1.4]

Added marketplace checks to `configure-claude.js`; manifest now includes `marketplaces` array.

## [1.3]

Added `configure-claude.js` installer script, `config/global-settings.json` manifest; skill now invokes the script directly.

## [1.2]

Added `configure-claude` skill: installs hooks and scripts into any project's `.claude/` directory.

## [1.1]

Added hooks system: hooks.json config, 6 hook scripts (session lifecycle, console.log checks, compact suggestions), lib utilities (utils, package-manager, session-aliases, session-manager).

## [1.0]

Initial setup: repo structure, CLAUDE.md, README.md.
