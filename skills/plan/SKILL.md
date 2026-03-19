---
name: plan
version: 1.0.0
description: |
  plan this, how should I implement, architecture review, design review, spec interview,
  brainstorm this, flesh out the spec, review my plan, technical review, visualize the flow,
  diagram this, draw the architecture, show me the data flow.
  Four modes: INTERVIEW (surface edge cases, write spec), BRAINSTORM (explore design),
  REVIEW (lock in architecture, data flow, edge cases, tests),
  VISUALIZE (diagram-based design validation, bug shakeout).
argument-hint: [mode] [spec-path]
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - Skill
  - Agent
  - AskUserQuestion
---

# Engineering Plan

Consolidated planning skill. Start here before writing code.

## Mode Selection

Parse `$ARGUMENTS` for the mode. If not specified, use AskUserQuestion to ask:

1. **INTERVIEW** — You have a spec or feature idea and want to flesh it out. Deep multi-round interview to surface edge cases, tradeoffs, and non-obvious decisions. Writes the final spec.
2. **BRAINSTORM** — You have a vague idea and want to explore it. Explore user intent, requirements, and design options before committing to an approach.
3. **REVIEW** — You have a plan/spec ready and want to lock in the technical execution. Architecture, data flow, edge cases, test coverage, performance.
4. **VISUALIZE** — You have a completed spec and want to validate it visually before coding. Generates Mermaid diagrams (user flow, data flow, state machines, edge cases) to shake out bugs that prose alone misses.

---

## INTERVIEW Mode

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
- **Do ask about:** hidden complexity, conflicting requirements, unstated assumptions, failure modes, edge cases, scaling concerns, security implications, data model subtleties, UX micro-interactions, state management tradeoffs, migration paths, backwards compatibility, error handling strategy, and integration boundaries.
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

---

## BRAINSTORM Mode

### Step 1: Understand intent
Ask the user to describe what they want to build. Use AskUserQuestion to probe:
- What problem are you solving? For whom?
- What does success look like?
- What's the scope — quick fix or new capability?

### Step 2: Explore the design space
For each major design decision, present 2-3 concrete options with tradeoffs:
- Data model options
- UI/UX approaches
- API design patterns
- Where it fits in the existing architecture

Use the project's existing patterns as a baseline. Read relevant code to understand what conventions to follow.

### Step 3: Converge on an approach
After exploring options, synthesize into a concrete proposal:
- What we're building (1-2 sentences)
- Key design decisions and rationale
- What's in scope vs. deferred
- ASCII diagram of the architecture/data flow

### Step 4: Write the spec
Create spec files in `.claude/specs/<feature-name>/`:
- `requirements.md` — User stories, functional/non-functional requirements
- `design.md` — Architecture, data model, API design, key decisions
- `tasks.md` — Phased implementation tasks with checkboxes

Update SPECLOG.md with the new spec entry.

---

## REVIEW Mode

### Step 0: System Audit
Before reviewing anything, gather context:
```bash
git log --oneline -30
git diff origin/main --stat
git stash list
```
Read CLAUDE.md, TODO.md, SPECLOG.md, and the spec being reviewed. Map:
* Current system state
* In-flight work (open PRs, branches)
* Existing pain points relevant to this plan
* Existing spec files in `.claude/specs/` that overlap

Also check for `.claude/specs/<slug>/diagrams.md`. If it exists, read it — the review agents should validate diagrams match the spec. If it does NOT exist, note: **"Tip: Run `/plan visualize <slug>` first to visually validate the design."**

### Step 1: Scope Challenge
Before reviewing anything, answer:
1. **What existing code already partially or fully solves each sub-problem?** Can we reuse existing routes, components, services?
2. **What is the minimum set of changes that achieves the stated goal?** Flag any work that could be deferred.
3. **Complexity check:** If the plan touches more than 8 files or introduces more than 2 new services, challenge whether fewer moving parts could achieve the same goal.

Then ask if the user wants:
1. **SCOPE REDUCTION:** Propose a minimal version.
2. **BIG CHANGE:** Walk through interactively, one section at a time (Architecture -> Quality -> Tests -> Performance), max 8 issues per section.
3. **SMALL CHANGE:** Compressed review — Step 0 + one combined pass. Pick the single most important issue per section. One AskUserQuestion round at the end.

**Critical: If the user does not select SCOPE REDUCTION, respect that fully.** Your job becomes making the plan succeed. Raise scope concerns once — after that, commit.

### Parallel Review — DISPATCH 4 AGENTS

