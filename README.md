# calsuite

Personal Claude Code configuration — hooks, commands, scripts, plugins, skills, and agents.

**Version: 2.23**

## Getting started

Clone this repo. By default, place it at `~/Projects/calsuite`; if you keep it elsewhere, export `CALSUITE_DIR=/your/path` in your shell profile before running the installer.

```bash
node scripts/configure-claude.js /path/to/target-repo
```

For multi-target workflows (`--sync`, `/sync`, `/reconcile-targets`), copy `config/targets.example.json` to `config/targets.json` and list your target repos:

```json
{ "targets": [{ "path": "~/Projects/my-repo" }] }
```

`targets.json` is gitignored — each user maintains their own list.

Repo layout:

```
hooks/       # Shell commands triggered by Claude Code events
commands/    # Custom slash commands
scripts/     # configure-claude installer, scripts/hooks/*.cjs, scripts/lib/*.cjs
config/      # global-settings.json (manifest), profiles.json, targets.example.json (copy to targets.json; gitignored)
plugins/     # Claude Code plugins
skills/      # Markdown skills (invoked as /skill-name)
agents/      # Agent definitions (invoked as @agent-name)
templates/   # Spec, doc, and changelog templates (for target projects)
specs/       # Calsuite's own spec docs
```

## Distribution model

Calsuite is a personal harness. The installer keeps **machine-specific state out of the target's tracked files** and **respects your local edits** across resyncs.

```mermaid
flowchart LR
    subgraph SRC["calsuite/ (source of truth)"]
        direction TB
        S1["scripts/hooks/*.cjs<br/>scripts/lib/*.cjs"]
        S2["hooks/hooks.json<br/>(template, ${CALSUITE_DIR})"]
        S3["skills/*/*.md<br/>agents/*.md"]
        S4["config/*.json<br/>config/lint-configs/*<br/>templates/specs/"]
    end

    subgraph TGT_LOCAL["target/.claude/settings.local.json (gitignored)"]
        L1["Hook wiring<br/>literal absolute paths"]
    end

    subgraph TGT_SHARED["target/.claude/* (committed)"]
        T1["skills/<name>/*.md<br/>agents/*.md<br/>(with _origin: calsuite@<sha>)"]
        T2["config/*.json<br/>.eslintrc.json<br/>specs/<br/>(copied, no-overwrite)"]
        T3["settings.json<br/>(plugins + permissions only)"]
    end

    subgraph HOOKS["Claude Code hook runner"]
        H1["reads command string literally<br/>(no shell expansion)"]
    end

    S1 -.->|referenced at runtime| H1
    S2 -->|installer resolves ${CALSUITE_DIR}| L1
    S3 -->|copy + _origin stamp<br/>safe-overwrite protocol| T1
    S4 -->|copy-no-overwrite| T2
    L1 -->|hook runs| H1
```

