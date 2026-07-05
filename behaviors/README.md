# behaviors/

Global behavioural guidance that applies across **all** of your projects.

Each `*.md` file here is one behaviour — a short, high-signal section. The installer
(`scripts/configure-claude.js`) concatenates them (sorted by filename) into a single
marker-delimited block in your user-global `~/.claude/CLAUDE.md`, which Claude Code loads
for every project. Content outside the markers is never touched.

```text
<!-- BEGIN calsuite global behaviours … -->
  …concatenated behaviour sections…
<!-- END calsuite global behaviours -->
```

## How it installs

- During a normal `node scripts/configure-claude.js <target>` (the global-settings step).
- During `--sync` (so committing a behaviour change refreshes `~/.claude/CLAUDE.md`; the
  post-commit hook watches `behaviors/`). Silent in git-hook context.
- Standalone: `node scripts/configure-claude.js --install-global-behaviors`.

It is idempotent — re-running writes nothing when the block already matches.

## Writing a behaviour

- Keep it short. This text is injected into **every** session's context — pay for the tokens.
- One concern per file. Name files by topic (`code-comments.md`, `visualise-over-verbose.md`).
- Scope it both ways: say when the behaviour applies *and* when it doesn't. A blanket rule
  with no off-switch is worse than none.
- These are personal, cross-project preferences — not team conventions. They install to your
  home directory, never into a target repo's committed files.

`README.md` is ignored by the installer (it is not a behaviour).