After scope is agreed, dispatch **4 parallel review agents** in a single message using the Agent tool. Each agent reads the spec/plan independently and returns findings. This runs all reviews concurrently instead of sequentially.

**Agent 1 — Architecture Review:**
```text
prompt: "You are reviewing a technical plan. Read CLAUDE.md for project conventions, then read the spec at [SPEC_PATH].

If .claude/specs/<SLUG>/diagrams.md exists, read it and verify the diagrams match the spec. Flag any discrepancies between diagrams and design.md as issues.

Review the plan's architecture:
* Overall system design — pages, API routes, backend services, DB schema, background jobs
* Dependency graph and coupling concerns
* Data flow patterns and bottlenecks
* Multi-tenancy: every new table/query must scope appropriately
* Security: auth boundaries, authorization checks, API surface
* For each new codepath, describe one realistic production failure
* Diagram accuracy (if diagrams.md exists): do the visual flows match the spec?

Return a numbered list of issues. For each: file/component reference, problem description, 2-3 concrete options with your recommendation and WHY. Mark severity as CRITICAL or INFORMATIONAL."
description: "Architecture review"
```

**Agent 2 — Code Quality + Simplify Review:**
```text
prompt: "You are reviewing a technical plan. Read CLAUDE.md for project conventions, then read the spec at [SPEC_PATH].

Review code quality AND simplification opportunities:
* Code organization — fits existing patterns in CLAUDE.md?
* DRY violations — be aggressive
* Error handling patterns and missing edge cases
* Over-engineering or under-engineering
* Simplification: identify any planned code that could reuse existing utilities, be made simpler, or follow existing patterns more closely. Reference specific existing files/functions that could be leveraged.

Return a numbered list of issues. For each: file/component reference, problem description, 2-3 concrete options with your recommendation and WHY."
description: "Code quality + simplify"
```

**Agent 3 — Test Review:**
```text
prompt: "You are reviewing a technical plan. Read CLAUDE.md for project conventions, then read the spec at [SPEC_PATH].

Diagram all new things this plan introduces:
  NEW UX FLOWS:        [list each]
  NEW API ROUTES:      [list each]
  NEW DATA FLOWS:      [list each]
  NEW BACKGROUND JOBS: [list each]
  NEW ERROR PATHS:     [list each]

For each: what test covers it? (unit / integration / E2E)
For each new item: happy path test, failure path test, edge case test.
Test pyramid check: many unit, fewer integration, few E2E?
Flakiness risk: tests depending on timing, external services, read-after-write?

Return the diagram plus a numbered list of test gaps with recommendations."
description: "Test review"
```

**Agent 4 — Performance Review:**
```text
prompt: "You are reviewing a technical plan. Read CLAUDE.md for project conventions, then read the spec at [SPEC_PATH].

Review performance:
* N+1 queries — every new DB query in a loop: batch or join?
* Database indexes for new query patterns
* Parallelization opportunities for independent operations
* Background job sizing: worst-case payload, runtime, retry behavior
* Caching opportunities

Return a numbered list of issues with recommendations."
description: "Performance review"
```

### Process Agent Results

After all 4 agents return, merge their findings into a unified list. For each issue across all agents, present to the user via AskUserQuestion individually — one issue per call. Present options, recommend, explain WHY. Do NOT batch.

Process in priority order: Architecture issues first, then Quality+Simplify, then Tests, then Performance. Within each section, CRITICAL issues before INFORMATIONAL.

**STOP after each issue.** Only proceed after ALL issues resolved.

## CRITICAL RULE — How to ask questions (REVIEW mode)
Every AskUserQuestion MUST: (1) present 2-3 concrete lettered options, (2) state which option you recommend FIRST, (3) explain in 1-2 sentences WHY. No batching multiple issues. No yes/no questions. Open-ended questions only when genuinely ambiguous.

**Lead with your recommendation.** "Do B. Here's why:" Be opinionated.
**Escape hatch:** If a section has no issues, say so and move on.

In INTERVIEW and BRAINSTORM modes, AskUserQuestion can be more open-ended and exploratory — the strict option/recommendation format is not required.

## Required Outputs (REVIEW mode)

### "NOT in scope" section
Work considered and explicitly deferred, with rationale.

### "What already exists" section
Existing code/flows that partially solve sub-problems.

### TODO.md updates
Each potential TODO as its own AskUserQuestion. For each: What, Why, Pros, Cons, Context, Depends on. Options: A) Add to TODO.md, B) Skip, C) Build it now.

### Diagrams
ASCII diagrams for any non-trivial data flow, state machine, or pipeline.

