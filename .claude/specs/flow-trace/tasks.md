# Flow Trace — Tasks

## Phase 1: Trace Hook

- [x] Create `.claude/scripts/hooks/flow-trace.cjs`
  - Read stdin JSON, detect Skill vs Agent tool
  - Extract relevant fields (name, subagent_type, description, args)
  - Append JSONL to `.claude/flow-trace-{CLAUDE_SESSION_ID}.jsonl`
  - Auto-increment seq number
  - Fail-open (exit 0 on any error)
- [x] Register hook in `.claude/settings.json` under `PreToolUse`
  - Matcher: `tool == "Skill" || tool == "Agent"`
- [x] Register cleanup hook in `.claude/settings.json` under `SessionEnd`
  - Remove `.claude/flow-trace-*.jsonl` files
- [x] Add `.claude/flow-trace-*.jsonl` to `.gitignore`

## Phase 2: `/flow` Skill

- [x] Create `.claude/skills/flow/SKILL.md`
  - Read trace file for current session
  - Parse JSONL entries
  - Detect parallel dispatches (timestamp ±1s from same predecessor)
  - Collapse repeated identical agent dispatches (×N)
  - Generate Mermaid `flowchart TD`
  - Output diagram

## Phase 3: `/ship` Integration

- [x] Update `.claude/skills/ship/SKILL.md`
  - After commit splitting / before PR creation, generate flow diagram
  - Insert `### Development Flow` section into PR body template
  - Skip section if trace file missing/empty
- [x] Update `.claude/skills/ship/pr-template.md`
  - Add `### Development Flow` section to template documentation
