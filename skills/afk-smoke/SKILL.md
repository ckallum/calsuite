---
name: afk-smoke
version: 0.2.0
description: |
  afk smoke test, validate afk plumbing, phase 0 go/no-go, test desktop task workflow chain.
  Use when validating that a Desktop scheduled task can invoke a custom global skill that
  runs a global dynamic workflow end to end. Read-only; throwaway — delete after the
  Phase 0 go/no-go.
allowed-tools:
  - Bash
  - Workflow
---

# AFK smoke test (Phase 0)

You are validating the plumbing for the autonomous AFK loops. Your only job is to run the `afk-smoke` dynamic workflow and report whether it worked. **Make no state changes** — no PR comments, no label edits, no code edits.

The workflow operates on **the current working directory's repo** (it resolves `gh` against the directory's git remote). When this runs as a Desktop scheduled task, that directory is the task's working folder, so set the task's folder to whichever repo you want to probe.

## Steps

1. Invoke the **Workflow** tool by name, with no args:
   ```
   Workflow({ name: "afk-smoke" })
   ```
   This resolves the saved workflow from `~/.claude/workflows/afk-smoke.js`.
2. When it completes, report a one-paragraph summary: that the workflow ran, that one agent dispatched, and the `ok` / `repo` / `pr` / `title` it returned.
3. If the **Workflow** tool is unavailable, or the `afk-smoke` workflow cannot be resolved by name from `~/.claude/workflows/`, say so explicitly and clearly — **that is the Phase 0 go/no-go signal** and the most important thing to surface.

This skill exists only to confirm the chain: Desktop task → this skill → global `~/.claude/workflows/` workflow → one agent → `gh` (read-only) → structured result. Nothing here mutates state.
