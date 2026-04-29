# ADR-{NNNN}: {Short imperative title — verb-led}

**Status:** {Proposed | Accepted | Superseded by ADR-NNNN | Deprecated}
**Date:** YYYY-MM-DD

## Context

{What's the situation that forces a decision? What constraints, requirements, or pre-existing facts shape the choice? 2-5 sentences.}

## Decision

{What did we decide. State it clearly and unambiguously in 1-3 sentences.}

## Consequences

**Positive:**
- {What gets easier or possible}

**Negative:**
- {What gets harder or impossible}

**Neutral:**
- {Tradeoffs that aren't strictly good or bad — facts the future reader needs}

## Alternatives considered

- **{Alternative 1}** — rejected because {specific reason}
- **{Alternative 2}** — rejected because {specific reason}

---

## When to write an ADR

Only when **all three** are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful (data migrations, breaking API changes, retraining the team).
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **Result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons.

If any of the three is missing, skip the ADR. Most decisions don't need one — over-stuffed ADR directories become noise. The skills (`/plan`, `/plan --grill`, `/execute`, `/improve-architecture`) offer to write an ADR only when the conversation surfaces a decision that meets all three criteria.

## Conventions

- **Filename:** `NNNN-kebab-title.md` — zero-padded sequential, lowercase. Examples: `0001-event-sourced-orders.md`, `0014-postgres-for-write-model.md`.
- **Title:** verb-led ("use Postgres for writes", "split sessions by tenant"), not noun-led ("Postgres choice").
- **Immutable once accepted.** When a decision changes, write a new ADR that supersedes the old one (`Status: Superseded by ADR-NNNN`). Don't rewrite history.
- **Single-context repos** keep ADRs at `docs/adr/`.
- **Multi-context repos** keep system-wide ADRs at `docs/adr/` and per-context ADRs at `<context>/docs/adr/`.
