# PR Body Template

Shared template for PR creation across skills (`/ship`, `/receiving-pr-feedback`, parallel agents).

## Usage

This is the canonical PR body structure. Both `/ship` (Step 8) and `/receiving-pr-feedback` (Step 4.5) follow this format.

- **On initial PR creation** (`/ship`): all sections are generated fresh from the current branch state.
- **After feedback rounds** (`/receiving-pr-feedback`): dynamic sections (Summary, Important Files, Test Results, Development Flow) are regenerated to reflect fixes. Static sections (How It Works, Pre-Landing Review, Doc Completeness) are preserved as-is. A Revision History section is appended with per-round summaries.

Parser utility: `.claude/scripts/lib/pr-body-parser.cjs` provides `parsePrBody` / `assemblePrBody` for splitting and reassembling the body by `## ` headers.

## Title Format

```
<type>(<scope>): <summary>
```

- `type`: feat, fix, chore, refactor, docs
- `scope`: backend, frontend, infra, tooling, etc.
- `summary`: under 70 characters

## Body Format

```markdown
## Summary
<1-5 bullet points describing what shipped — derived from CHANGELOG or commit history>

## How It Works
<Mermaid diagram showing the key flow introduced or changed>

Pick the diagram type that fits best:
- `sequenceDiagram` — request/response flows, multi-step pipelines, hook execution chains
- `flowchart TD` — decision trees, state machines, before/after architecture comparisons
- `erDiagram` — schema changes showing new tables/relationships

Keep diagrams focused — show the **new/changed flow only**, not the entire system.
5-15 nodes max. Skip for small PRs (< 50 lines, config-only, docs-only).

## Development Flow
<Mermaid flowchart TD diagram auto-generated from session flow trace data>

Auto-generated from `.claude/flow-trace-{session}.jsonl` if trace data exists.
Shows which skills and agents ran during development, in what order, with
parallel edges and collapsed repeated dispatches (xN).
**Omit this section entirely if no trace data is available — no placeholder.**

## Important Files
| File | Change |
|------|--------|
| `path/to/file.ts` | Added X handler with Y validation |
| `path/to/other.ts` | Updated Z to support new field |

Only include files with meaningful logic changes. Skip auto-generated files,
lock files, and trivial formatting changes. Group by layer:
schema → backend → API → frontend → infra → docs.
Max 10-12 rows — summarize remainder as "N additional files with minor changes".

## Test Results
| Suite | Result |
|-------|--------|
| Frontend unit | ✅ N passed |
| Backend unit | ✅ N passed |
| E2E | ✅ N passed |
| Lint | ✅ Clean |

Omit suites that weren't run (e.g., no backend changes = no backend tests).

## Pre-Landing Review
<findings summary, or "No issues found.">

## Doc Completeness
- [ ] CHANGELOG.md updated
- [ ] CLAUDE.md updated (if conventions/structure changed)
- [ ] tasks.md updated (if working on a spec)

## Revision History
<!-- Omit this section on initial PR creation. Only appended by /receiving-pr-feedback. -->
<!-- Example format (do not copy literally):
**Round 1** (YYYY-MM-DD):
- Accepted: X comments — brief list of key changes
- Pushed back: Y comments
- Questions answered: Z comments
-->

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## gh pr create Example

```bash
gh pr create --title "<type>(<scope>): <summary>" --body "$(cat <<'EOF'
## Summary
- Added X
- Fixed Y

## How It Works
```mermaid
flowchart TD
    A[Input] --> B[Process]
    B --> C[Output]
```

## Important Files
| File | Change |
|------|--------|
| `src/foo.ts` | Added bar handler |

## Test Results
| Suite | Result |
|-------|--------|
| Frontend unit | ✅ 42 passed |
| Lint | ✅ Clean |

## Pre-Landing Review
No issues found.

## Doc Completeness
- [x] CHANGELOG.md updated

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
