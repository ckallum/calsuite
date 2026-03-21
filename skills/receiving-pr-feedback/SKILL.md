---
name: receiving-pr-feedback
version: 1.0.0
description: |
  PR feedback, review comments, code review response, address review, respond to feedback,
  handle reviewer suggestions, fix review comments, CR feedback.
  Rigorous handling of PR review feedback — verify before implementing, push back when wrong.
argument-hint: [pr-number]
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Agent
  - AskUserQuestion
---

# Receiving PR Feedback

Handle PR review feedback with technical rigor. Verify suggestions before implementing, push back when they're wrong, and never blindly agree.

## Step 1: Load feedback

If a PR number is in `$ARGUMENTS`, fetch comments:

```bash
gh pr view <number> --comments --json comments,reviews,reviewDecision
gh api repos/{owner}/{repo}/pulls/<number>/comments --jq '.[] | {path: .path, line: .line, body: .body, user: .user.login}'
```

If no PR number, check the current branch:
```bash
gh pr view --json number,comments,reviews
```

## Step 2: Classify each comment

For each review comment, classify it:

| Type | Action |
|---|---|
| **Bug / correctness issue** | Verify it's real, then fix |
| **Style / convention** | Check if it matches project conventions (read CLAUDE.md), then fix or push back |
| **Architecture suggestion** | Evaluate tradeoffs before acting |
| **Question / clarification** | Answer it |
| **Nitpick** | Fix if trivial, skip if subjective |
| **Wrong / outdated** | Push back with evidence |

## Step 2.5: Clarify ALL unclear items first

Before implementing anything, check if any comments are unclear or ambiguous. If so, **stop and ask for clarification on ALL unclear items before touching any code.**

Items may be related — partial understanding leads to wrong implementation.

```
IF you understand items 1,2,3,6 but not 4,5:
  ❌ WRONG: Implement 1,2,3,6 now, ask about 4,5 later
  ✅ RIGHT: "Understand 1,2,3,6. Need clarification on 4 and 5 before implementing."
```

---

## Step 3: Process each comment

For each comment, follow this protocol:

### Verify first — never blindly implement

1. **Read the code** the reviewer is commenting on. Understand the full context.
2. **Check if they're right.** Run the code path mentally or with a test. Does their suggestion actually improve things?
3. **Check for side effects.** Will the suggested change break something else?

### Forbidden responses

Never say:
- "You're absolutely right!"
- "Great catch!" (unless it genuinely is)
- "I'll fix that right away" (before verifying)

Instead: verify, then respond with facts.

### When to push back

Push back when a suggestion:
- **Breaks functionality** — "This would break X because Y. The current approach handles Z."
- **Lacks context** — "This pattern is intentional because [reason from spec/CLAUDE.md]."
- **Violates YAGNI** — grep the codebase for actual usage. "This endpoint isn't called anywhere. Remove it (YAGNI)? Or is there usage I'm missing?"
- **Is technically incorrect** — "This would actually cause [problem]. Here's why: [evidence]."
- **Conflicts with project conventions** — "CLAUDE.md specifies [convention]. Should we update the convention instead?"

### When to accept

Accept when:
- The suggestion is correct and you can verify it
- It catches a real bug or edge case
- It aligns with project conventions you missed

Acknowledge with brief, factual statements: "Fixed — the null check was missing." Not: "Wonderful suggestion, you're so right!"

## Step 4: Apply fixes

Implement in this order:
1. **Blocking issues** (breaks, security) — fix first
2. **Simple fixes** (typos, imports, one-liners) — batch these
3. **Complex fixes** (refactoring, logic changes) — one at a time, test each

For each accepted comment:
1. Make the fix
2. Test it (run relevant tests to verify no regression)
3. Reply on the PR with what you changed (one-liner)

```bash
gh api repos/{owner}/{repo}/pulls/<number>/comments/<comment-id>/replies -f body="Fixed — added null check for empty array case."
```

For each rejected comment, reply with your reasoning:

```bash
gh api repos/{owner}/{repo}/pulls/<number>/comments/<comment-id>/replies -f body="This is intentional — [reason]. Happy to discuss if you see an issue I'm missing."
```

## Step 5: Summary

Report to the user:
```text
PR #N feedback processed:
  Accepted: X comments (fixes applied)
  Pushed back: Y comments (replies posted)
  Questions answered: Z comments
```

## Gotchas

- **Never batch-accept all comments.** Process each individually. Reviewers are sometimes wrong.
- **YAGNI check every "make it more professional" suggestion.** If it adds complexity for hypothetical future use, push back.
- **Read the full diff context, not just the commented line.** Reviewers sometimes miss surrounding code that explains the pattern.
- **If the reviewer and you disagree, escalate to the user** via AskUserQuestion rather than going back and forth.
