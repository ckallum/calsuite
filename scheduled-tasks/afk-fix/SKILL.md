---
name: afk-fix
description: AFK fix loop — converge review feedback into committed fixes on auto:needs-fixes PRs and advance the label state machine. Runs unattended; the only loop that mutates code; never prompts.
---

Run `/afk-fix` and report the per-PR summary.

This is the AFK fix loop — the **only loop that mutates code.** Select open PRs labelled
`auto:needs-fixes`, claim each (`auto:fixing`), check out the PR branch in this task's isolated
worktree, and converge review feedback into committed fixes: `/receiving-pr-feedback --no-publish`
→ `/improve-architecture` + `/simplify` (non-trivial PRs) → `/review --headless`, looping up to 3
rounds until the local review passes. On convergence, run `/prevent`, then `/receiving-pr-feedback
--publish-only` to post the staged replies, update the PR body, and **push to the PR branch**, then
move the label to `auto:needs-review`. Escalate anything that can't converge (or hits a question /
unfixable failure) to `auto:needs-human`, leaving the branch unpushed. Never push to `main`, never
force-push, never ask for input.

> The loop fixes **this task's working-folder repo** — set the working folder to a checkout of your
> target repo; that alone selects the repo (no arg needed). This file is symlinked from calsuite.
> **Worktree isolation must be ON** — the loop runs `gh pr checkout`, so it needs an isolated branch
> checkout it can safely mutate. Suggested schedule: every 7h, offset from the review loop.
