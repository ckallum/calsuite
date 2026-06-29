---
name: next-task
version: 1.0.0
description: |
  next task, what's next, what should I do next, generate the next prompt,
  hand off to the next task, kick off the next piece, should I start a new
  session or compact, prep the next task, where do I go from here.
  Figures out what was just done, picks the next task off the spec (respecting
  the dependency tree), recommends whether to carry on / compact / start a new
  session, writes a ready-to-paste execution prompt for it, and renders the
  roadmap showing what's done and where the next task sits.
argument-hint: "[spec-slug]"
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - Skill
  - AskUserQuestion
---

# Next-task: prep and hand off the next piece of work

You've just finished something. This skill produces the **three things you need to start the
next piece cleanly**:

1. A **session recommendation** — carry on, compact, or start fresh.
2. A **copy-paste execution prompt** for the next task, written to Claude Code prompting best practice.
3. A **roadmap visual** (via `/roadmap`) showing what you just did and where the next task lands.

Don't over-explain. The output is a recommendation, a prompt, and a link — not an essay.

## Arguments

- `/next-task` — infer the next task from the active spec (or the conversation if there's no spec).
- `/next-task <spec-slug>` — pull the next task from that specific spec.

## Step 1 — Establish what just happened

Read the situation from facts, not vibes:

```bash
git log --oneline -8
git status --short
git diff --stat
```

- What did the recent commits / working tree actually change? Which files, which feature?
- Find the active spec: `ls -d .claude/specs/*/ docs/specs/*/ specs/*/ 2>/dev/null` and check `SPECLOG.md`. Which tasks in `tasks.md` are now `[x]` or in `## Completed`? **Remember the directory you find** — Step 4 and the `/roadmap` call in Step 5 both reference it. (Same three locations `/roadmap` searches, so the two skills agree.)
- Is the tree clean (work committed/shipped) or dirty (mid-task)? This drives the session call in Step 3.

## Step 2 — Pick the next task

From the active spec's `tasks.md`, choose the next task using the **dependency tree**:

- The next task is an **open** task whose dependencies are all **done** (ready to start). Parse the optional `**ID** … — deps: …` annotations; without them, infer from phase order (finish phase N before phase N+1; tasks within a phase are parallel).
- If several are ready, prefer the one on the **critical path** (the longest dependency chain to the end). Surface up to 2 alternates the user could parallelise instead.
- **No spec?** Derive the next task from open GitHub issues, `TODO`/`FIXME`, or the conversation's stated direction. Say where it came from.
- If the next task is genuinely ambiguous, use `AskUserQuestion` to confirm which to tee up — don't guess silently.

## Step 3 — Recommend a session strategy

Weigh these signals, then make **one** call with a one-line reason:

| Signal | Pushes toward |
|---|---|
| Next task shares files / feature / mental model with what you just did | **Carry on** |
| Context still has headroom (early-ish session, modest tool-call count) | **Carry on** |
| Same thread continues, but the session is long / tool-call-heavy and most loaded context is now stale exploration | **Compact** |
| Durable state lives in committed code + spec, not the conversation | **Compact** or **New session** |
| Next task is a distinct unit — new phase, different subsystem, independent graph node | **New session** |
| Current work is committed and the tree is clean | **New session** |

The three outcomes:

- **Carry on** — keep going in this session. Restarting would re-pay the cost of rebuilding context you still hold. Output the tighter prompt from Step 4 and just proceed.
- **Compact** — `/compact` (or accept the `/strategic-compact` suggestion if it's pending) to shed stale context while keeping the thread, then continue. Use when the next task continues this work but the transcript is bloated.
- **New session** — start clean with the standalone prompt from Step 4 (optionally `/session-start` first to load project context). Use when the next task is independent and current work is banked.

If a `/strategic-compact` suggestion has already surfaced earlier in this session, treat it as concrete evidence of context pressure when deciding between Carry on and Compact. There's no live counter you can query mid-session — react only to a suggestion that actually appeared in the transcript.

## Step 4 — Write the execution prompt

Generate a prompt the user can paste to start the next task. Follow Claude Code prompting best practice: **explicit, specific, motivated, with files and a finish line.** Structure:

```text
**Task:** <one-line imperative — what to build>

**Why / context:** <1–2 lines: what this builds on, why it matters now>

**Relevant files & spec:**
- <spec-dir>/{requirements,design,tasks}.md  (Task <ID>) — substitute the real spec directory located in Step 1 (`.claude/specs/`, `docs/specs/`, or `specs/`); never emit a hardcoded path that may not exist
- <key source paths the task touches>

**Do:**
- <concrete steps, or: "Run /execute spec <slug>" to work the next task with full compliance review>
- Respect docs/adr/ and CONTEXT.md vocabulary if present.

**Constraints:** <what NOT to touch; invariants; scope edges>

**Done when:** <acceptance criteria> — then /verify, then /ship.
```

Tailor it to the Step 3 call:
- **New session** → make it **fully standalone**. The new session has no memory of this one: spell out the context, paths, and acceptance criteria so it stands alone.
- **Carry on / Compact** → tighter is fine; reference what's already loaded, but still name the task, files, and finish line.

Lean on existing skills rather than re-deriving: `/execute` to implement, `/verify` before PR, `/ship` to land. Don't pad the prompt with motivational filler — best-practice prompts are concrete, not verbose.

## Step 5 — Render the roadmap visual

Invoke the `/roadmap` skill (pass the spec slug if you have one) to (re)generate `docs/roadmap/`. It shows the just-finished work and where the next task sits in the dependency tree (critical path, what's parallelisable). Reference the produced file in your output; if `roadmap` renders an inline preview, let it.

## Step 6 — Present

Output, in this order, nothing more:

1. **Recommendation:** `Carry on` / `Compact` / `New session` — one-line reason.
2. **Next task:** the chosen task (+ alternates if any), and its place on the critical path.
3. **Prompt:** the Step 4 prompt in a fenced block, ready to copy.
4. **Roadmap:** path to `docs/roadmap/roadmap.html` (and the inline preview if shown).

## Gotchas

- **One recommendation, not a menu.** Make the call and give the reason. Offer the other options only if it's genuinely a coin-flip.
- **Don't start coding.** This skill preps the next task; it doesn't execute it. The prompt is the handoff. (Exception: on a clear "carry on", you may proceed straight into the work after presenting.)
- **Standalone prompts must actually stand alone.** The most common failure is a "new session" prompt that references "the bug we just fixed" — the new session can't see it. Inline the context.
- **Status is read, never written.** Don't tick tasks in `tasks.md` here. Pull state; let `/execute` and `@doc-updater` record progress.
