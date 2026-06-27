# Review agent prompts

Verbatim prompt bodies for the nine parallel review agents dispatched by Step 3 of SKILL.md. The dispatch logic (signal gates, ordering, conditional fires) stays in SKILL.md — this file holds only the prompt strings each agent receives.

## Agent A: Convention review (@code-reviewer)

```text
prompt: "You are the @code-reviewer agent. Review the diff between origin/main and HEAD.

Follow the full code-reviewer workflow:
1. Run: git diff origin/main, git diff origin/main --name-only
2. Read all CLAUDE.md files in the repo
3. If .claude/specs/ exists, detect active spec from branch name
4. For each changed file, read 1-2 sibling files for pattern context
5. Run the review checklist: convention compliance, secrets, debug artifacts,
   dead code, error handling, spec alignment, pattern consistency, security

Produce your standard findings list with file:line references and severity
(critical/warning/info). Do NOT write any review stamp file.
Return findings only."
description: "Convention review (@code-reviewer)"
```

## Agent B: Checklist review (security + structural)

```text
prompt: "Run a pre-landing code review on the diff between origin/main and HEAD.
Run `git diff origin/main` to get the full diff. Read the checklist at
.claude/skills/review/checklist.md. Apply the two-pass review:

Pass 1 (CRITICAL): SQL & Data Safety, Race Conditions & Concurrency,
LLM Output Trust Boundary, Auth & Security Boundaries.
Pass 2 (INFORMATIONAL): All remaining categories.
Signal-gated passes: read the 'Signal-Gated Passes' section of the checklist.
Run the versioned-struct pass ONLY if the diff matches the signals listed there
(const *_VERSION, struct field `version:`, or TS `version: number` on serialized types).

Respect the Suppressions section — do NOT flag items listed there.
Read the FULL diff before flagging anything.

Output format: 'Checklist Review: N issues (X critical, Y informational)'
followed by findings with file:line references and suggested fixes.
Categorize each as CRITICAL or INFORMATIONAL."
description: "Checklist review (security + structural)"
```

## Agent C: Git blame & history review

```text
prompt: "Review the changes between origin/main and HEAD using git history context.

1. Run `git diff origin/main --name-only` to get changed files.
2. For each changed file, run `git log --oneline -10 -- <file>` and
   `git blame -L <changed-lines> -- <file>` to understand the history.
3. Look for:
   - Code that was recently refactored and is being changed again (churn = risk)
   - Patterns that were deliberately established by previous commits
   - Bug fixes being undone or weakened by the current changes
   - TODO/FIXME/HACK comments in blamed lines that are relevant

Return a list of findings with file:line references. For each, include the
relevant git history context (commit hash + message) that makes it a concern.
Only flag issues where history provides insight — skip if history is clean."
description: "Git blame & history review"
```

## Agent D: Previous PR comment review

```text
prompt: "Check if previous PRs that touched these files had review comments
that may also apply to the current changes.

1. Run `git diff origin/main --name-only` to get changed files.
2. For each file (max 5), run:
   `gh pr list --state merged --search <filename> --limit 3 --json number`
3. For each found PR, fetch review comments:
   `gh api repos/{owner}/{repo}/pulls/<number>/comments --jq '.[] | select(.path == \"<file>\") | {body: .body, line: .line}'`
4. Check if any previous review comments apply to the current changes
   (same patterns, same concerns, same files).

Return findings only if previous comments are genuinely relevant to the
current diff. Skip stale or inapplicable comments."
description: "Previous PR comment review"
```

## Agent E: Code comment compliance

```text
prompt: "Check that the changes between origin/main and HEAD comply with
code comments in the modified files.

1. Run `git diff origin/main --name-only` to get changed files.
2. For each changed file, read the full file and identify:
   - TODO/FIXME/HACK comments near changed lines
   - Docstrings or inline comments that describe expected behavior
   - Warning comments (e.g., 'DO NOT MODIFY', 'must be called before X')
3. Verify the changes don't violate any of these documented constraints.

Return findings with file:line references. Only flag genuine violations —
not stale comments about unrelated code."
description: "Code comment compliance"
```

## Agent F: Silent failure hunter (signal-gated: `$F_COUNT > 0`)

Only dispatch if `$F_COUNT > 0` from the gate grep above (diff contains `catch`, `.catch`, `fallback`, `onError`, or `Result<`).

```text
prompt: "Hunt for silent failures in the target diff for this review.

Use the same diff source selected in Step 1:
- local mode: `git diff origin/main`
- PR mode: the `gh pr diff <number>` output already fetched
For every error-handling location in the changed code, scrutinize:

1. **Catch block specificity:** Does it catch only expected errors, or could
   it accidentally suppress unrelated errors? List every unexpected error type
   that could be hidden.
2. **Logging quality:** Is the error logged with enough context to debug
   6 months from now? Does it include what operation failed and relevant IDs?
3. **User feedback:** Does the user receive actionable feedback, or does the
   error vanish silently?
4. **Fallback behavior:** Is fallback logic explicitly justified, or does it
   mask the underlying problem? Would the user be confused by fallback behavior?
5. **Error propagation:** Should this error bubble up instead of being caught here?

Flag these patterns as CRITICAL:
- Empty catch blocks
- Catch blocks that only log and continue without user feedback
- Returning null/undefined/default on error without logging
- Broad exception catching that hides unrelated errors
- Retry logic that exhausts attempts without informing the user

Return findings with file:line, severity (CRITICAL/HIGH/MEDIUM),
issue description, hidden error types, and recommended fix."
description: "Silent failure hunter"
```

