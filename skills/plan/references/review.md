# REVIEW Mode

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

### State × event matrix (conditional)
**If `LIFECYCLE=1`** (see Lifecycle Detection in SKILL.md): emit a state × event matrix listing every event/command across every state. Every cell must specify expected behavior (OK, error, skip, reject, stop-first, etc.). Empty or fuzzy cells are flagged as CRITICAL gaps. If the spec's `design.md` already contains a matrix, validate it — every cell reachable, no stuck states. If missing, emit one and recommend adding to `design.md`. Skip this section entirely when `LIFECYCLE=0`.

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
  State × event matrix: ___ cells (or "skipped — not a state machine")
```
