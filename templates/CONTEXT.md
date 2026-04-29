# {Context Name}

{One or two sentence description of what this context is and why it exists.}

## Language

**{Term}**:
{One-sentence definition. What it IS, not what it does.}
_Avoid_: {alias 1}, {alias 2}

**{Term}**:
{One-sentence definition.}
_Avoid_: {alias 1}, {alias 2}

## Relationships

- A **{Term A}** {verb} one or more **{Term B}**
- A **{Term B}** belongs to exactly one **{Term C}**

## Example dialogue

> **Dev:** "When a **Customer** places an **Order**, do we create the **Invoice** immediately?"
> **Domain expert:** "No — an **Invoice** is only generated once a **Fulfillment** is confirmed."

## Flagged ambiguities

- "{ambiguous term}" was used to mean both **{Term A}** and **{Term B}** — resolved: these are distinct concepts.

---

## How to maintain this file

`CONTEXT.md` is the project's domain glossary. Two groups of skills interact with it:

**Read-only (use the vocabulary, don't edit):** `/zoom-out`, `/review`, `/debug` — these read CONTEXT.md to use its vocabulary verbatim in their output, but never modify it.

**Read-and-update (write inline as terms resolve):** `/plan` (especially `/plan --grill`), `/execute`, `/improve-architecture` — these read CONTEXT.md and update it inline when a new term is resolved or a fuzzy term is sharpened during the work.

**Rules**:

- **Be opinionated.** When multiple words exist for the same concept, pick one and list the rest as aliases under `_Avoid_`.
- **Flag conflicts explicitly.** If a term is used ambiguously, call it out in "Flagged ambiguities" with a clear resolution.
- **Keep definitions tight.** One sentence max. Define what it IS, not what it does.
- **Show relationships.** Bold term names; express cardinality where obvious.
- **Domain only, not infrastructure.** General programming concepts (timeouts, retries, error types, utility patterns) don't belong even if the project uses them. Only terms unique to this project's *domain*.
- **Group under subheadings** when natural clusters emerge. If everything fits in one cohesive area, a flat list is fine.
- **Write an example dialogue.** A short conversation between a dev and a domain expert that uses the terms naturally and demonstrates the boundaries between related concepts.

**Lazy creation:** create this file only when the first term is actually resolved. Don't scaffold it empty.

**Multi-context repos** keep a `CONTEXT-MAP.md` at the root that points to each context's `CONTEXT.md`. Format:

```md
# Context Map

## Contexts

- [Ordering](./src/ordering/CONTEXT.md) — receives and tracks customer orders
- [Billing](./src/billing/CONTEXT.md) — generates invoices and processes payments

## Relationships

- **Ordering → Billing**: Ordering emits `OrderPlaced`; Billing consumes it to generate invoices
- **Ordering ↔ Billing**: Shared types for `CustomerId` and `Money`
```
