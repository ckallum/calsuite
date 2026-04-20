# calsuite

Personal Claude Code configuration — hooks, commands, scripts, plugins, skills, and agents.

**Version: 2.6**

## Getting started

Clone this repo. By default, place it at `~/Projects/calsuite`; if you keep it elsewhere, export `CALSUITE_DIR=/your/path` in your shell profile before running the installer.

```bash
node scripts/configure-claude.js /path/to/target-repo
```

Repo layout:

```
hooks/       # Shell commands triggered by Claude Code events
commands/    # Custom slash commands
scripts/     # configure-claude installer, scripts/hooks/*.cjs, scripts/lib/*.cjs
config/      # global-settings.json (manifest), profiles.json, targets.json
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
        S2["hooks/hooks.json<br/>(template, \${CALSUITE_DIR})"]
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
    S2 -->|installer resolves \${CALSUITE_DIR}| L1
    S3 -->|copy + _origin stamp<br/>safe-overwrite protocol| T1
    S4 -->|copy-no-overwrite| T2
    L1 -->|hook runs| H1
```

| Asset | Mechanism | Lives in | Local override |
|---|---|---|---|
| Hook wiring (`hooks/hooks.json`) | Installer resolves `${CALSUITE_DIR}` and merges into target's `settings.local.json` (gitignored). Hook runner reads literal absolute paths. | `<target>/.claude/settings.local.json` (per-user) | Edit freely; merge preserves `_origin=calsuite` tags and project-specific entries |
| Hook scripts (`scripts/hooks/*.cjs`) | Not copied, not symlinked. Referenced directly from `$CALSUITE_DIR`. | `<calsuite>/scripts/hooks/` | Edit calsuite — changes propagate instantly |
| Skills, agents | Copied with `_origin: calsuite@<sha>` frontmatter. Re-syncs safely overwrite pristine files; skip locally-edited files; never touch user-claimed ones. | `<target>/.claude/skills/`, `agents/` (committed) | `--claim <path>` to keep local, `--force-adopt <path>` to take calsuite's version |
| Configs, templates, ESLint | Copy-no-overwrite. Seeded once, never refreshed. | `<target>/.claude/config/`, `.eslintrc.json`, `.claude/specs/` | Just edit — the installer never overwrites |
| Plugins, permissions | Merged into `settings.json` (portable strings, no paths). | `<target>/.claude/settings.json` (committed) | Edit; re-install preserves additions |
| MCP servers (`config/global-settings.json`) | Installer adds missing entries to `~/.mcp.json` + user settings. | `~/.claude/` and `~/.mcp.json` (per-user global) | Edit either file; installer only adds missing |

**When a sync flags divergence** — e.g. you've edited `<target>/.claude/skills/ship/SKILL.md` locally — the installer skips that file and logs it. Resolve with:

- `node scripts/configure-claude.js --force-adopt <path>` — take calsuite's current version.
- `node scripts/configure-claude.js --claim <path>` — stamp `_origin: <target>`, keep local content. Sync never touches it again.
- `node scripts/configure-claude.js --reconcile <path>` — (issue [#42](https://github.com/ckallum/calsuite/issues/42), planned) three-way merge in `$EDITOR`.

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
