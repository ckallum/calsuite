# Plan-CEO Section Templates

The verbatim ASCII templates for `/plan-ceo`. SKILL.md keeps each section's review prompts and STOP rules inline and links here for the shapes to fill in: diagrams, tables, the Failure Modes Registry, and the Completion Summary. Reproduce each block exactly when producing the corresponding section.

---

## Step 0C: Dream State Mapping

```text
  CURRENT STATE                  THIS PLAN                  12-MONTH IDEAL
  [describe]          --->       [describe delta]    --->    [describe target]
```

---

## Section 2: Error Map

```text
  METHOD/CODEPATH          | WHAT CAN GO WRONG           | ERROR TYPE
  -------------------------|-----------------------------|-----------------
  POST /api/foo            | Auth failure                | 401 Unauthorized
                           | Resource not found          | 404 Not Found
                           | DB constraint violation     | 409 Conflict
                           | Query error                 | 500 Internal
```

---

## Section 4: Data Flow & Interaction Edge Cases

Data flow (trace all four paths per new flow):

```text
  INPUT --> VALIDATION --> TRANSFORM --> PERSIST --> OUTPUT
    |            |              |            |           |
    v            v              v            v           v
  [nil?]    [invalid?]    [exception?]  [conflict?]  [stale?]
  [empty?]  [too long?]   [timeout?]    [dup key?]   [partial?]
```

Interaction edge cases (per new user-visible interaction):

```text
  INTERACTION          | EDGE CASE              | HANDLED?
  ---------------------|------------------------|----------
  Form submission      | Double-click submit    | ?
  Async operation      | User navigates away    | ?
  List/table view      | Zero results           | ?
                       | 10,000 results         | ?
  Background job       | Job fails mid-batch    | ?
                       | Job runs twice (dup)   | ?
```

---

## Section 6: Test Review

```text
  NEW UX FLOWS:        [list each]
  NEW API ROUTES:      [list each]
  NEW DATA FLOWS:      [list each]
  NEW BACKGROUND JOBS: [list each]
  NEW ERROR PATHS:     [list each, cross-reference Section 2]
```

---

## Required Output: Failure Modes Registry

```text
  CODEPATH | FAILURE MODE   | HANDLED? | TEST? | USER SEES?     | LOGGED?
```

Any row with HANDLED=N, TEST=N, USER SEES=Silent -> **CRITICAL GAP**.

---

## Required Output: Completion Summary

```text
  +====================================================================+
  |            CEO PLAN REVIEW — COMPLETION SUMMARY                     |
  +====================================================================+
  | Mode selected        | EXPANSION / HOLD / REDUCTION                |
  | Section 1  (Arch)    | ___ issues found                            |
  | Section 2  (Errors)  | ___ error paths mapped, ___ GAPS            |
  | Section 3  (Security)| ___ issues found                            |
  | Section 4  (Data/UX) | ___ edge cases mapped, ___ unhandled        |
  | Section 5  (Quality) | ___ issues found                            |
  | Section 6  (Tests)   | Diagram produced, ___ gaps                  |
  | Section 7  (Perf)    | ___ issues found                            |
  | Section 8  (Observ)  | ___ gaps found                              |
  | Section 9  (Deploy)  | ___ risks flagged                           |
  | Section 10 (Future)  | Reversibility: _/5, debt items: ___         |
  | TODO.md updates      | ___ items proposed                          |
  | Diagrams produced    | ___ (list types)                            |
  | Unresolved decisions | ___                                         |
  +====================================================================+
```
