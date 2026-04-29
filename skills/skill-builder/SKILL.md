---
name: skill-builder
version: 1.0.0
description: |
  Create a skill, new skill, build a skill, scaffold skill, make a skill, skill template,
  generate Claude Code skill, skill authoring, create slash command. Scaffolds production-quality
  Claude Code skills with proper folder structure, progressive disclosure, gotchas, and config
  patterns following Anthropic's best practices.
argument-hint: [skill-name] [--category <type>]
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - AskUserQuestion
  - Glob
  - Grep
---

# /skill-builder: Scaffold a New Claude Code Skill

Creates a production-ready Claude Code skill with proper structure, trigger-phrase descriptions, gotcha sections, progressive disclosure, and config patterns.

Read `skills/skill-builder/references/best-practices.md` before generating any skill content — it contains the authoring rules that govern how SKILL.md files should be written.

Read `skills/skill-builder/references/category-templates.md` after the user selects a category — it contains category-specific guidance for folder structure, tools, and sections.

## Step 0: Determine Skill Name and Target Directory

Parse `$ARGUMENTS` for a skill name (first positional arg) and optional `--category <type>`.

If no skill name is provided, use AskUserQuestion:
> What should the skill be called? This becomes the slash command name (e.g., "deploy" becomes `/deploy`).

