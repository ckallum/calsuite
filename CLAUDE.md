# CLAUDE.md

Personal Claude Code configuration repo (dotfiles-style). Hooks, commands, scripts, plugins, skills, and agents that bootstrap new projects.

**Version: 2.6** — full history in [CHANGELOG.md](./CHANGELOG.md).

## Routing

When the user's intent matches, read the pointed file *before* doing anything else:

| Intent | Read |
|---|---|
| Modify installer / profiles / sync | `scripts/configure-claude.js`, `config/profiles.json`, `config/targets.json`, `config/global-settings.json` |
| Add/change a hook | `hooks/hooks.json`, `scripts/hooks/<name>.cjs`, `scripts/lib/utils.cjs` |
| Add/change a skill | `skills/<name>/SKILL.md` (skills are parameterized — document args in a `## Arguments` section) |
| Add/change an agent | `agents/<name>.md` (YAML frontmatter) |
| MCP server changes | `config/global-settings.json` (empty placeholder keys only) + `~/.mcp.json` (real keys, never committed) |
| Spec/doc templates | `templates/` — never overwritten on re-install |

## Codify on repeat

If the user asks for the same *shape* of thing a second time, propose a skill. The third time is too late. Skill files live at `skills/<name>/SKILL.md` and are auto-registered via the installer.

Record durable learnings (patterns, pitfalls, preferences) via `/learn save` — they persist across sessions in `.context/learnings/`.

## Structure

```
hooks/       # hooks.json (shell commands triggered by Claude Code events)
commands/    # custom slash commands
scripts/     # utility scripts + configure-claude installer, scripts/hooks/*.cjs
config/      # global-settings.json (manifest), profiles.json (profile→plugin mapping)
plugins/     # Claude Code plugins
skills/      # parameterized slash-commands (SKILL.md each)
agents/      # agent .md files with YAML frontmatter
templates/   # spec / doc / changelog templates
```

## Key file locations

- `~/.claude/settings.json` — user-global; `enabledPlugins` is `{ "name@marketplace": true }`
- `~/.claude/settings.local.json` — user-local; `enabledMcpjsonServers` is an array of names
- `~/.claude/plugins/known_marketplaces.json` — object keyed by marketplace name (not an array)
- `~/.claude/analytics/skill-usage.jsonl` — skill invocations (written by `skill-usage-tracker.cjs`, read by `/retro`)
- `~/.config/ccstatusline/settings.json` — ccstatusline layout
- `~/.mcp.json` — user-global MCP server configs (installer adds missing servers from manifest)
- `<target>/.claude/settings.json` — **team-shared** (committed). Installer writes `enabledPlugins` and `permissions` here. Never hooks, never paths.
- `<target>/.claude/settings.local.json` — **per-user** (gitignored by the installer). Installer writes calsuite hook wiring here with literal resolved `$CALSUITE_DIR` paths.
- `config/targets.json` — repos that `--sync` installs to
- `.git/hooks/post-commit` — auto-syncs on commit when hooks/skills/agents/scripts/config change

## Gotchas

### Installer + distribution
- Hooks live in **`settings.local.json`** (gitignored), not `settings.json`. Writing calsuite paths into committed `settings.json` breaks every collaborator and CI.
- Hook scripts are **not** copied or symlinked into target repos. Hook commands in `settings.local.json` reference `$CALSUITE_DIR/scripts/hooks/*.cjs` directly. `$CALSUITE_DIR` is resolved **at install time** into an absolute path — Claude Code's hook runner does NOT shell-expand hook commands at runtime.
- `hooks/hooks.json` template uses `${CALSUITE_DIR}` placeholder. Installer substitutes via `substituteCalsuiteDir()` in `scripts/configure-claude.js`.
- Calsuite location resolves in this order: `$CALSUITE_DIR` env var → `~/Projects/calsuite` default → installer's own parent dir.
- Skills and agents use the `_origin` safe-overwrite protocol — frontmatter marker `_origin: calsuite@<short-sha>`. Decision matrix lives in `scripts/lib/origin-protocol.cjs` (`decideFileAction`). Migration for pre-protocol files happens automatically per-file (byte-identical → auto-stamp, differs → skip + log).
- Content comparison is LF-normalized and strips the `_origin` line from both sides. Source files never carry `_origin`; target files always do once stamped. Comparing raw bytes would false-positive every time.
- `_origin` protocol applies **only to markdown** under `skills/` and `agents/`. Non-markdown files (rare; e.g. `skills/strategic-compact/scripts/suggest-compact.cjs`) are copy-no-overwrite. JSON configs stay on copy-no-overwrite (can't host frontmatter).
- Auto-frontmatter: supporting markdown files that lack a YAML block (e.g. `skills/review/checklist.md`, `skills/ship/pr-template.md`) get one prepended with just `_origin:` on first install.

### Runtime mechanics
- `known_marketplaces.json` is an object keyed by name — use `Object.keys()`.
- Plugins can be enabled at global OR project scope — check both.
- `String.prototype.replace` with a string replacement interprets `$` sequences — use a function replacer `() => value` for literal paths.
- `JSON.stringify(undefined)` returns `undefined` (not a string) — guard inputs before passing to it.
- Git repo lives at `Projects/calsuite/`, NOT parent `Projects/`.
- Profiles with an explicit `skills` array **override** (not merge with) parent — when adding a skill to `base`, also add to `monorepo-root` and any other profile declaring its own `skills`.
- `global-settings.json` stores empty placeholders for API keys; real keys go in `~/.mcp.json` only.
- MCP tool names change across versions (e.g. Context7 `get-library-docs` → `query-docs`) — verify against the live server.
- Hook entries in `hooks.json` MUST have `"_origin": "calsuite"` — the installer uses this to merge without overwriting project-specific hooks.
- Claude Code MCP schema uses `"type": "http"` for remote servers, NOT `"type": "url"`.
- Claude Code's skill hierarchy is enterprise > personal (`~/.claude/`) > project (CWD's `.claude/`) > plugin. Parent-directory `.claude/skills/` is **not** discovered automatically.
- Review gate blocks commits without `@code-reviewer` approval — bypass with `[skip-review]`, `docs:`/`chore:`/`style:` prefix, or md-only changes.

### Divergence resolution

When `--sync` reports files skipped pending reconciliation, three commands resolve them:
- `--force-adopt <path>` — take calsuite's current version. Destroys local edits.
- `--claim <path>` — stamp `_origin: <target-name>`, keep local content. Future syncs skip silently.
- `--reconcile <path>` — **issue [#42](https://github.com/ckallum/calsuite/issues/42)**, not yet implemented — three-way merge with `$EDITOR`.

## Testing configure-claude.js

- `node scripts/configure-claude.js /tmp/test-project` — full integration test
- `--install-ccstatusline` flag for standalone ccstatusline install
- Always `rm -rf /tmp/test-project` after testing

## Versioning

When making changes: bump version in `CLAUDE.md` + `README.md` + top of `CHANGELOG.md`, and add an entry to `CHANGELOG.md`.
