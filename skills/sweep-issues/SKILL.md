---
name: sweep-issues
version: 1.0.0
description: |
  Sweep the current session for deferred items, fast-follows, enhancements,
  minor bugs, and improvements — then auto-create GitHub issues for each.
  Runs automatically at the end of /ship, after plans, or manually.
user-invocable: true
argument-hint: "[--dry-run]"
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

# Sweep Issues: Auto-Create GitHub Issues from Session Work

You are running `/sweep-issues`. Scan the current conversation and recent changes for items that should be tracked as GitHub issues.

## Arguments

- `/sweep-issues` — create issues (default)
- `/sweep-issues --dry-run` — list what would be created, but don't create anything

## What to Capture

Scan the conversation for ANY of these patterns:

1. **Deferred items** — "we'll do this later", "out of scope for this PR", "deferred to a follow-up", "not in V1", "TODO:", "FIXME:", "HACK:"
2. **Fast-follows** — "next step would be", "follow-up PR for", "should also add", "nice to have"
3. **Enhancements** — "could be improved by", "future enhancement", "would be nice to", "stretch goal"
4. **Minor bugs** — "noticed that X doesn't work when", "edge case:", "workaround:"
5. **Technical debt** — "this is hacky", "should refactor", "temporary solution", "tech debt"
6. **Decisions** — "decided not to X because Y" (create issue to revisit if context changes)
7. **Items from review** — code review findings marked as non-blocking or informational

## What NOT to Capture

- Items that already have a GitHub issue (check with `gh issue list --search "keyword" --limit 5`)
- Items completed in this session
- Items that are trivially small (single-line fixes you could do right now)
- Vague wishes without actionable scope

## Process

### Step 1: Gather Candidates

Review the conversation history and identify candidate items. For each, note:
- **What**: one-line description
- **Why**: context from the conversation
- **Source**: what triggered it (review finding, user comment, edge case discovered, etc.)
- **Category**: `enhancement` | `bug` | `tech-debt` | `infrastructure`

### Step 2: Deduplicate Against Existing Issues

For each candidate, search existing issues:
```bash
gh issue list --search "<keywords>" --limit 5
```

Skip anything that's already tracked. If an existing issue is related but doesn't cover the new scope, note it as a cross-reference.

### Step 3: Present Candidates

Show the user a numbered list:
```
Found N items to create as GitHub issues:

1. [enhancement] Short title — one-line context
2. [tech-debt] Short title — one-line context
3. [bug] Short title — one-line context
```

If `--dry-run`, stop here.

### Step 4: Create Issues

For each item, create a GitHub issue:

```bash
gh issue create --title "<title>" --label "<label>" --body "$(cat <<'EOF'
## Summary
{1-2 sentence description}

## Source
- Identified during: {PR title / plan name / session context}
- Related: {any related issues or PRs}

## Requirements
- [ ] {requirement 1}
- [ ] {requirement 2}
- [ ] {requirement 3}
EOF
)"
```

**Label mapping:**
- `enhancement` → `enhancement`
- `bug` → `bug`
- `tech-debt` → `tech-debt`
- `infrastructure` → `infrastructure`

### Step 5: Report

Output a summary:
```
Created N issues:
- #123 Title
- #124 Title
- #125 Title

Skipped M items (already tracked or too small).
```

## Important Rules

- **Never create duplicate issues.** Always search first.
- **Never include secrets, credentials, API keys, or tokens in issue bodies.** Redact any sensitive data from conversation context before creating issues.
- **Keep issues small and focused.** One issue per concern. Don't bundle unrelated items.
- **Include enough context** that someone reading the issue 3 months from now understands what and why.
- **Don't over-specify requirements.** 3-5 checklist items is ideal. The implementer will spec the details.
- **Link related issues** when they exist (use `Related: #NNN` in the body).
