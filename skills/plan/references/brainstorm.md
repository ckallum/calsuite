# BRAINSTORM Mode

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
- `design.md` — Architecture, data model, API design, key decisions. **If `LIFECYCLE=1`** (see Lifecycle Detection): include a state × event matrix under `## State Transitions`.
- `tasks.md` — Phased implementation tasks with checkboxes

Update SPECLOG.md with the new spec entry.
