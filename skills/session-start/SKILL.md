---
name: session-start
description: |
  start session, get me up to speed, project briefing, onboard me on this repo,
  what's the state of this project, load full context, catch me up before planning.
  Use when starting a session or picking up unfamiliar work and you need orientation.
  Load full project context — reads all .md files, specs, changelog, and git history
  to produce a prioritized project briefing.
user-invocable: true
arguments: Optional workspace name to scope context loading e.g. "backend"
---

# /session-start

Load comprehensive project context by delegating to the `@context-loader` agent.

## Instructions

Run the `@context-loader` agent to read all project documentation, specs, tasks, and git history, then produce a prioritized briefing for the session.

If `$ARGUMENTS` is provided, scope context loading to that workspace subdirectory — still read root-level files (README.md, CLAUDE.md, SPECLOG.md, CHANGELOG.md) but focus spec and source file loading on the specified workspace.

If no arguments are provided, run at the project root and cover all workspaces.
