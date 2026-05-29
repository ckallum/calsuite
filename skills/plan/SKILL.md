---
name: plan
description: |
  plan this, how should I implement, architecture review, design review, spec interview,
  brainstorm this, flesh out the spec, review my plan, technical review, visualize the flow,
  diagram this, draw the architecture, show me the data flow.
  Four modes: INTERVIEW (surface edge cases, write spec), BRAINSTORM (explore design),
  REVIEW (lock in architecture, data flow, edge cases, tests),
  VISUALIZE (diagram-based design validation, bug shakeout).
argument-hint: "[mode] [spec-path] [--lifecycle] [--grill]"
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

## Domain awareness (shared)

Before any mode runs, scan for the project's domain artifacts:

- **`CONTEXT.md`** at the repo root (or `CONTEXT-MAP.md` pointing to per-module `CONTEXT.md` files) — the domain glossary. If present, read it and **use its vocabulary verbatim** in spec text, interview questions, diagrams, and review findings. Don't drift to synonyms; don't rewrite "Order intake module" as "the order service." When the conversation resolves a new term or sharpens a fuzzy one, offer to update `CONTEXT.md` inline.
- **`docs/adr/`** (or `<context>/docs/adr/` in multi-context repos) — read any ADRs in the area being touched and respect them. Don't re-litigate decisions an ADR already locked in.
- **No artifacts yet?** Don't scaffold them empty. Create `CONTEXT.md` lazily when the first term is resolved; create an ADR only when a decision meets **all three** criteria (hard to reverse, surprising without context, result of a real trade-off). Use the formats below.

When `--grill` mode is active (see below), this discipline tightens: grill mode **must** challenge user terms against `CONTEXT.md` and propose ADRs for load-bearing irreversible decisions surfaced during the interview.

Format templates for both files live in [references/context-and-adr-formats.md](references/context-and-adr-formats.md) — read when you actually need to write one.

## Arguments

- `/plan` — ask for mode via AskUserQuestion
- `/plan [mode]` — where mode is `interview`, `brainstorm`, `review`, or `visualize`
- `/plan [mode] [spec-path]` — e.g. `/plan review auth-flow`
- `--lifecycle` — force state × event matrix emission even when auto-detection signals don't fire
- `--grill` — switch interview/brainstorm/review questioning into **grill mode**: one question at a time, always lead with the recommended answer, walk the decision tree branch-by-branch, update `CONTEXT.md` inline as terms resolve, propose ADRs only for hard-to-reverse decisions. See "Grill mode (modifier)" below.

## Lifecycle Detection (shared — runs before mode dispatch)

Detect whether the planned work touches a state machine. This determines whether plan outputs (INTERVIEW, BRAINSTORM, REVIEW) must include a **state × event matrix**. Signal detection is cheap — grep/glob only, no LLM calls.

**Explicit override:** if `$ARGUMENTS` contains `--lifecycle`, treat as state-machine work unconditionally.

**Path signals** (match any target or recently-changed file path):
```
**/session/**
**/actor/**
**/state_machine/**
**/lifecycle/**
**/fsm/**
```

**Content signals** (grep changed or referenced files):
```
enum\s+\w*(State|Lifecycle|Status)\b
impl\s+\w*Manager\b
```

**Detection command:**
```bash
# Path signals — check both in-flight and spec-referenced files
git diff origin/main --name-only 2>/dev/null | grep -E '(session|actor|state_machine|lifecycle|fsm)/' && LIFECYCLE=1
# Content signals — check changed files
git diff origin/main 2>/dev/null | grep -E '(enum\s+\w*(State|Lifecycle|Status)\b|impl\s+\w*Manager\b)' && LIFECYCLE=1
# Explicit flag
echo "$ARGUMENTS" | grep -q -- '--lifecycle' && LIFECYCLE=1
```

**When `LIFECYCLE=1`**, the plan's output MUST include a state × event matrix. When `LIFECYCLE=0` (typical CRUD/stateless work), skip the matrix — it's dead weight.

### State × event matrix format

Rows = events/commands the system accepts. Columns = current states. Cells = expected behavior (`OK`, `error`, `skip`, `stop-first`, `reject`, etc.). Example shape:

```
                 StateA    StateB    StateC    StateD
event_1          OK        error     error     error
event_2          skip      full      full      error
event_3          clear     clear     reject    clear
```

Every cell is a review target — missing or fuzzy cells are the bugs. Derive states from the system's actual state enum (or the enum you are designing) and events from command entry points.

