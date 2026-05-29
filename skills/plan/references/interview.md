# INTERVIEW Mode

### Step 1: Find the spec
If a path is provided in `$ARGUMENTS`, use it. Otherwise, look for files in `.claude/specs/` or ask the user. Read the file thoroughly.

### Step 2: System context
Before interviewing, gather context:
```bash
git log --oneline -20                    # Recent history
git diff origin/main --stat              # In-flight changes
```
Read CLAUDE.md, SPECLOG.md, TODO.md, and any related spec files. Understand what already exists and what's planned.

### Step 3: Interview the user
Conduct a deep, multi-round interview using AskUserQuestion. The goal is to surface non-obvious decisions, edge cases, and tradeoffs.

Interview guidelines:
- **Do NOT ask obvious questions** that the spec already answers clearly.
- **Do ask about:** hidden complexity, conflicting requirements, unstated assumptions, failure modes, edge cases, scaling concerns, security implications, data model subtleties, UX micro-interactions, state management tradeoffs, migration paths, backwards compatibility, error handling strategy, performance budgets, accessibility considerations, and integration boundaries.
- **Be specific.** Reference concrete parts of the spec. Instead of "how should errors work?", ask "when this background job fails after processing 3 of 10 items, what should the user see?"
- **Go deep on answers.** Follow up on interesting responses. If the user says "we'll use a queue", ask about retry policy, idempotency, ordering guarantees, dead letter handling.
- **Cover multiple dimensions per round.** Keep each AskUserQuestion focused on one decision, but cover multiple topics across a round to keep the interview moving.
- **Provide informed options.** When asking about tradeoffs, present concrete options with pros/cons.
- **Reference existing patterns.** Check what similar features in the codebase do and ask whether this should follow the same pattern or diverge.

### Step 4: Continue until complete
Keep interviewing across multiple rounds. A thorough interview typically needs 4-8 rounds. You are done when:
- All major architectural decisions are resolved
- Edge cases and error flows are addressed
- The user confirms they have nothing else to add

### Step 5: Write the final spec
Rewrite the spec file incorporating all decisions from the interview:
- Preserve the original structure and intent
- Integrate all interview answers as concrete decisions (not as Q&A)
- Add new sections for topics that emerged
- Follow the spec format: `requirements.md`, `design.md`, `tasks.md`
- Flag any remaining open questions
- **If `LIFECYCLE=1`** (see Lifecycle Detection in SKILL.md): include a state × event matrix in `design.md` under a `## State Transitions` section. Every cell must be filled — fuzzy cells get called out as open questions.
