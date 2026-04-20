# Changelog

All notable changes to this repository.

Current version: **2.8**

## [2.8] — 2026-04-20

### Added

- **Rust silent-failure lint pack** in `config/lint-configs/agent-rules.json` — 5 patterns (`let _ = .await`, `if let Ok(Some(...`, `.ok()` without `.or`, `debug_assert!`, `.contains("...not active")`) scoped to `**/*.rs`. Fires through the existing `lint-gate.cjs` hook — no runtime changes. Grouped under a `_pack` metadata key as forward-looking scaffolding for future per-language enable/disable; `lint-gate.cjs` currently treats them like any other rule.
- **`/plan` — signal-gated state × event matrix.** Path signals (`session/`, `actor/`, `state_machine/`, `lifecycle/`, `fsm/`) + content signals (`enum *State|Lifecycle|Status`, `impl *Manager`) + explicit `--lifecycle` flag trigger matrix emission in INTERVIEW, BRAINSTORM, and REVIEW outputs. Skipped for CRUD/stateless work.
- **`/review` — format-consistency agent (H).** Parallel agent that greps the full module around each changed file for mixed datetime writers, mixed `ORDER BY` directions, and snake/camel serialization drift. Rust-first; TS/JS/Python/Go/SQL patterns included.
- **`/review` — spec-contract deviation agent (I).** Reads the active `.claude/specs/<slug>/design.md` + `tasks.md`, flags MISSING (spec promises / diff drops) and EXTRA (diff builds / spec silent) deviations.
- **`/review` — versioned-struct checklist pass** (signal-gated on `const *_VERSION` / `version:` fields). Checks deserialize-path version check, degraded fallback, serialize/deserialize symmetry, and `.truncate(cap)` on capped arrays.
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
