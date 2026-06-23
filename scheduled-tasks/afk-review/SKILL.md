---
name: afk-review
description: AFK review loop — review open PRs labelled auto:needs-review and advance the label state machine. Runs unattended; never prompts.
---

Run `/afk-review ckallum/museli` and report the per-PR summary.

This is the AFK review loop: select open PRs labelled `auto:needs-review`, claim each
(`auto:reviewing`), run a consolidated `/review pr`, then transition the label to
`auto:ready` (clean) or `auto:needs-fixes` (actionable). Escalate anything stuck to
`auto:needs-human`. Make no other changes; never ask for input.

> Set this task's **working folder** to a checkout of the repo above — the review runs
> against the working-folder repo. This file is symlinked from calsuite
> (`scheduled-tasks/afk-review/SKILL.md`); edit the repo arg to match your target.
> Suggested schedule: every 6h (set in the Routines UI or via the scheduled-tasks MCP).
