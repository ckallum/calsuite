# Skill Authoring Best Practices

Distilled from Anthropic's internal skill authoring guidelines and real-world usage patterns. Read this before generating any SKILL.md content.

## 1. Description Field Is for the Model

The `description` field in SKILL.md frontmatter is how Claude decides whether to activate a skill. Write it as a list of trigger phrases — the natural language ways a user might ask for this capability.

**Good:**
```yaml
description: |
  Deploy code, push to production, release to staging, ship deployment,
  deploy service, roll out changes. Manages deployment pipelines with
  pre-flight checks and rollback support.
```

**Bad:**
```yaml
description: "This skill helps users deploy their code to various environments."
```

Include 5-8 trigger phrases. Include the category name (e.g., "deployment", "code review", "data analysis") so the skill activates on category-level requests too.

## 2. Do Not State the Obvious

Claude already knows how to read files, write code, use git, parse JSON, and navigate codebases. Only include instructions that push it out of its defaults:

- Domain-specific knowledge it wouldn't have (API quirks, tool flags, undocumented behavior)
- Ordering constraints (what must happen before what)
- Non-obvious decisions (when to use X vs Y)
- Failure modes and recovery steps

**Remove any instruction that Claude would follow anyway.** If you find yourself writing "Read the file to understand its contents" — delete it.

## 3. Build Gotchas Sections Over Time

Every skill should have a `## Gotchas` section. Start with known failure modes from the interview, but expect this section to grow:

- After each failure during skill usage, add the gotcha
- Include the symptom, cause, and fix
- Be specific: file paths, error messages, version numbers

A mature skill's gotchas section is its most valuable part. It encodes hard-won knowledge that prevents repeated failures.

## 4. Progressive Disclosure

Do not inline large reference material into SKILL.md. Instead:

1. Create files in `references/` for API documentation, detailed examples, long gotcha lists, or complex configuration guides
2. In SKILL.md, tell Claude *what* each file contains and *when* to read it
3. Claude will load the reference on demand, keeping the main skill file focused

**Rule of thumb:** If a section would exceed ~30 lines of reference content, extract it to `references/`.

```markdown
## API Reference

Read `references/api.md` before making any API calls. It documents the current
endpoint signatures and known quirks with error responses.
```

## 5. Avoid Railroading

Skills should give Claude information, goals, and constraints — not rigid step-by-step scripts that remove all judgment.

- Use "prefer" and "consider" for style and approach guidance
- Use "must" and "never" only for correctness constraints (things that break if violated)
- Describe the *goal* of each step, not just the mechanics
- Leave room for Claude to adapt to the specific situation

**Exception:** Some workflows genuinely need strict ordering (deployment pipelines, review gates). Use rigid steps there, but explain *why* the order matters.

## 6. Config Setup Pattern

If a skill needs user-specific settings (API keys, paths, preferences):

1. On first run, check for `config.json` in the skill directory
2. If missing, prompt the user via AskUserQuestion for each required value
3. Write the config file
4. On subsequent runs, read the config silently

```markdown
## Setup

Check for `config.json` in this skill's directory. If missing, ask the user:
- API endpoint URL
- Authentication token (store as reference, actual secret in env var)
- Default output format (json/markdown/csv)

Store answers in `config.json`. On subsequent runs, load config silently.
```

Never store actual secrets in config.json — store a reference to an environment variable name instead.

## 7. Memory and Data Storage

Skills that produce data between runs need a stable storage location:

| Use Case | Location | Example |
|----------|----------|---------|
| Skill-specific state | Skill directory | `skills/<name>/history.json` |
| Plugin data | `${CLAUDE_PLUGIN_DATA}` | Per-session data |
| Project-scoped data | `.context/<skill-name>/` | Audit logs, reports |

Prefer the skill directory for small state files. Use `.context/` for project-specific output that should be git-tracked. Use `${CLAUDE_PLUGIN_DATA}` for ephemeral session data.

## 8. On-Demand Hooks

Some skills benefit from Claude Code hooks (PreToolUse, PostToolUse, session lifecycle). If a skill needs hooks:

- Document the hook in SKILL.md's setup section
- Provide the hook configuration for `.claude/hooks.json`
- Keep hooks lightweight — they run on every tool call

Only suggest hooks when the skill genuinely needs to intercept or augment tool behavior. Most skills don't need hooks.

## 9. Measuring Skill Usage

Consider adding lightweight usage tracking to skills that run frequently:

- Append to a JSONL log file in the skill directory
- Track: timestamp, arguments, outcome (success/failure), duration
- This data helps identify gotchas and optimize the skill over time

This is optional — only include for skills where usage patterns would inform improvements.

## 10. Naming Conventions

- Skill names: lowercase kebab-case (`my-skill`, not `mySkill` or `my_skill`)
- Slash commands: derived from skill name (`/my-skill`)
- Directory: matches skill name (`skills/my-skill/`)
- Files: use descriptive names (`gotchas.md` not `notes.md`, `api.md` not `ref.md`)

## 11. Allowed Tools

The `allowed-tools` frontmatter field is a whitelist. If you omit a tool, Claude cannot use it during skill execution. Common patterns:

| Category | Typical Tools |
|----------|--------------|
| Read-only skills | Read, Glob, Grep, Bash |
| Code generation | Read, Write, Edit, Bash, Glob, Grep |
| Interactive skills | All above + AskUserQuestion |
| Orchestration skills | All above + Skill, Agent |

When in doubt, include the tool. An overly restrictive tool list causes silent failures that are hard to debug.
