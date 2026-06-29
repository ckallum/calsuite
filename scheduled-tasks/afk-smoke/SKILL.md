---
name: afk-smoke
description: AFK Phase 0 smoke test — confirms a Desktop task can run a custom skill + global workflow. Read-only.
---

Run `/afk-smoke` and report the result.

This is a read-only validation of the autonomous AFK loop plumbing. It confirms the
`/afk-smoke` skill resolves, that it invokes the global `afk-smoke` workflow, that
one agent dispatches and reads the newest open PR via `gh`, and that a structured
result comes back. The workflow probes **this task's working folder repo** (set the
task folder to whichever repo you want to probe). Make no changes to any repo. If any
link in that chain fails to resolve (the skill, the Workflow tool, or the global
workflow), say so plainly — that is the go/no-go signal.

> This file is symlinked from calsuite (`scheduled-tasks/afk-smoke/SKILL.md`); edits
> there take effect on the next run.
