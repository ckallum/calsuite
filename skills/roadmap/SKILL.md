---
name: roadmap
version: 1.0.0
description: |
  roadmap, show the roadmap, update the roadmap, where are we, project map,
  what's done and what's next, dependency tree, critical path, spec roadmap,
  visualise the plan, render the roadmap, generate roadmap.html.
  Creates or updates a self-contained docs/roadmap/*.html from the project's
  spec(s): what's finished, what's next, and the dependency tree — critical
  path, sequential, and parallelisable work. Multi-spec aware.
argument-hint: "[spec-slug]"
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - mcp__visualize__show_widget
  - mcp__visualize__read_me
---

# Roadmap: render where we are and what's next

Build (or refresh) a **self-contained HTML roadmap** at `docs/roadmap/` from the project's
spec(s). It shows finished work, the next actionable tasks, and the dependency tree —
**critical path**, **sequential** chains, and **parallelisable** work — so the plan is
something you glance at, not a wall of task text.

This skill is invoked two ways:
- **Ad-hoc** — "show me the roadmap", "where are we" → parse the current spec state and re-render.
- **From `/next-task`** — to produce the "what we just did / where the next task lies" visual.

## Arguments

- `/roadmap` — render every spec found. Single spec → `docs/roadmap/roadmap.html`. Multiple specs → a cross-spec `spec_roadmap.html` plus one `{spec_name}_roadmap.html` each, and `roadmap.html` as the index.
- `/roadmap <spec-slug>` — render (or refresh) just that spec's `{spec_name}_roadmap.html`.

## Output files (`docs/roadmap/`)

| Situation | Files written |
|---|---|
| One spec (or none) | `roadmap.html` — the roadmap itself |
| Multiple specs | `spec_roadmap.html` (portfolio: specs as nodes, inter-spec deps, which spec is on the critical path) · `{spec_name}_roadmap.html` per spec (in-spec phase/task tree) · `roadmap.html` (thin index linking to all of them) |

Always create `docs/roadmap/` if it's missing. Never delete a `{spec_name}_roadmap.html` for a spec that still exists.

## Step 1 — Locate the spec(s)

Spec paths vary by project. Look in this order and use the first that has specs:

```bash
ls -d .claude/specs/*/ docs/specs/*/ specs/*/ 2>/dev/null
```

Also read `SPECLOG.md` if present — it indexes specs and their status. If `$ARGUMENTS` names a slug, target only that spec. **If no specs exist anywhere**, fall back to a freeform roadmap built from open GitHub issues / `TODO`s / the conversation, and tell the user there's no spec to anchor to (offer `/new-spec <slug>`).

## Step 2 — Parse `tasks.md` into a task graph

For each spec, read `tasks.md` and extract every task as a node:

- **Phase** — the `## Phase N: …` header the task sits under.
- **Status** — `[x]` or under `## Completed` → **done**; under `## Blocked` → **blocked**; `[ ]` otherwise → **open**.
- **ID + deps** — the optional convention: a bold `**ID**` and a trailing `— deps: A, B`. (See the `tasks.md` template.) If a task has no `**ID**`, assign `P{phase}.{n}`.
- **Label** — the task text with the ID/deps stripped.

Also read `requirements.md` / `design.md` only if you need a one-line spec summary for the header — don't dump them.

## Step 3 — Build the dependency tree (hybrid model)

- **Explicit deps win.** If a task declares `deps:`, draw an edge from each dependency to it.
- **Otherwise infer from phases.** Phases run in sequence; tasks within a phase run in parallel. So an un-annotated phase is a band of parallel siblings, gated by the previous phase completing. Don't draw N×M edges for this — represent it as the phase ordering (bands top-to-bottom), not a hairball.
- **Derive the three classes:**
  - **Critical path** — the longest dependency chain to the final task(s). Highlight its nodes and edges in the accent colour. With only phase inference, it's one representative task per phase, chained.
  - **Parallelisable** — open tasks with no dependency path between them and all deps satisfied. These are the ones that could be picked up concurrently *right now*; badge them.
  - **Sequential** — a chain where each task waits on the previous.
- **Resolve "you are here":** the **next** tasks are open tasks whose deps are all done (ready to start). Mark them distinctly from blocked/not-yet-ready tasks.

## Step 4 — Render the HTML