**Target directory resolution:**
1. If the current working directory contains `.claude/skills/`, create the skill there (project-local skill).
2. If the current working directory contains `config/profiles.json` (i.e., it's the claude config repo), create in `skills/` (global skill).
3. Otherwise, use AskUserQuestion to ask whether this should be a project-local or global skill, then create accordingly.

## Step 1: Category Selection

Use AskUserQuestion to present the skill categories. If `--category` was provided in arguments, skip this step and use that category.

> What type of skill is this? Pick the closest category:
>
> 1. **Library & API Reference** — How to use a library, CLI, or SDK correctly
> 2. **Product Verification** — Test or verify code is working (Playwright, tmux, simulators)
> 3. **Data Fetching & Analysis** — Connect to data sources, monitoring, or analytics
> 4. **Business Process & Team Automation** — Automate repetitive workflows (PRs, tickets, comms)
> 5. **Code Scaffolding & Templates** — Generate framework boilerplate or project structures
> 6. **Code Quality & Review** — Enforce standards, review code, lint, refactor
> 7. **CI/CD & Deployment** — Build, test, deploy pipelines
> 8. **Runbooks** — Symptom to investigation to structured report
> 9. **Infrastructure Operations** — Maintenance, migrations, operational procedures

## Step 2: Interview

Based on the selected category, ask 3-5 targeted questions using AskUserQuestion. Ask one question at a time.

**Universal questions (pick 2-3):**
- What problem does this skill solve? When would someone reach for it?
- What external tools, CLIs, or APIs does it depend on?
- What are the known gotchas or failure modes you've already hit?

**Category-specific questions (pick 2-3 from the category template):**
Read `skills/skill-builder/references/category-templates.md` and use the interview questions listed for the selected category.

After the interview, confirm the plan with the user:
> Here's what I'll create: [summary of skill name, category, key features, folder structure]. Proceed?

## Step 3: Scaffold the Folder Structure

Create the skill directory. Not every skill needs every subfolder — only create what the category and interview answers call for.

```
skills/<name>/
  SKILL.md              # Always created
  references/           # If the skill needs reference docs (API details, gotchas, examples)
  templates/            # If the skill produces reports, files, or structured output
  scripts/              # If the skill needs helper scripts (Node.js, shell)
  config.json           # If the skill needs persistent user configuration
```

**When to include each:**
- `references/` — The skill involves a complex domain, has API details, or needs progressive disclosure of lengthy content. Most skills benefit from at least a `gotchas.md` file here.
- `templates/` — The skill generates files, reports, or structured output that follows a pattern.
- `scripts/` — The skill orchestrates external tools and benefits from a reusable script rather than inline bash.
- `config.json` — The skill needs user-specific settings (API keys, paths, preferences) that persist between runs.

## Step 4: Generate SKILL.md

Read `skills/skill-builder/templates/skill-template.md` as the starting skeleton. Customize it based on the category template and interview answers.

**SKILL.md authoring rules** (from `references/best-practices.md`):

1. **Description field is for the model, not the user.** Write 5-8 trigger phrases that describe when this skill should activate. Include the category name. Do not write a paragraph summary.

2. **Do not state the obvious.** Only include instructions that push Claude out of its defaults. Never tell Claude how to read files, use git, or write code — it already knows. Focus on domain-specific knowledge, ordering constraints, and non-obvious decisions.

3. **Gotchas section is mandatory.** Even if empty at first, include `## Gotchas` with a note to add failure modes as they're discovered. Pre-populate with any gotchas from the interview.

4. **Progressive disclosure over inlining.** If a section would exceed ~30 lines of reference material, put it in `references/` and tell Claude when to read it. Example: "Read `references/api.md` before making API calls."

5. **Config setup pattern.** If the skill needs user input, include a `## Setup` section that checks for `config.json` on startup and prompts for missing values via AskUserQuestion. Store answers in the skill's `config.json`.

6. **Flexibility over rigidity.** Use "prefer" and "consider" for style guidance. Use "must" and "never" only for correctness constraints (things that would break if violated). Give Claude goals and context, not mechanical step-by-step scripts.

7. **Memory and data storage.** If the skill produces data between runs (logs, history, state), store it in a stable location: the skill directory, `${CLAUDE_PLUGIN_DATA}`, or `.context/<skill-name>/` in the project root.

## Step 5: Register the Skill

After creating all files:

1. Read `config/profiles.json` from the claude config repo (find it by walking up from cwd looking for `config/profiles.json`).
2. Add the new skill name to the `base.skills` array.
3. Add the new skill name to the `monorepo-root.skills` array (since monorepo-root declares its own `skills` array, it does not inherit from base).
4. Write the updated `profiles.json`.

**Only register if the skill was created in the global skills directory** (the `skills/` folder next to `config/profiles.json`). Project-local skills should not be registered in the global profiles.

## Step 6: Review Checklist

Before finalizing, verify the skill against this checklist. Each item is non-negotiable — if any fails, fix before reporting completion.

- [ ] **Description has triggers.** Frontmatter `description` includes 5-8 trigger phrases (verbs + objects users actually say). Not a paragraph summary.
- [ ] **Description names the modes.** If the skill has multiple modes (e.g. RAW / SPEC / ISSUE), the description names them so the model knows when to invoke which.
- [ ] **Has `## Arguments`.** If the skill declares `argument-hint:` in frontmatter, SKILL.md contains a `## Arguments` section enumerating each argument, whether it's optional, valid values or formats, and how it maps to the skill's main process. Skills with no parameters can omit this section.
- [ ] **SKILL.md is reasonably tight.** Body excluding frontmatter is under 300 lines for simple skills, under 600 for multi-mode. If longer, content moves to `references/` or `templates/`.
- [ ] **No time-sensitive info.** No "as of November 2025", no "the new version of X" — that rots. State invariants, not snapshots.
- [ ] **Consistent terminology.** One word per concept. If the skill switches between "task", "step", and "operation" for the same thing, pick one and use it everywhere.
- [ ] **Concrete examples, not just rules.** Each non-trivial instruction has at least one example showing the right shape.
- [ ] **References one level deep.** SKILL.md links to `references/foo.md`; `foo.md` does not link to `references/foo/bar.md`. Flat, not nested.
- [ ] **Gotchas section exists.** Even if currently empty, with a note to populate as failure modes surface.
- [ ] **`allowed-tools` is minimal.** Only tools the skill actually uses. Adding `Bash` "just in case" defeats sandboxing.
- [ ] **No redundant instructions.** Don't tell Claude how to read files, use git, or run tests — it already knows. Only include domain-specific or non-default behavior.

If the skill bundles `references/`, also verify each reference file is used (linked from SKILL.md with a "read X before doing Y" instruction). Unused reference files are dead weight and should be deleted or inlined.

## Step 7: Confirm

Report to the user:
- Files created (with paths)
- Category used
- Whether it was registered in profiles.json
- Review checklist outcome (any items skipped and why)
- Suggest next steps: "Try invoking `/<skill-name>` to test it. Add gotchas as you discover failure modes."

## Gotchas

- The `description` field in SKILL.md frontmatter is parsed by the model for skill activation — write it as trigger phrases, not prose. If you write a paragraph, the skill won't activate reliably on natural language requests.
- `profiles.json` has profiles with explicit `skills` arrays that override (not merge with) the parent. When adding a skill to `base`, you must also add it to `monorepo-root` and any other profile that declares its own `skills` list.
- Do not create a `references/` folder with a single tiny file. If all reference content fits in SKILL.md without exceeding ~50 lines, inline it.
- The `allowed-tools` frontmatter field controls which tools the skill can use. Omitting a needed tool means Claude cannot call it during skill execution. Check the category template for recommended tools.
- Skill names become slash commands — use lowercase kebab-case, no spaces, no underscores.
- **Heredoc quoting in shell snippets:** Use unquoted delimiters (`<<EOF`) when the body needs `$(cmd)` or `${VAR}` expansion. Single-quoted (`<<'EOF'`) suppresses ALL expansion — variables are sent as literal text. This is the #1 cause of broken shell in skills.
- **Background PID capture:** `PID=$!` must come AFTER the heredoc closing delimiter, not inside the body. Everything between open/close delimiters is content, not shell code.
- **Temp file paths in skills:** Never hardcode `/tmp/foo.txt` — concurrent invocations collide. Use `mktemp -d /tmp/prefix-XXXXXX` and clean up with `rm -rf "$TMPDIR"`.

## References

- `skills/skill-builder/references/best-practices.md` — Skill authoring best practices (read before generating)
- `skills/skill-builder/references/category-templates.md` — Per-category guidance, folder structures, and interview questions
- `skills/skill-builder/templates/skill-template.md` — Blank SKILL.md skeleton used as starting point
