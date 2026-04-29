---
name: {{SKILL_NAME}}
version: 1.0.0
description: |
  {{TRIGGER_PHRASES}}
argument-hint: {{ARGUMENT_HINT}}
allowed-tools:
  - {{TOOL_1}}
  - {{TOOL_2}}
---

# /{{SKILL_NAME}}: {{SHORT_TITLE}}

{{ONE_LINE_DESCRIPTION — what this skill does and when to use it.}}

{{PROGRESSIVE_DISCLOSURE — if reference files exist, tell Claude what they contain and when to read them. Example:}}
{{Read `references/api.md` before making API calls — it documents current endpoint signatures and known quirks.}}

## Setup

{{IF_CONFIG_NEEDED:}}
Check for `config.json` in this skill's directory. If missing, use AskUserQuestion to prompt for:
- {{CONFIG_VALUE_1}} — {{description}}
- {{CONFIG_VALUE_2}} — {{description}}

Store answers in `config.json`. On subsequent runs, load config silently.

{{IF_NO_CONFIG: Remove this section entirely.}}

## Arguments

{{IF_SKILL_TAKES_ARGUMENTS:}}
- `/{{SKILL_NAME}}` — {{describe behavior with no argument; if not supported, say "abort and ask the user to supply X"}}
- `/{{SKILL_NAME}} <{{ARG_NAME}}>` — {{describe what the argument means, valid forms, how it maps to the workflow step that consumes it}}

{{IF_SKILL_TAKES_NO_ARGUMENTS: Remove this section entirely AND drop `argument-hint` from frontmatter.}}

## Workflow

{{STEP_1_HEADING}}

{{Describe the goal of this step. Include domain-specific knowledge, ordering constraints, and non-obvious decisions. Do not describe obvious operations like "read the file" — Claude already knows how.}}

{{STEP_2_HEADING}}

{{Continue with additional steps. Use "prefer" and "consider" for style guidance. Use "must" and "never" only for correctness constraints.}}

## Gotchas

<!-- Add gotchas here as you discover failure modes. Format: -->
<!-- - **Symptom**: description. **Cause**: why it happens. **Fix**: what to do. -->

## References

{{IF_REFERENCE_FILES_EXIST:}}
- `references/{{FILE}}.md` — {{what it contains and when to read it}}

{{IF_NO_REFERENCES: Remove this section entirely.}}
