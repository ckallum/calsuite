---
name: afk-review
description: AFK review loop — review open PRs labelled auto:needs-review and advance the label state machine. Runs unattended; never prompts.
---

Run `/afk-review` and report the per-PR summary.

This is the AFK review loop: select open PRs labelled `auto:needs-review`, claim each
(`auto:reviewing`), run a consolidated `/review pr`, then transition the label to
`auto:ready` (clean) or `auto:needs-fixes` (actionable). Escalate anything stuck to
`auto:needs-human`. Make no other changes; never ask for input.

> The loop reviews **this task's working folder repo** — set the task's working folder
> to a checkout of your target repo; that alone determines which repo is reviewed (no
> repo arg needed). This file is symlinked from calsuite, so don't edit it per-machine —
> select the repo via the working folder, not by hardcoding an arg here. Suggested
> schedule: every 6h (set in the Routines UI or via the scheduled-tasks MCP).
