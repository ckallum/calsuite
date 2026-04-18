# Pre-Landing Review Checklist

## Instructions

Review the `git diff origin/main` output for the issues listed below. Be specific — cite `file:line` and suggest fixes. Skip anything that's fine. Only flag real problems.

**Two-pass review:**
- **Pass 1 (CRITICAL):** Run these first. These can block shipping.
- **Pass 2 (INFORMATIONAL):** Run all remaining categories. These are included in the PR body but do not block.

**Output format:**

```text
Checklist Review: N issues (X critical, Y informational)

**CRITICAL** (blocking):
- [file:line] Problem description
  Fix: suggested fix

**INFORMATIONAL** (advisory):
- [file:line] Problem description
  Fix: suggested fix
```

If no issues found: `Checklist Review: No issues found.`

Be terse. For each issue: one line describing the problem, one line with the fix. No preamble, no summaries, no "looks good overall."

---

## Review Categories

### Pass 1 — CRITICAL

#### SQL & Data Safety
- String interpolation or concatenation in SQL queries — use parameterized queries / prepared statements
- TOCTOU races: check-then-write patterns that should be atomic (use conditional updates, upserts, or transactions)
- Bulk operations bypassing validation layers (ORM `.update_all`, raw SQL updates, etc.)
- N+1 queries: missing eager loading for associations used in loops

#### Race Conditions & Concurrency
- Read-check-write without uniqueness constraint or conflict handling (`ON CONFLICT`, `rescue`/`catch` duplicate key)
- Find-or-create on columns without unique DB index — concurrent calls can create duplicates
- Status transitions without atomic conditional updates — concurrent updates can skip or double-apply
- User-controlled data rendered as raw HTML without sanitization (XSS)

#### LLM Output Trust Boundary
- LLM-generated values (emails, URLs, names) written to DB or passed to external services without format validation. Add lightweight guards (regex, `URL.parse`, `.trim()`) before persisting.
- Structured tool output (arrays, objects) accepted without type/shape checks before database writes.

#### Auth & Security Boundaries
- Missing authentication checks on new endpoints or routes
- Missing authorization / tenant scope enforcement on data access
- Secrets, API keys, tokens, or credentials committed in code or config (not in .env / secrets manager)
- Unsafe deserialization, `eval()`, or code injection vectors
- Path traversal in file operations using user-supplied input

### Pass 2 — INFORMATIONAL

#### Conditional Side Effects
- Code paths that branch on a condition but forget to apply a side effect on one branch (e.g., status updated but related field only set in one branch — creating inconsistent state)
- Log messages that claim an action happened but the action was conditionally skipped
- State variables (counters, flags, accumulators) added for a feature lifecycle — verify they reset on deactivation/reactivation, not just on success

#### Magic Numbers & String Coupling
- Bare numeric literals used in multiple files — should be named constants
- Error message strings used as query filters elsewhere (grep for the string — is anything matching on it?)

#### Dead Code & Consistency
- Variables assigned but never read
- Unused imports or unreachable code paths
- Comments/docstrings that describe old behavior after the code changed
- Version mismatch between PR and VERSION/CHANGELOG files
- Mechanical refactors claiming "all X converted" — grep the full file for the old pattern to verify completeness

#### LLM Prompt Issues
- 0-indexed lists in prompts (LLMs reliably return 1-indexed)
- Prompt text listing available tools/capabilities that don't match what's actually wired up
- Word/token limits stated in multiple places that could drift

#### Test Gaps
- Negative-path tests that assert type/status but not side effects (fields populated? callbacks fired?)
- Assertions on string content without checking format (e.g., asserting title present but not URL format)
- Missing assertions that a code path should explicitly NOT call an external service
- Security enforcement features (blocking, rate limiting, auth) without integration tests verifying enforcement
- Changed function return type or error contract (e.g., `Ok(None)` → `Err`) — verify at least one test exercises the new error/failure path

#### Error Handling
- Missing error handling at system boundaries (API routes, background jobs, external service calls)
- Generic catch-all without logging or re-raising with context
- Swallowed errors that fail silently with no user-visible feedback

#### Debug Artifacts
- `console.log`, `print()`, `debugger`, `binding.pry`, `breakpoint()`, `pp`, `dump()` left in production code
- `TODO`/`FIXME`/`HACK` comments introduced in this diff without a tracking issue

#### Crypto & Entropy
- Truncation of data instead of hashing (less entropy, easier collisions)
- Non-cryptographic random (`Math.random`, `rand()`, `random.random`) for security-sensitive values — use cryptographic RNG
- Non-constant-time comparisons (`==`) on secrets or tokens — vulnerable to timing attacks

#### Time Window Safety
- Date-key lookups that assume "today" covers 24h — may only see partial day depending on timezone
- Mismatched time windows between related features (one uses hourly buckets, another daily keys)

#### Type Coercion at Boundaries
- Values crossing language/serialization boundaries where type could change (numeric vs string)
- Hash/digest inputs that don't normalize types before serialization — different types produce different hashes

---

## Gate Classification

```text
CRITICAL (blocks shipping):           INFORMATIONAL (in PR body):
├─ SQL & Data Safety                  ├─ Conditional Side Effects
├─ Race Conditions & Concurrency      ├─ Magic Numbers & String Coupling
├─ LLM Output Trust Boundary          ├─ Dead Code & Consistency
└─ Auth & Security Boundaries         ├─ LLM Prompt Issues
                                      ├─ Test Gaps
                                      ├─ Error Handling
                                      ├─ Debug Artifacts
                                      ├─ Crypto & Entropy
                                      ├─ Time Window Safety
                                      └─ Type Coercion at Boundaries
```

---

## Suppressions — DO NOT flag these

- "X is redundant with Y" when the redundancy is harmless and aids readability
- "Add a comment explaining why this threshold/constant was chosen" — thresholds change during tuning, comments rot
- "This assertion could be tighter" when the assertion already covers the behavior
- Suggesting consistency-only changes (wrapping a value in a conditional to match how another constant is guarded)
- "Regex doesn't handle edge case X" when the input is constrained and X never occurs in practice
- "Test exercises multiple guards simultaneously" — that's fine, tests don't need to isolate every guard
- Threshold/tuning constant changes — these are tuned empirically and change constantly
- Harmless no-ops (e.g., filter on a value that's never in the collection)
- Style preferences already handled by formatters or linters
- ANYTHING already addressed in the diff you're reviewing — read the FULL diff before commenting
