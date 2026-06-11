# Pre-PR gates

Three signal-gated checks that run before PR creation. They warn by default (don't block) unless `.claude/ship-config.json` sets `strict: true`. Each gate self-skips if its trigger condition isn't met.

Before drafting the PR body, run three cheap grep/glob-based gates against the diff, then collect their output. These gates **warn but do not block** by default — surface context so the user can either proceed with intent or pause to address. Each gate runs independently; collect all outputs and show them together before Step 8.

## Gate 1 — PR-size warning

```bash
added=$(git diff origin/main --shortstat | grep -oE '[0-9]+ insertion' | grep -oE '[0-9]+' || echo 0)
if [ "${added:-0}" -gt 400 ]; then
  # Identify the top files dominating the diff
  git diff origin/main --numstat | awk '{print $1 + $2, $3}' | sort -rn | head -5
fi
```

If `added > 400`, emit:
```text
⚠ PR size: <N> lines added. Large PRs get surface-level reviews.
  Top files:
    <N1> lines  <path1>
    <N2> lines  <path2>
  Suggest: split on commit boundaries —
    git log origin/main..HEAD --oneline
  Each commit is already a logical split point. Consider shipping one per PR.
```
Do NOT block. The user decides.

## Gate 2 — Test-presence gate

**Universal heuristic (always runs):**
```bash
# Count new test functions across all languages in the diff
diff=$(git diff origin/main)
new_tests=$(echo "$diff" | grep -cE '^\+\s*(#\[(test|tokio::test|rstest)\]|\btest\(|\bit\(|def\s+test_|func\s+Test[A-Z]|it\s+[\x27"])' || true)

# Count substantive code additions in non-test, non-docs, non-config files
code_additions=$(git diff origin/main -- \
  ':(exclude)**/*.test.*' \
  ':(exclude)**/*.spec.*' \
  ':(exclude)**/tests/**' \
  ':(exclude)**/__tests__/**' \
  ':(exclude)**/migrations/**' \
  ':(exclude)docs/' \
  ':(exclude).github/' \
  ':(exclude)*.md' \
  ':(exclude)*.json' \
  | grep -cE '^\+[^+]' || true)
```

If `code_additions > 50` AND `new_tests == 0`, emit:
```text
⚠ Test-presence: <N> lines of code added, zero new tests.
  Code-only files (no tests alongside):
    <list of non-test files with net-positive additions>
  If this is intentional (refactor, config, docs), proceed. Otherwise consider
  adding tests before shipping.
```

**Optional strict mode (per-repo):**
```bash
# Check for .claude/ship-config.json at the repo root
if [ -f .claude/ship-config.json ]; then
  critical_globs=$(node -e '
    try {
      const c = require(process.cwd() + "/.claude/ship-config.json");
      if (Array.isArray(c.criticalPaths)) console.log(c.criticalPaths.join("\n"));
    } catch {}
  ')
  strict=$(node -e '
    try { console.log(!!require(process.cwd() + "/.claude/ship-config.json").strict); }
    catch { console.log("false"); }
  ')
fi
```

For each critical glob, check whether any diff file matches it (use the same glob-matching logic as `lint-gate.cjs`). If a critical path is touched AND `new_tests == 0`, emit a strong warning that cites the matching glob:

```text
⚠ Test-presence (STRICT): critical path touched without tests.
  Matched glob: <glob pattern>
  Files: <matching files from diff>
  No new tests detected in this PR.
```

If `strict: true` in ship-config.json, this blocks. Otherwise surface and continue.

## Gate 3 — Spec-contract deviation

Detect the active spec the same way `/review` Agent I does — strip standard
feature-branch prefixes, then require an exact spec directory match. Do NOT
fall back to "first spec under `.claude/specs/`" — for issue-driven branches
(e.g. `claude/<task>`) the fallback grabs an unrelated spec and Gate 3 runs
against the wrong contract. Better to skip cleanly when there's no match.
```bash
branch=$(git branch --show-current)
slug=$(echo "$branch" | sed -E 's#^(feat|fix|chore|refactor|feature)/##')
SPEC_DIR=""
[ -d ".claude/specs/$slug" ] && SPEC_DIR=".claude/specs/$slug"
```

If `$SPEC_DIR` is non-empty:
1. Read `$SPEC_DIR/design.md` and `$SPEC_DIR/tasks.md`.
2. For each named symbol/field/event/task in these files, grep the diff.
3. For each unchecked task in `tasks.md`, check whether the diff plausibly addresses it.

Flag two classes:
  - **MISSING:** spec promises a specific symbol/event/task, diff does not contain it.
  - **EXTRA:** diff introduces behavior (new command handler, new event emitter, new persisted field) not described anywhere in `design.md`.

For each deviation, use AskUserQuestion individually:
```text
<Deviation description — what the spec says vs what the diff does>

Recommendation: [A or B, lead with your pick and 1-sentence reason]

A) Remediate: bring the diff back to the spec before shipping.
B) Update spec: mark the outdated bullet in design.md/tasks.md with strikethrough
   (~~old text~~) and append an **Addendum** under the same section describing
   the current implementation path. Then ship.
C) Dismiss: not a real deviation.
```

If the user picks B, apply the edit to `design.md` and/or `tasks.md` using the following pattern — preserve the original bullet (struck through) and add a dated addendum directly beneath it:

```markdown
- ~~Original task/bullet text~~
  - **Addendum (YYYY-MM-DD):** <current implementation path — what was built
    instead, and why (1-2 sentences)>.
```

Stage the spec edit alongside the PR commits. Skip this gate silently if `$SPEC_DIR` is empty.

## Output collection

Collect the output of Gates 1-3 as `PRE_PR_GATE_FINDINGS`. These will be surfaced in the PR body (below the Summary section, above How It Works) and in the user-facing console output before Step 8. If every gate passes cleanly, `PRE_PR_GATE_FINDINGS` is empty and nothing is added to the PR body.