| Asset | Mechanism | Lives in | Local override |
|---|---|---|---|
| Hook wiring (`hooks/hooks.json`) | Installer resolves `${CALSUITE_DIR}` and merges into target's `settings.local.json` (gitignored). Hook runner reads literal absolute paths. | `<target>/.claude/settings.local.json` (per-user) | Edit freely; merge preserves `_origin=calsuite` tags and project-specific entries |
| Hook scripts (`scripts/hooks/*.cjs`) | Not copied, not symlinked. Referenced directly from `$CALSUITE_DIR`. | `<calsuite>/scripts/hooks/` | Edit calsuite — changes propagate instantly |
| Skills, agents | Copied with `_origin: calsuite@<sha>` frontmatter. Re-syncs safely overwrite pristine files; skip locally-edited files; never touch user-claimed ones. | `<target>/.claude/skills/`, `agents/` (committed) | `/reconcile`, `/customise`, `--claim`, `--force-adopt` — see [Syncing and reconciling](#syncing-and-reconciling) |
| Configs, templates, ESLint | Copy-no-overwrite. Seeded once, never refreshed. | `<target>/.claude/config/`, `.eslintrc.json`, `.claude/specs/` | Just edit — the installer never overwrites |
| Plugins, permissions | Merged into `settings.json` (portable strings, no paths). | `<target>/.claude/settings.json` (committed) | Edit; re-install preserves additions |
| MCP servers (`config/global-settings.json`) | Installer adds missing entries to `~/.mcp.json` + user settings. | `~/.claude/` and `~/.mcp.json` (per-user global) | Edit either file; installer only adds missing |

## Syncing and reconciling

`--sync` flows calsuite's current state into every target in `config/targets.json`. Pristine files get rewritten with a fresh `_origin: calsuite@<sha>` stamp; diverged files are skipped and surfaced for resolution. Three tiers handle both directions — mechanical, wrapped, agentic.

### Flowing calsuite → targets

From the calsuite root:

| Command | What it does |
|---|---|
| `/sync` | Mechanical `--sync` across every target, then interprets the divergence summary and suggests the smallest-viable follow-up |
| `/sync preview` or `/sync-preview` | Dry-run — reports what would change, writes nothing |
| `node scripts/configure-claude.js --sync` | Raw installer; `/sync` wraps this |

### Resolving divergence per file

Pick the right tool by **intent**, not by file count:

| Intent | Command | Notes |
|---|---|---|
| Take calsuite's version (discard local edits) | `--force-adopt <path>` | Re-stamps `_origin` to current calsuite sha |
| Keep target's version (mark user-owned forever) | `--claim <path>` | Stamps `_origin: <target>`; sync ignores it forever |
| Merge both sides | `/reconcile <path>` | 3-way merge in `$EDITOR` with git-style conflict markers; middle pane is the install-sha ancestor when available |
| Edit-then-claim atomically | `/customise <skill>` | Intentional per-target fork of a calsuite skill |
| Bulk, LLM-mediated | `/reconcile-targets` | Walks every target's divergences; prompts per file for upstream / cross-port / keep-local / adopt / merge; opens PRs where agreed |

### Orphan cleanup

`configure-claude.js --prune-stale [path]` — opt-in cleanup of three categories:

- **[A]** Parent-level orphan symlinks under `~/Projects/.claude/{skills,agents}` (pre-refactor load-bearing; nothing reads them now)
- **[B]** Mixed `<target>/.claude/scripts/{hooks,lib}` dirs where calsuite symlinks coexist with user files
- **[C]** Stale skill/agent `.md` files without `_origin` that diverge from current calsuite

Dry-run by default; `--yes` to apply. Category C always prompts per-file regardless of `--yes` — deleting potentially-edited files is irreversible.

### Internal vs distributed skills

Calsuite's own workflow skills (`/sync`, `/sync-preview`, `/reconcile`, `/reconcile-targets`, plus installer wrappers like `/configure-claude` and `/skill-builder`) are listed in `INTERNAL_SKILLS` in `scripts/configure-claude.js` and never ship to targets — they read files that only exist in calsuite (`config/targets.json`, `scripts/configure-claude.js`). Distributed skills appear only in `config/profiles.json`. The two sets are disjoint by design; any skill that reads calsuite-root files belongs in `INTERNAL_SKILLS`.

## Mono-repo Support

The installer auto-detects project type via `config/profiles.json`:
- **Signals** — file existence, package.json deps/fields, subdirectory presence
- **Profiles** — `base`, `typescript`, `python`, `frontend`, `backend`, `monorepo-root`
- Each profile specifies which plugins, skills, agents, and templates to install
- Mono-repos get per-workspace installation with workspace-specific profiles

```bash
# Install into a mono-repo with backend/ and frontend/
node scripts/configure-claude.js /path/to/monorepo
```

## Skills overview

Skills are invoked as `/<name>`. Bucketed by how often you'll reach for them.

### Daily — code work
- **`/plan`** — interview / brainstorm / review / visualize before implementing. Use `--grill` for relentless one-question-at-a-time decision-tree walking.
- **`/execute`** — implement from conversation context, a spec, or a GitHub issue. Multi-pane variant for parallel work.
- **`/debug`** — systematic debugging built around a fast, deterministic feedback loop.
- **`/review`** — pre-landing review with up to 9 parallel agents, confidence scoring, optional adversarial converse mode.
- **`/ship`** — merge main, test, review, push, open PR. Docs-only / config-only PR-only mode for lightweight changes.
- **`/zoom-out`** — map an unfamiliar area: callers, collaborators, peers, entry points. One layer up.
- **`/improve-architecture`** — find shallow modules and propose deepening opportunities. Run every few days.

### Daily — workflow
- **`/session-start`** — load full project context: CLAUDE.md, specs, changelog, git history.
- **`/strategic-compact`** — hook-driven compaction suggestions at logical session breakpoints.
- **`/learn`** — durable per-project learnings that compound across sessions.
- **`/babysit-pr`**, **`/receiving-pr-feedback`** — PR lifecycle helpers.

### Occasional
- **`/qa`** — systematic QA testing.
- **`/simplify`** — review changed code for reuse, quality, efficiency.
- **`/sweep-issues`** — auto-create GitHub issues from session context (deferred items, fast-follows, tech debt). Records `wontfix` enhancements to `.out-of-scope/`.
- **`/retro`** — weekly engineering retrospective.
- **`/new-spec`** — scaffold a spec directory with requirements / design / tasks templates.
- **`/worktrees`** — isolated git worktrees with auto-detected setup.
- **`/loop`** — run a prompt or skill on a recurring interval.
- **`/schedule`** — create scheduled remote agents (cron or one-shot).
- **`/guardian`** — autonomous-mode rules, audit log, mode switching.
- **`/lint-rule-gen`** — generate lint rules from review feedback patterns.
- **`/prevent`** — analyse a mistake and add the most deterministic guardrail.
- **`/plan-ceo`** — founder-mode plan review: scope expansion / hold / reduction.

### Calsuite-internal
Live in this repo, never distributed to targets:
**`/sync`**, **`/sync-preview`**, **`/reconcile`**, **`/reconcile-targets`**, **`/skill-builder`**.

`/customise` is calsuite-aware but *is* distributed — it ships to every target so users can claim divergent skills atomically without coming back to calsuite.

Full skill source: `skills/<name>/SKILL.md`.

## Agents

- **`@context-loader`** — Reads all spec state, git history, and produces a prioritized briefing for the session
- **`@doc-updater`** — Detects changed workspaces, fans out parallel sub-agents to update docs, creates architecture diagrams via Excalidraw MCP, then updates root tracking files
- **`@browser`** — Browser automation via `agent-browser` CLI — screenshots, navigation, clicking, form filling, and visual verification
- **`@code-reviewer`** — Reviews staged git changes against CLAUDE.md conventions and codebase patterns; writes a review stamp on PASS to unlock the commit gate

## Spec-driven Development

When installed with the `monorepo-root` profile, the installer creates:
- `.claude/specs/` — templates for requirements, design, and tasks
- `SPECLOG.md` — tracks spec status across the project
- `CHANGELOG.md` — keep-a-changelog format
- `docs/` — documentation folder at root and each workspace

## MCP Servers

The installer auto-configures MCP servers defined in `config/global-settings.json`:
- **sequential-thinking** — structured reasoning via `@modelcontextprotocol/server-sequential-thinking` (stdio, runs locally)
- **excalidraw** — hand-drawn architecture diagrams via [excalidraw-mcp](https://github.com/excalidraw/excalidraw-mcp) (used by `@doc-updater`)
  - Default URL points to the Excalidraw team's Vercel deployment (`excalidraw-mcp-ashy.vercel.app`)
  - To self-host: clone the [repo](https://github.com/excalidraw/excalidraw-mcp), build, and update the `url` in `config/global-settings.json`
- **context7** — current, version-specific library documentation via [Context7](https://github.com/upstash/context7) (used by `/context7` skill, no API key required)

Servers are written to `~/.mcp.json` and enabled in `~/.claude/settings.local.json` automatically.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
