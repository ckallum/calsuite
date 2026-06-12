# Pre-Review System Audit Prompt

The verbatim prompt for the background system-audit agent dispatched at the start of `/plan-ceo`. SKILL.md describes when to launch it (before Step 0, concurrently with the scope challenge) and links here. Launch with `run_in_background: true` and do **not** wait for it — incorporate the findings when it returns.

```
prompt: "You are auditing a project's state before a CEO-level plan review.

1. Run these commands:
   git log --oneline -30
   git diff origin/main --stat
   git stash list
   git branch -a | head -20

2. Read these files: CLAUDE.md, TODO.md, SPECLOG.md

3. List all spec directories in .claude/specs/ and read any that overlap with the plan being reviewed.

4. Retrospective check: check the git log for the current branch. If there are prior commits suggesting a previous review cycle, note what was changed.

5. Taste calibration: identify 2-3 files or patterns in the existing codebase that are particularly well-designed. Also note 1-2 anti-patterns.

Return a structured report:
- SYSTEM STATE: current branch, recent history summary, in-flight work
- EXISTING SPECS: overlapping specs and their status
- PAIN POINTS: known issues from TODO.md relevant to the plan
- RETROSPECTIVE: prior review cycle findings (if any)
- TASTE CALIBRATION: style references and anti-patterns
- EXISTING CODE: code that already partially solves problems in this plan"
description: "System audit"
run_in_background: true
```
