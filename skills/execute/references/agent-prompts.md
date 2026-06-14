# Execution Loop Agent Prompts

Full agent prompts for the `/execute` execution loop (Step 3). SKILL.md describes each dispatch in 2-3 lines and links here for the verbatim prompt text. Pass each prompt to a fresh agent — never tell an agent to "read tasks.md," because fresh agents don't share your context. Substitute the bracketed placeholders (`<task text>`, `<COMPLIANCE_REFERENCE>`, etc.) before dispatching.

---

## 3a: Implementer agent

```text
prompt: "You are implementing a task. Read CLAUDE.md first.

TASK:
<full task text — never make the agent read a file>

CONTEXT:
<COMPLIANCE_REFERENCE content — spec sections, issue body, or user summary>

DIAGRAMS:
<relevant diagrams from diagrams.md, if they exist (SPEC mode only)>

Instructions:
1. If anything is unclear, list your questions and STOP — do not guess.
2. Implement exactly what the task specifies. Nothing more, nothing less.
3. Write tests for new functionality.
4. Run tests to verify they pass.
5. Commit your changes with a descriptive message.
   ISSUE mode: include 'Refs #<number>' in commit message.
6. Self-review: check completeness, code quality, test coverage.

Return: what you implemented, what tests you wrote, test results, any concerns."
description: "Implement task: <task title>"
```

**If the agent has questions:** treat as a hard blocker. In `MODE=hitl`, present via AskUserQuestion, answer, then re-dispatch. In `MODE=afk`, the orchestrator does **not** have the user's input — STOP and report: *"Task `<title>` requires HITL clarification: `<questions>`. Re-run as HITL or label the issue `hitl` and re-execute."* Do not guess; do not skip; do not silently stall waiting for input that won't come.

---

## 3b: Compliance reviewer agent

Dispatch after the implementer finishes.

```text
prompt: "You are reviewing an implementation for compliance. Read the actual code changes (git diff), not just the implementer's report.

TASK THAT WAS IMPLEMENTED:
<full task text>

COMPLIANCE REFERENCE:
<COMPLIANCE_REFERENCE — spec requirements, issue body, or user summary>

Check:
- Did the implementer build exactly what was requested?
- Is anything missing from the requirements?
- Is there extra/unneeded work beyond the task scope?
- Do the tests cover the requirements?

Report: ✅ Passes compliance, or ❌ with specific file:line issues."
description: "Compliance review: <task title>"
```

**If issues found:** Re-dispatch the implementer with the specific issues. Re-review after fixes. Max 2 fix cycles — if still failing, escalate to user.

---

## 3c: Code quality reviewer agent

Dispatch only after compliance passes.

```text
prompt: "You are reviewing code quality. Read CLAUDE.md first, then review the changes.

Run: git diff origin/main --name-only to find changed files. Read each changed file.

Check:
- Does the code follow project conventions from CLAUDE.md?
- Are there DRY violations, unnecessary complexity, or missing error handling?
- Could existing utilities be reused instead of new code?
- Are there security concerns?

Report: list of issues (Critical/Important/Minor) with file:line references and suggested fixes."
description: "Quality review: <task title>"
```

**If critical issues found:** Fix them (or dispatch implementer to fix). Re-review.
