# CLAUDE.md

Personal Claude Code configuration repo (dotfiles-style). Hooks, commands, scripts, plugins, skills, and agents that bootstrap new projects.

**Version: 2.40** — full history in [CHANGELOG.md](./CHANGELOG.md).

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

If the user asks for the same *shape* of thing a second time, propose a skill. The third time is too late. Skill files live at `skills/<name>/SKILL.md`.

**Adding a new skill is two edits, not one:**

1. Create `skills/<name>/SKILL.md` (and any supporting files).
2. Add `<name>` to `config/profiles.json` — at minimum the `base.skills` array, plus any other profile that declares its own `skills` (currently `monorepo-root`). The installer treats the profile array as an **allowlist**, not autodiscover. A skill that exists on disk but isn't in any profile won't distribute to targets — the installer warns about this on every run via `validateProfilesConfig()` (in both directions: orphan skills, and profile entries pointing at nonexistent dirs).

If the skill is calsuite-internal (lives in calsuite, not distributed — e.g. `sync`, `reconcile`, `customise`, `skill-builder`), skip step 2.

Record durable learnings (patterns, pitfalls, preferences) via `/learn save` — they persist across sessions in `.context/learnings/`.

## Fresh-clone test

Calsuite is a personal harness for the maintainer, but the source is distributable — anyone should be able to `git clone` it and run a single command to get a working install. Code that only works on the maintainer's machine defeats the point.

Two failure modes that have happened, both of which the fresh-clone test catches:

- **Hardcoded directory layouts under `HOME_DIR`.** A `path.join(HOME_DIR, 'Projects', 'calsuite')` fallback assumes the maintainer's repo location. Use `git rev-parse --git-common-dir` (works for any git checkout) or `__dirname` (works for any installer invocation) or an env var (explicit override). Never bake a user-directory convention into a fallback.
- **Tribal knowledge that isn't tracked.** A git hook installed manually on the maintainer's machine doesn't survive `git clone`. Anything required for the install to work must be either tracked in the repo (templates + an installer that copies them) or documented as a one-line setup step the user runs explicitly.

The deterministic check: run `scripts/setup.cjs` against a checkout that's not the maintainer's — a clean `~/Stuff/calsuite/`, `/tmp/calsuite-test/`, anywhere. The setup script + smoke test must produce a working install with no manual fix-ups. If anything fails, fix the source, not the user's environment.

Concrete failure modes this catches (PR #95, 2026-05-26): `resolveCalsuiteDir()` fell back to a hardcoded `~/Projects/calsuite` that nobody but the maintainer had; `.git/hooks/post-commit` was untracked, so fresh clones had no auto-sync. The "can a non-maintainer use this?" question would have surfaced both at design time. Adversarial review (`/review --converse codex`) examined the relevant code on PR #95 and did NOT flag either — both reviewers were tuned for correctness, not distributability. Naming this concern explicitly in CLAUDE.md changes what implementers and reviewers look for.

## Behavior changes need caller surveys

Before changing the externally-observable behavior of any shared interface — a function with multiple callsites, a CLI flag, a hook script, a skill that other skills invoke, a config schema, an exit-code contract — survey the callers first.

```bash
# Examples
rg "configure-claude.js --sync" -l        # who runs this CLI flag?
rg "readJsonSync\(.*TARGETS_JSON" -l      # who reads this config?
rg "scripts/hooks/foo.cjs" .claude/       # who invokes this hook?
```

For each caller, decide whether the new behavior is intended for that context. If contexts disagree (e.g. post-commit hook wants silence, `/sync` slash command wants loudness), the fix needs to discriminate — typically via an env var like `process.env.GIT_DIR` (set by git in hook context), an explicit flag, or a TTY check.

Concrete failure mode this catches (PR #95, 2026-05-25): `--sync` was made silent-on-missing-targets for the post-commit hook context. The `/sync` slash command, which interprets a missing output summary as "ran clean," then started falsely reporting success to users with no targets configured. Surveying the three callers (post-commit, `/sync`, `/reconcile-targets`) before the change would have surfaced the conflict immediately.

This is a workflow rule, not a lint rule — it requires judgment per caller. But it's the highest-leverage discipline for avoiding "fixed for one caller, broke another" regressions in shared infrastructure.

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
- `config/targets.json` — repos that `--sync` installs to. Each entry: `{ path, workspaces?, skills? }`. `workspaces: "skip"` restricts monorepo targets to root-only install. `skills: { exclude: ["a", "b"] }` drops the named skills from the profile-resolved install set; unmatched names surface as a ⚠ drift warning. See `config/targets.example.json`.
- `.git/hooks/post-commit` — auto-syncs on commit when hooks/skills/agents/scripts/config change
- `<target>/.claude/verify-config.json` — **optional** per-project config for `/verify` (dev command, ports, log path, DB shell, auth bypass, seed script). Without it the skill auto-discovers from `package.json` / `Makefile` / `docker-compose.yml`; schema lives at `skills/verify/references/config-schema.md`.

## Gotchas

### Installer + distribution
- Hooks live in **`settings.local.json`** (gitignored), not `settings.json`. Writing calsuite paths into committed `settings.json` breaks every collaborator and CI.
- Hook scripts are **not** copied or symlinked into target repos. Hook commands in `settings.local.json` reference `$CALSUITE_DIR/scripts/hooks/*.cjs` directly. `$CALSUITE_DIR` is resolved **at install time** into an absolute path — Claude Code's hook runner does NOT shell-expand hook commands at runtime.
- `hooks/hooks.json` template uses `${CALSUITE_DIR}` placeholder. Installer substitutes via `substituteCalsuiteDir()` in `scripts/configure-claude.js`.
- Hook command entries use **exec form**: `"command": "node", "args": ["${CALSUITE_DIR}/scripts/hooks/x.cjs"]` — not a shell string. Each `args[]` element is passed to the spawned process as-is (no shell interpretation, no quoting needed for paths with spaces). `substituteCalsuiteDir()` resolves `${CALSUITE_DIR}` in both `command` and `args` because it operates on the JSON-stringified form. Inline scripts use `"command": "node", "args": ["-e", "<script>"]`. Sibling fields (`async`, `timeout`) sit alongside `command`/`args` on the same object.
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
- Calsuite is **not** listed in `config/targets.json` — it is the source, not a downstream, so `--sync` never touches it.
- After structural changes to hooks, profiles, skills, or scripts, run `node scripts/configure-claude.js .` from the calsuite root to refresh `.claude/settings.local.json` here. The committed `.claude/settings.json` stays plugins + permissions only.
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
