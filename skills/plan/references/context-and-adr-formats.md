# CONTEXT.md and ADR formats

## `CONTEXT.md` format (write inline as terms resolve)

```md
# {Context Name}

{One or two sentence description of what this context is and why it exists.}

## Language

**{Term}**:
{One-sentence definition. What it IS, not what it does.}
_Avoid_: {alias 1}, {alias 2}

## Relationships

- A **{Term A}** {verb} one or more **{Term B}**

## Example dialogue

> **Dev:** "When a **Customer** places an **Order**…"
> **Domain expert:** "An **Invoice** is only generated once a **Fulfillment** is confirmed."

## Flagged ambiguities

- "{ambiguous term}" was used to mean both **{Term A}** and **{Term B}** — resolved: distinct concepts.
```

Be opinionated (one canonical word per concept; aliases under `_Avoid_`). Domain-only — general programming concepts don't belong. One-sentence definitions. Multi-context repos use `CONTEXT-MAP.md` at root pointing to per-module `CONTEXT.md` files.

## ADR format (write at `docs/adr/NNNN-kebab-title.md`)

```md
# ADR-{NNNN}: {Verb-led title}

**Status:** Accepted
**Date:** YYYY-MM-DD

## Context
{What forced the decision. 2-5 sentences.}

## Decision
{What we decided.}

## Consequences
**Positive:** {what gets easier}
**Negative:** {what gets harder}

## Alternatives considered
- **{Alternative}** — rejected because {specific reason}
```

Filename `NNNN-kebab-title.md` (zero-padded sequential). Verb-led titles. **Immutable once accepted** — when a decision changes, write a new ADR with `Status: Superseded by ADR-NNNN` rather than editing in place.