## Agent G: Type design review (signal-gated: `$G_COUNT > 0`)

Only dispatch if `$G_COUNT > 0` from the gate grep above (diff introduces or modifies `interface`, `type`, `enum`, `class`, or `struct`).

```text
prompt: "Review type design in the target diff for this review.

Use the same diff source selected in Step 1:
- local mode: `git diff origin/main`
- PR mode: the `gh pr diff <number>` output already fetched
Find new or modified type definitions
(interfaces, types, enums, classes, structs).

For each new or significantly modified type, evaluate:

1. **Invariant expression:** Are constraints obvious from the type definition?
   Can illegal states be represented? Rate 1-10.
2. **Encapsulation:** Are internals properly hidden? Can invariants be
   violated from outside? Rate 1-10.
3. **Enforcement:** Are invariants checked at construction? Are all mutation
   points guarded? Rate 1-10.
4. **Usefulness:** Do the invariants prevent real bugs? Are they aligned
   with business requirements? Rate 1-10.

Flag these anti-patterns:
- Anemic types with no behavior or validation
- Types exposing mutable internals
- Invariants enforced only through documentation/comments
- Missing validation at construction boundaries
- Types that rely on external code to maintain invariants

Return findings with file:line, the type name, ratings, and specific
improvement suggestions. Keep suggestions pragmatic — don't overcomplicate."
description: "Type design review"
```

## Agent H: Cross-module format consistency (signal-gated: `$H_COUNT > 0`)

Only dispatch if `$H_COUNT > 0` — the diff touches Rust, TypeScript/JavaScript, Python, Go, or SQL. The agent greps the **whole module** around each changed file — not just the diff — for consistency contracts and flags any mismatches.