---

## Grill mode (modifier)

`--grill` is a **modifier**, not a separate mode. It applies on top of INTERVIEW, BRAINSTORM, or REVIEW. Detect it once, near the top:

```bash
echo "$ARGUMENTS" | grep -q -- '--grill' && GRILL=1
```

**When `GRILL=1`, the questioning style changes:**

1. **One question at a time.** No multi-dimension batching. No "let me ask 5 things in this round." Walk the decision tree branch-by-branch — resolve dependencies between decisions one-by-one. Wait for the user's answer before continuing.
2. **Always lead with your recommended answer.** Format every question as: *"My recommendation: X. Reason: Y. But before I commit, [the actual question]."* Never ask open-ended questions without a recommendation — the user pushes back on yours instead of generating from scratch.
3. **Prefer codebase exploration over asking.** If a question can be answered by reading the code, read the code instead of asking. Only ask the user when the answer genuinely requires their judgment (product intent, tradeoff weighting, future plans).
4. **Read `.out-of-scope/` early.** If the repo has `.out-of-scope/<slug>.md` rejection records, scan them before you start asking — don't re-litigate decisions that were already rejected for durable reasons. If a candidate seems to fall under an existing rejection, surface that to the user up front rather than walking the whole tree to the same dead end.
5. **Challenge against `CONTEXT.md` inline.** When the user uses a term that conflicts with the glossary, call it out immediately: *"`CONTEXT.md` defines 'cancellation' as X, but you seem to mean Y — which is it?"* When a fuzzy term gets sharpened, **update `CONTEXT.md` right there** — don't batch glossary updates to the end.
6. **Cross-reference with code.** When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: *"Your code cancels entire Orders, but you just said partial cancellation is possible — which is right?"*
7. **Propose ADRs sparingly.** Only offer to write an ADR when **all three** are true: hard to reverse, surprising without context, result of a real trade-off. If any is missing, skip — for non-ADR-worthy rejections, suggest `/sweep-issues` write a `.out-of-scope/<slug>.md` record instead. Decisions that are easy to revisit don't need an ADR — they create noise.
8. **Stop only when the user says stop or the tree is fully resolved.** Grill mode is "relentless" by design — it's how you flush out misalignment before code is written. Don't wrap up just because you've run several rounds; wrap up when the decision tree has no unresolved branches.

When `GRILL=0` (default), the existing INTERVIEW / BRAINSTORM / REVIEW question styles apply as written below.

## Mode Selection

Parse `$ARGUMENTS` for the mode. If not specified, use AskUserQuestion to ask:

1. **INTERVIEW** — You have a spec or feature idea and want to flesh it out. Deep multi-round interview to surface edge cases, tradeoffs, and non-obvious decisions. Writes the final spec.
2. **BRAINSTORM** — You have a vague idea and want to explore it. Explore user intent, requirements, and design options before committing to an approach.
3. **REVIEW** — You have a plan/spec ready and want to lock in the technical execution. Architecture, data flow, edge cases, test coverage, performance.
4. **VISUALIZE** — You have a completed spec and want to validate it visually before coding. Generates Mermaid diagrams (user flow, data flow, state machines, edge cases) to shake out bugs that prose alone misses.

Once a mode is selected, read the corresponding reference file before executing — it contains the full step-by-step procedure for that mode:

- INTERVIEW → [references/interview.md](references/interview.md)
- BRAINSTORM → [references/brainstorm.md](references/brainstorm.md)
- REVIEW → [references/review.md](references/review.md)
- VISUALIZE → [references/visualize.md](references/visualize.md)

## Gotchas

- **AskUserQuestion strict rules only apply to REVIEW mode.** In INTERVIEW and BRAINSTORM modes, questions can be open-ended and exploratory — the lettered-option/recommendation format is not required.
- **Use `origin/main` not local `main`** for all diff and log commands. Local main may be stale.
- **Spec file paths vary.** Some projects use `.claude/specs/`, others use `docs/specs/` or top-level spec files. Always check `$ARGUMENTS` first, then look for common locations.
- **VISUALIZE mode is post-spec, pre-code.** Don't run it on a half-written spec — the diagrams will be wrong and the verification useless. Run INTERVIEW or BRAINSTORM first.
- **Diagrams expose spec gaps, not code bugs.** If VISUALIZE finds issues, update the spec — don't start coding with known gaps.
