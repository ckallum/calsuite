# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Personal Claude Code configuration repository (dotfiles-style). Stores hooks, commands, scripts, plugins, skills, and agents that bootstrap new projects.

## Structure

```
hooks/       # Custom hooks (shell commands triggered by Claude Code events)
commands/    # Custom slash commands
scripts/     # Standalone utility scripts + configure-claude installer
config/      # Global settings manifest + profiles.json (profile→plugin/skill/agent mappings)
plugins/     # Claude Code plugins
skills/      # Custom skills (/configure-claude, /strategic-compact, /spec-interview, /update-docs, /context7, /guardian, /plan, /plan-ceo, /ship, /retro)
agents/      # Agent .md files with YAML frontmatter (@context-loader, @doc-updater, @browser, @code-reviewer)
templates/   # Spec, doc, and changelog templates (never overwritten on re-install)
```

## Key file locations

- `~/.claude/settings.json` — global settings; `enabledPlugins` is `{ "name@marketplace": true }`
- `~/.claude/settings.local.json` — local settings; `enabledMcpjsonServers` is an array of names
- `~/.claude/plugins/known_marketplaces.json` — object keyed by marketplace name (not an array)
- `~/.config/ccstatusline/settings.json` — ccstatusline layout config
- `~/.mcp.json` — global MCP server configs; installer auto-adds missing servers from manifest
- `config/global-settings.json` — this repo's manifest of expected global state; `mcpServers` is an object of server configs (not a name array)
- `config/profiles.json` — profile detection signals and profile→plugin/skill/agent mappings

## Gotchas

- `known_marketplaces.json` is an object keyed by name, not an array — use `Object.keys()` to get names
- Plugins can be enabled at global (`~/.claude/settings.json`) OR project scope (`.claude/settings.json`) — check both
- `String.prototype.replace` with a string replacement interprets `$` sequences — use a function replacer `() => value` for literal paths
- `JSON.stringify(undefined)` returns `undefined` (not a string) — guard inputs to `resolveHookPaths`
- Git repo lives at `Projects/claude/`, NOT at parent `Projects/` — was migrated in this session
- Profiles in `profiles.json` with an explicit `skills` array override (not merge with) the parent — when adding a new skill to `base`, also add it to `monorepo-root` and any other profile that declares its own `skills`
- `config/global-settings.json` stores empty placeholders for API keys (e.g., `CONTEXT7_API_KEY: ""`); actual keys go in `~/.mcp.json` only — never commit real keys to the manifest
- When writing MCP skills, verify tool names against the live server or latest README — tool names change across versions (e.g., Context7 renamed `get-library-docs` → `query-docs`)
- Claude Code MCP schema uses `"type": "http"` for remote servers, NOT `"type": "url"` — `"url"` fails schema validation
- Review gate blocks commits without `@code-reviewer` approval — bypass with `[skip-review]` in commit message, `docs:`/`chore:`/`style:` prefix, or md-only changes

## Testing configure-claude.js

- `node scripts/configure-claude.js /tmp/test-project` — full integration test against temp dir
- `--install-ccstatusline` flag for standalone ccstatusline install
- Always `rm -rf /tmp/test-project` after testing

## Versioning

Current version: **2.2**

When making changes to this repo:
1. Bump the version in both CLAUDE.md and README.md
2. Add a line item to the changelog below

## Changelog

- **2.2** — Flow trace and ship sweep-fix: `flow-trace.cjs` PreToolUse hook captures Skill/Agent invocations to per-session JSONL, `/flow` skill generates Mermaid workflow diagrams, `/ship` embeds Development Flow in PR body, `/ship` Step 8 now triages swept issues and fixes minor items inline before PR creation
- **2.1** — Lint-directed agents: ESLint config auto-install, `agent-rules.json` structural lint rules, `lint-gate.js` pre-commit hook, `eslint-check.js` post-edit hook, `/lint-rule-gen` skill, Guardian architectural boundary rules (cross-layer imports, test colocation, file placement)
- **2.0** — Consolidated skills: `/plan` (interview + brainstorm + review), `/plan-ceo` (founder-mode plan review), `/ship` (automated test + review + PR pipeline), `/retro` (weekly engineering retrospective with trend tracking)
- **1.9** — Pre-commit review gate: `review-gate.js` hook + `@code-reviewer` agent for convention-aware code reviews before commits
- **1.8** — Guardian autonomous approval system: smart PreToolUse hook with configurable deny/warn rules, audit logging, and mode-based permissions
- **1.7** — Context7 MCP server and `/context7` skill for current library documentation lookup
- **1.6** — `@browser` agent (agent-browser CLI), Excalidraw MCP integration for `@doc-updater` diagrams, MCP auto-installation in configure script, monorepo workspace plugin check fix
- **1.5** — Mono-repo support + spec-driven development: profile-based installer (`config/profiles.json`), spec/doc templates, `@context-loader` and `@doc-updater` agents, `/update-docs` skill, spec-aware session hooks
- **1.4** — Added marketplace checks to `configure-claude.js`; manifest now includes `marketplaces` array
- **1.3** — Added `configure-claude.js` installer script, `config/global-settings.json` manifest; skill now invokes the script directly
- **1.2** — Added `configure-claude` skill: installs hooks and scripts into any project's `.claude/` directory
- **1.1** — Added hooks system: hooks.json config, 6 hook scripts (session lifecycle, console.log checks, compact suggestions), lib utilities (utils, package-manager, session-aliases, session-manager)
- **1.0** — Initial setup: repo structure, CLAUDE.md, README.md
