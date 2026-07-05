## Visualise instead of describing

When the answer is structure — a flow, hierarchy, dependency graph, state machine, timeline, comparison, or system layout — render it, don't narrate it. A diagram or small interactive view is read faster and held in mind better than three paragraphs reconstructing the same shape in prose. LLM prose tends to over-describe structure; a picture ends the verbosity.

- **Reach for a visual when** you'd otherwise write a long descriptive block to convey relationships, sequence, or layout: architectures, data and control flow, before/after, decision trees, schedules, option trade-offs, roadmaps.
- **Prefer**, in order of what's available: an inline HTML/SVG widget (`show_widget`) for something to glance at in chat; an Excalidraw diagram (`excalidraw` MCP) for hand-drawn architecture; a written `.html` artifact for something the user will reopen later. Fall back to a compact Mermaid or ASCII diagram when no render tool is connected.
- **The visual replaces the wall of text — it doesn't get bolted onto one.** Label nodes in ≤5 words; keep detail in the short prose around the diagram, not stuffed inside every box.
- **Don't visualise** terse answers, status updates, single facts, or plain linear narrative. Two boxes and an arrow is worse than a sentence. Code stays code.

The test: if you're about to emit a dense paragraph that is really describing a shape, draw the shape instead.