Write a **single self-contained file** — no external scripts, fonts, or CDNs, so it opens offline and survives in the repo. Inline CSS + inline SVG for the dependency graph. It must adapt to light/dark via `prefers-color-scheme`. Use this skeleton (fill the marked regions; keep the token palette):

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{Project} — Roadmap</title>
<style>
  :root{
    --bg:#fff; --panel:#f6f7f9; --text:#1a1a1a; --muted:#6b7280; --border:#e5e7eb;
    --done:#16a34a; --next:#2563eb; --blocked:#dc2626; --todo:#9ca3af; --crit:#f59e0b;
  }
  @media (prefers-color-scheme:dark){
    :root{ --bg:#0d1117; --panel:#161b22; --text:#e6edf3; --muted:#8b949e; --border:#30363d;
           --done:#3fb950; --next:#58a6ff; --blocked:#f85149; --todo:#6e7681; --crit:#d29922; }
  }
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);
    font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:32px}
  h1{font-size:22px;margin:0 0 4px} .sub{color:var(--muted);margin:0 0 20px}
  .bar{height:10px;border-radius:6px;background:var(--border);overflow:hidden;margin:8px 0 24px}
  .bar > i{display:block;height:100%;background:var(--done)}
  .legend{display:flex;gap:16px;flex-wrap:wrap;color:var(--muted);font-size:13px;margin-bottom:20px}
  .legend b{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:middle}
  .phase{margin:0 0 18px;padding:16px;background:var(--panel);border:1px solid var(--border);border-radius:12px}
  .phase h2{font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:0 0 12px}
  .cards{display:flex;gap:12px;flex-wrap:wrap}
  .card{flex:1 1 220px;min-width:200px;border:1px solid var(--border);border-left:4px solid var(--todo);
    border-radius:10px;padding:12px;background:var(--bg)}
  .card.done{border-left-color:var(--done)} .card.next{border-left-color:var(--next)}
  .card.blocked{border-left-color:var(--blocked)} .card.crit{box-shadow:0 0 0 2px var(--crit) inset}
  .card .id{font:12px ui-monospace,monospace;color:var(--muted)}
  .card .t{margin:4px 0} .badge{font-size:11px;color:var(--muted)}
  svg .edge{stroke:var(--border);stroke-width:2;fill:none;marker-end:url(#a)}
  svg .edge.crit{stroke:var(--crit)} svg text{fill:var(--text);font-size:12px}
</style>
</head>
<body>
  <h1>{Project} — Roadmap</h1>
  <p class="sub">{spec summary} · updated {YYYY-MM-DD} · {done}/{total} tasks complete</p>
  <div class="bar"><i style="width:{pct}%"></i></div>
  <div class="legend">
    <span><b style="background:var(--done)"></b>Done</span>
    <span><b style="background:var(--next)"></b>Next (ready)</span>
    <span><b style="background:var(--todo)"></b>Not yet</span>
    <span><b style="background:var(--blocked)"></b>Blocked</span>
    <span><b style="background:var(--crit)"></b>Critical path</span>
  </div>

  <!-- DEPENDENCY GRAPH: inline SVG, viewBox sized to content. Nodes positioned
       by phase (left→right or top→bottom). Critical-path nodes/edges use class="crit".
       Include <defs><marker id="a">…</marker></defs> for arrowheads. Omit the SVG
       entirely if the only structure is phase order with no explicit deps — the
       phase cards below already convey it. -->
  {svg-or-omit}

  <!-- PHASE CARDS: one .phase per phase, .card per task with the right status class.
       Add class="crit" to critical-path tasks. Show **next** tasks first within a phase. -->
  {phase-sections}
</body>
</html>
```

Render rules:
- Pass the date in (don't call `date` from a sandbox that forbids it — read it from `git log -1 --format=%cd --date=short` or the latest commit).
- Keep node labels ≤6 words; the full task text lives in the card, not the SVG node.
- If a spec has only phase-order structure (no explicit deps), **skip the SVG** — the phase cards already show the sequence. The graph earns its place only when there are real cross-task edges.
- For the **multi-spec `spec_roadmap.html`**, nodes are specs (status = % complete), edges are inter-spec deps (from `design.md` "Dependencies" or SPECLOG), and the critical path is the longest spec chain.

## Step 5 — Show it and report

1. Write the file(s) and print the path(s): `docs/roadmap/roadmap.html`.
2. Offer to open it: `open docs/roadmap/roadmap.html` (macOS) — don't run it unprompted.
3. If `show_widget` is available and the user is in an interactive chat, render a **compact inline preview** (progress bar + the next-up tasks + critical path) so they see it without leaving the terminal. Follow the widget theming rules (CSS variables, transparent background) — call `mcp__visualize__read_me` first if unsure.
4. End with a two-line summary: **Done** (last finished phase/tasks) and **Next** (the ready tasks, critical-path one first). Keep it short — the visual is the deliverable.

## Gotchas

- **Self-contained only.** No `<script src>`, no web fonts, no CDN. The file lives in the repo and must open with a double-click, offline, years later.
- **Idempotent.** Re-rendering overwrites the roadmap file in place. Preserve any sibling files the user added to `docs/roadmap/`.
- **Don't invent tasks or dates.** Status comes from `tasks.md` checkboxes and the Completed/Blocked sections, nothing else. If `tasks.md` is empty or all-template, say so rather than rendering a fake roadmap.
- **Don't modify the spec.** This skill reads specs and writes HTML; it never edits `tasks.md`. (That's `/execute` and `@doc-updater`.)
- **Naming is load-bearing.** Single spec → `roadmap.html`. Multiple → `spec_roadmap.html` + `{spec_name}_roadmap.html` + index. Match exactly so `/next-task` and links stay stable.
