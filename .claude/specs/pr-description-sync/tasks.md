# PR Description Sync — Tasks

## Phase 1: PR Body Parser Utility

- [x] Create `.claude/scripts/lib/pr-body-parser.cjs` (or inline in skill)
  - Parse PR body into sections by `## ` headers
  - Identify known vs unknown sections
  - Reassemble body from modified section map
  - This logic can be used by both `/receiving-pr-feedback` and `/ship` for consistency

## Phase 2: Update `/receiving-pr-feedback`

- [x] Add Step 4.5 to `.claude/skills/receiving-pr-feedback/SKILL.md`
  - After applying fixes and pushing commits
  - Fetch current PR body via `gh pr view`
  - Regenerate Summary from `git log origin/main..HEAD`
  - Regenerate Important Files from `git diff origin/main --stat`
  - Re-run tests and regenerate Test Results
  - Regenerate Development Flow if trace file exists
  - Preserve static sections (How It Works, Pre-Landing Review, Doc Completeness)
  - Build and append Revision History entry from Step 5 data
  - Update PR via `gh pr edit --body`
- [x] Move Step 5 summary data generation before Step 4.5
  - The revision history entry needs the accepted/pushed-back/answered counts
  - Generate the summary data first, use it in both 4.5 and 5

## Phase 3: Shared PR Body Generation

- [x] Extract common PR body generation logic referenced by both `/ship` and `/receiving-pr-feedback`
  - Summary generation from commit history
  - Important Files table from git diff
  - Test Results table from test output
  - Document in pr-template.md as the canonical reference both skills follow