### Failure modes
For each new codepath: one realistic failure, whether a test covers it, whether error handling exists, whether the user would see a clear error or silent failure. Any failure with no test AND no error handling AND silent -> **critical gap**.

### Completion summary
```text
  Step 0: Scope Challenge (user chose: ___)
  Architecture Review:  ___ issues found
  Code Quality Review:  ___ issues found
  Test Review:          diagram produced, ___ gaps
  Performance Review:   ___ issues found
  NOT in scope:         written
  What already exists:  written
  TODO.md updates:      ___ items proposed
  Failure modes:        ___ critical gaps
```

## VISUALIZE Mode

**Input:** Specs in `.claude/specs/<slug>/`.
**Output:** Validated Mermaid diagrams at `.claude/specs/<slug>/diagrams.md`.

### Step 1: Find and read the spec

Same as REVIEW Step 0 — find the spec by slug or most recent. Read all three files (`requirements.md`, `design.md`, `tasks.md`).

### Step 2: Assess which diagrams are needed

Analyze the spec and determine which diagram types are relevant:

| Diagram Type | When to Generate | Mermaid Type |
|---|---|---|
| **Data Flow** | Always — every feature has data moving somewhere | `flowchart TD` |
| **User Flow** | Spec introduces new pages, UI interactions, or multi-step workflows | `flowchart LR` |
| **State Machine** | Any entity has a status field, lifecycle states, or transitions | `stateDiagram-v2` |
| **Sequence Diagram** | Background jobs, queue dispatch, multi-service interactions, external API calls | `sequenceDiagram` |

Skip diagram types that don't apply. A simple CRUD feature might only need Data Flow + User Flow. A background job feature needs Sequence + State Machine.

### Step 3: Generate diagrams

For each relevant diagram type, generate a Mermaid diagram. Rules:

- **5-15 nodes per diagram** — focused, not the entire system
- **Include error paths and edge cases** — this is the whole point. The diagram should reveal what the text hides: What happens on failure? What if the queue message is retried? What if the user navigates away mid-flow?
- **Label edges** with the action or data being passed
- **For data flows:** Show org_id scoping checkpoints and auth boundaries
- **For state machines:** Show ALL transitions including error/rollback. Every state must have an outbound edge (no stuck states)
- **For sequence diagrams:** Show failure responses alongside the happy path (use `alt` blocks)
- **For user flows:** Show empty states, loading states, and error states as nodes

### Step 4: Interactive validation

Present each diagram to the user via AskUserQuestion (one diagram per question):

> Here's the [Data Flow / User Flow / State Machine / Sequence] diagram:
>
> [rendered Mermaid]
>
> Does this match your mental model?
> A) Looks correct — move on
> B) I see an issue — [describe what's wrong and I'll update]
> C) Skip this diagram type

This is the key step. The user stares at the visual and catches things the text missed. If they choose B, update the diagram and re-present.

### Step 5: Write diagrams.md

Write all validated diagrams to `.claude/specs/<slug>/diagrams.md`:

```markdown
# <Spec Name> — Design Diagrams

Generated by `/plan visualize` on YYYY-MM-DD.

## Data Flow
\`\`\`mermaid
flowchart TD
  ...
\`\`\`

### Notes
- [Edge cases or decisions surfaced during visual review]

## Sequence Diagram
\`\`\`mermaid
sequenceDiagram
  ...
\`\`\`
```

### Step 6: Summary

```text
Diagrams written to .claude/specs/<slug>/diagrams.md
  Data Flow:        ✓ validated (or "skipped — no data changes")
  User Flow:        ✓ validated (or "skipped — no UI changes")
  State Machine:    ✓ validated (or "skipped — no lifecycle states")
  Sequence Diagram: ✓ validated (or "skipped — no async flows")

Next step: /plan review <slug>
```

---

## Gotchas

- **AskUserQuestion strict rules only apply to REVIEW mode.** In INTERVIEW and BRAINSTORM modes, questions can be open-ended and exploratory — the lettered-option/recommendation format is not required.
- **Use `origin/main` not local `main`** for all diff and log commands. Local main may be stale.
- **Spec file paths vary.** Some projects use `.claude/specs/`, others use `docs/specs/` or top-level spec files. Always check `$ARGUMENTS` first, then look for common locations.
- **VISUALIZE mode is post-spec, pre-code.** Don't run it on a half-written spec — the diagrams will be wrong and the verification useless. Run INTERVIEW or BRAINSTORM first.
- **Diagrams expose spec gaps, not code bugs.** If VISUALIZE finds issues, update the spec — don't start coding with known gaps.