```text
prompt: "Hunt for cross-module format-consistency drift in the target diff.

Use the same diff source selected in Step 1:
- local mode: git diff origin/main
- PR mode: the gh pr diff <number> output already fetched

1. Run `git diff origin/main --name-only` to get the changed files.
2. For each changed file, determine its module — the nearest enclosing directory
   that groups related files (e.g. `src-tauri/src/db/` for Rust, `src/features/foo/`
   for TS, `app/models/` for Ruby). Read every file in that module, not just the
   changed ones.
3. For each module, scan for these consistency contracts and flag mismatches:

   **Datetime writers (Rust / TS / JS / Python / Go / SQL).**
     - Rust: `datetime\\('now'\\)` vs `Utc::now\\(\\)` vs `chrono::Utc::now\\(\\)\\.to_rfc3339\\(\\)` vs `SystemTime::now\\(\\)`
     - TS/JS: `new Date\\(\\)\\.toISOString\\(\\)` vs `Date\\.now\\(\\)` vs `dayjs\\(\\)\\.format\\(` vs raw `Date\\(\\)`
     - Python: `datetime\\.utcnow\\(\\)` vs `datetime\\.now\\(tz=` vs `time\\.time\\(\\)`
     - SQL: `datetime\\('now'\\)` vs `CURRENT_TIMESTAMP` vs `NOW\\(\\)`
     If a single module writes timestamps using 2+ different functions, flag as CRITICAL — the serialized formats will diverge.

   **SQL ORDER BY directions.** Grep for the same column appearing in `ORDER BY <col> ASC` and `ORDER BY <col> DESC` within one module — if two handlers sort the same column differently, results will be inconsistent.

   **Serialization drift.** Grep for the same identifier written both snake_case and camelCase within one module (e.g. `created_at` and `createdAt` appearing on the same struct's serde attributes). Flag as CRITICAL — this causes silent deserialize failures.

4. Return findings with file:line, the inconsistent values found, and which
   module boundary they fall within. Only flag genuine mismatches — skip cases
   where different formats are intentional (e.g. a TS/serde boundary where
   snake↔camel is expected)."
description: "Cross-module format consistency"
```

## Agent I: Spec-contract deviation (signal-gated: `$SPEC_DIR` non-empty)

Only dispatch if `$SPEC_DIR` is non-empty — i.e. the branch name, with standard feature-branch prefixes (`feat/`, `fix/`, `chore/`, `refactor/`, `feature/`) stripped, matches a spec directory under `.claude/specs/` **exactly**. There is no fallback to "first spec under `.claude/specs/`"; for issue-driven branches (e.g. `claude/<task>`) that would grab an unrelated spec and review against the wrong contract. If there's no exact match, `$SPEC_DIR` stays empty and this agent is skipped.

```text
prompt: "Check the diff for deviations from the spec contract.

1. Read $SPEC_DIR/design.md and $SPEC_DIR/tasks.md — these are the contract.
2. Run `git diff origin/main` (or the PR diff) to see what was built.
3. For each top-level item in design.md (new components, APIs, data flows, event names,
   field names) and each task in tasks.md:
   - Is it delivered in the diff? If a design.md bullet names a specific symbol,
     field, or event, grep the diff for it.
   - Is there extra work in the diff not covered by any spec item?

Flag two classes of deviation:
  - MISSING: spec promises it, diff doesn't deliver it.
  - EXTRA: diff builds it, spec doesn't describe it.

For each deviation, return:
  [file:line or spec-section] <deviation description>
  Recommendation: either (A) remediate — bring the diff back to the spec, or
                         (B) update spec — strikethrough the old bullet in
                             design.md/tasks.md and add an addendum describing
                             the current implementation path.
  Include the one-sentence reasoning for which option fits better.

Skip deviations that are obviously trivial (renaming a helper, moving a file).
Focus on behavioral contract: commands the system accepts, events it emits,
data shape it persists, failure modes it handles."
description: "Spec-contract deviation"
```

## Agent J: Correctness & logic bugs (signal-gated: `$H_COUNT > 0`)

Only dispatch if `$H_COUNT > 0` — the diff touches source (Rust, TS/JS, Python, Go, or SQL). This is the bug-hunting lens (the `/code-review` correctness half): general functional defects that the security checklist (SQL/race/auth) and the silent-failure pass (error handling) do not cover.

```text
prompt: "Hunt for correctness and logic bugs in the target diff for this review — defects that make the code do the wrong thing. This is distinct from the security checklist (SQL/race/auth) and the silent-failure pass (error handling); do not re-report those.

Use the same diff source selected in Step 1:
- local mode: `git diff origin/main`
- PR mode: the `gh pr diff <number>` output already fetched

Read enough surrounding context to judge intent, then for the changed lines look for:

1. **Boundary & off-by-one:** loop bounds, slice/substring indices, `<` vs `<=`, fencepost errors, empty-collection and single-element edge cases.
2. **Null / undefined / option handling:** dereferences that can be null, missing guards, unwrap on a value that can be absent, a default that silently masks a real miss.
3. **Wrong operator or value:** inverted conditionals, `&&` vs `||`, `=` vs `==`, the wrong variable used, sign errors, unit/scale mismatches.
4. **Control flow:** missing early return/break/continue, unreachable code, unintended fall-through, a branch that can never be taken, a `return` inside a loop that should sit after it.
5. **Async & concurrency:** missing `await`, an unhandled promise, mutation of shared state across an await point, ordering assumptions that don't hold.
6. **API / contract misuse:** wrong argument order, ignoring a returned error/Result, mutating an argument the caller still uses, returning an off-contract shape.
7. **State & resource:** a leaked file/handle/connection, state not reset between iterations, cache/key collisions, a stale read after a write.

Only flag a defect you can name a concrete triggering input or scenario for — 'given Y, this produces wrong behavior X'. Do NOT flag style, naming, or 'could be cleaner' items — that is Agent K's job. Pre-existing bugs outside the diff are out of scope unless the diff newly depends on them.

Return findings with file:line, the triggering scenario, the wrong behavior it causes, severity (CRITICAL/HIGH/MEDIUM), and the fix."
description: "Correctness & logic bugs"
```

## Agent K: Reuse & simplification (signal-gated: `$H_COUNT > 0`)

Only dispatch if `$H_COUNT > 0` — the diff touches source. This is the quality lens (the `/simplify` analysis in report-only form): it finds cleanups but **does not apply them** — findings flow through the same confidence scoring as every other agent, so a high-confidence one can block.

```text
prompt: "Review the target diff for reuse, simplification, efficiency, and altitude cleanups. Quality only — do NOT hunt for correctness bugs (that is Agent J).

Use the same diff source selected in Step 1:
- local mode: `git diff origin/main`
- PR mode: the `gh pr diff <number>` output already fetched

For the changed code, look for:

1. **Duplication / reuse:** logic the diff copy-pastes from elsewhere in the diff or the surrounding module when a helper already covers it — grep the module to confirm the reusable function exists before flagging.
2. **Over-abstraction:** indirection, wrappers, or parameters that add no value — a one-call helper, an interface with a single implementer, a config flag never varied, a layer that only forwards.
3. **Dead weight:** unused parameters, variables, imports, branches, or returns introduced by the diff; commented-out code shipped in.
4. **Altitude:** code at the wrong level — a manual loop where one stdlib call is clearer, re-implementing something the language/framework already provides, low-level detail leaking into a high-level function.
5. **Efficiency:** obvious avoidable work — repeated calls in a loop that hoist out, recomputing an invariant each iteration, building a whole collection to read one element, a quadratic scan where a set/map is natural. Only flag when the simpler form is also clearer — not micro-optimizations.

For each finding give file:line, the cleanup, and the concrete before→after shape. Score by how clearly it improves the code: verified duplication of existing logic or dead code is high-confidence; a subjective 'reads nicer' is low. Skip pure formatting and naming bikeshedding."
description: "Reuse & simplification"
```
