---
name: afk-fix
description: AFK fix loop — converge review feedback into committed fixes on auto:needs-fixes PRs and advance the label state machine. Runs unattended; the only loop that mutates code; never prompts.
---

Run `/afk-fix` and report the per-PR summary.

This is the AFK fix loop — the **only loop that mutates code.** Select open PRs labelled
`auto:needs-fixes`, claim each (`auto:fixing`), check out the PR head (detached) in this task's isolated
worktree, and converge review feedback into committed fixes: `/receiving-pr-feedback --no-publish`
→ `/review --headless` (its Agent K covers reuse/simplification), looping up to 3 rounds until the local
review has no addressable findings. On convergence, `/receiving-pr-feedback --publish-only` posts the
staged replies, updates the PR body, and **pushes to the PR branch**, then the label moves to
`auto:needs-review`. Escalate anything that can't converge (or hits an unattended prompt / unfixable
failure) to `auto:needs-human`, leaving the branch unpushed. Never push to `main`, never force-push,
never ask for input — and the loop deliberately invokes **no** skill that prompts: no
`/improve-architecture`, `/simplify`, or `/prevent` (none has a headless mode, so each would hang).

> The loop fixes **this task's working-folder repo** — set the working folder to a checkout of your
> target repo; that alone selects the repo (no arg needed). This file is symlinked from calsuite.
> **Install the skill dependencies first.** The loop calls `/review --headless` and
> `/receiving-pr-feedback --no-publish`, which resolve from *this repo's installed* skills — not from
> calsuite's source. Run `node "${CALSUITE_DIR:-$HOME/Projects/calsuite}/scripts/configure-claude.js" .`
> in the target checkout once, or every convergence fails on a stale install. The loop verifies this
> up front and aborts with the exact command if the installed copies lack the flags.
> **Worktree isolation must be ON** — the loop runs `gh pr checkout --detach`, so it needs an isolated
> checkout it can safely mutate. Suggested schedule: every 7h, offset from the review loop.
