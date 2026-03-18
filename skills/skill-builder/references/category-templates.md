# Category Templates

Per-category guidance for skill scaffolding. Read the relevant category section after the user selects their category in Step 1.

---

## 1. Library & API Reference

**Purpose:** Teach Claude how to use a specific library, CLI, or SDK correctly — especially when it has undocumented behavior, version-specific APIs, or common pitfalls.

**Recommended structure:**
```
skills/<name>/
  SKILL.md
  references/
    api.md              # Current API signatures and usage patterns
    gotchas.md          # Version-specific quirks, deprecated methods
    examples.md         # Annotated usage examples
```

**Key SKILL.md sections:**
- Quick reference table of most-used functions/commands
- Version compatibility notes
- When to use this library vs alternatives
- Gotchas (critical for this category)

**Interview questions:**
- Which version of this library are you targeting?
- What are the most common mistakes people make with it?
- Are there deprecated APIs that Claude might hallucinate?
- What's the typical import/setup pattern?

**Recommended tools:** `Read, Glob, Grep, Bash, Edit, Write`

**Example description:**
```yaml
description: |
  Use Prisma, Prisma ORM, Prisma migrations, Prisma schema, Prisma client,
  database queries with Prisma. Library reference for Prisma ORM with migration
  patterns, schema design, and query optimization.
```

**Tips:**
- Pair with Context7 MCP for live documentation lookup
- Focus gotchas on things Claude gets wrong by default (outdated API patterns from training data)
- Include version checks in the workflow so Claude validates it's using the right API

---

## 2. Product Verification

**Purpose:** Test or verify that code works correctly using external tools (Playwright, tmux, simulators, real browsers).

**Recommended structure:**
```
skills/<name>/
  SKILL.md
  scripts/
    setup.sh            # Environment setup (install deps, start servers)
    verify.sh           # Main verification script
  references/
    tool-usage.md       # How to use the verification tool correctly
  templates/
    report.md           # Verification report template
```

**Key SKILL.md sections:**
- Environment prerequisites
- Setup steps (what to start before verifying)
- Verification workflow (what to check and in what order)
- How to interpret results
- Teardown steps

**Interview questions:**
- What tool do you use for verification (Playwright, Cypress, tmux, etc.)?
- What needs to be running before verification starts (servers, databases)?
- What does a passing verification look like vs a failing one?
- Should verification be interactive or fully automated?

**Recommended tools:** `Bash, Read, Write, Glob, Grep, AskUserQuestion`

**Example description:**
```yaml
description: |
  Test the app, verify it works, run verification, check the UI, browser test,
  end-to-end test, smoke test. Launches the app and verifies core user flows
  using Playwright browser automation.
```

**Tips:**
- Include server startup and teardown in the workflow
- Add timeouts for browser/server operations
- Screenshot or log capture on failure helps debugging
- Consider a "quick check" mode vs "full verification" mode

---

## 3. Data Fetching & Analysis

**Purpose:** Connect to data sources, monitoring stacks, or analytics platforms. Fetch, transform, and present data.

**Recommended structure:**
```
skills/<name>/
  SKILL.md
  config.json           # Connection strings, API keys (references only)
  references/
    schema.md           # Data schemas, table definitions
    queries.md          # Common query patterns
  templates/
    report.md           # Analysis report template
```

**Key SKILL.md sections:**
- Setup (config with connection details)
- Available data sources
- Common queries / analysis patterns
- Output format options

**Interview questions:**
- What data source are you connecting to (database, API, monitoring tool)?
- What authentication is required?
- What are the most common queries or analyses you run?
- Should results be formatted as tables, charts, markdown, or raw data?
- Are there rate limits or data size concerns?

**Recommended tools:** `Bash, Read, Write, Grep, AskUserQuestion`

**Example description:**
```yaml
description: |
  Query database, fetch metrics, analyze data, pull analytics, check monitoring,
  data report, dashboard data. Connects to project data sources and produces
  formatted analysis reports.
```

**Tips:**
- Never store actual credentials in config.json — reference environment variables
- Include query timeouts and result size limits
- Consider caching frequently-accessed data
- Template the output so reports are consistent

---

## 4. Business Process & Team Automation

**Purpose:** Automate repetitive team workflows — PR management, ticket updates, communication, status reports.

**Recommended structure:**
```
skills/<name>/
  SKILL.md
  config.json           # Team settings, channel IDs, repo names
  templates/
    output.md           # Structured output template
  references/
    workflow.md         # Detailed workflow documentation
```

**Key SKILL.md sections:**
- Setup (team-specific configuration)
- Trigger conditions (when to use this)
- Workflow steps
- Integration points (GitHub, Slack, Jira, etc.)

**Interview questions:**
- What workflow are you automating? Walk through the manual steps today.
- What systems does it touch (GitHub, Slack, Jira, email)?
- Who are the stakeholders? What do they need to see?
- How often does this run? On-demand or scheduled?
- What are the failure modes? What happens if a system is down?

**Recommended tools:** `Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion`

**Example description:**
```yaml
description: |
  Weekly standup, team status, generate status report, PR summary, sprint review,
  team automation, weekly report. Automates weekly team status collection and
  report generation.
```

**Tips:**
- Make the skill idempotent — safe to run multiple times
- Include dry-run mode for workflows that send notifications
- Store history of past runs for trend tracking
- Use AskUserQuestion for confirmation before external side effects (posting to Slack, etc.)

---

## 5. Code Scaffolding & Templates

**Purpose:** Generate boilerplate code, project structures, or framework-specific file sets.

**Recommended structure:**
```
skills/<name>/
  SKILL.md
  templates/
    component.md        # Template for generated files
    route.md
    service.md
  references/
    conventions.md      # Project conventions to follow
```

**Key SKILL.md sections:**
- Available templates and when to use each
- Convention rules (naming, file placement, imports)
- Customization options
- Post-generation steps (what to do after scaffolding)

**Interview questions:**
- What framework or stack is this for?
- What are the project's naming conventions?
- What files are typically created together (e.g., component + test + story)?
- Are there project-specific patterns that differ from framework defaults?
- What should happen after scaffolding (run formatter, add to index, etc.)?

**Recommended tools:** `Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion`

**Example description:**
```yaml
description: |
  Scaffold component, new page, create route, generate service, add feature,
  boilerplate, template code. Generates framework-compliant file sets following
  project conventions.
```

**Tips:**
- Read existing code to match project conventions rather than using generic templates
- Include the test file in the scaffold
- Run the project's formatter/linter after generation
- Verify imports resolve correctly

---

## 6. Code Quality & Review

**Purpose:** Enforce coding standards, review code for issues, refactor, or perform systematic quality checks.

**Recommended structure:**
```
skills/<name>/
  SKILL.md
  references/
    standards.md        # Coding standards and rules
    checklist.md        # Review checklist
  templates/
    review-report.md    # Review output format
```

**Key SKILL.md sections:**
- What standards are enforced
- Review workflow (automated checks then manual review)
- Severity levels and how to handle each
- Integration with existing linters/CI

**Interview questions:**
- What coding standards or conventions should be enforced?
- What are the most common code quality issues in this codebase?
- Should the skill auto-fix issues or just report them?
- What's the severity model (critical/warning/info)?
- Does this integrate with existing CI checks?

**Recommended tools:** `Read, Bash, Glob, Grep, Edit, Write, AskUserQuestion, Agent`

**Example description:**
```yaml
description: |
  Review code, code review, check quality, lint code, enforce standards,
  refactor review, quality check. Systematic code quality review with
  auto-fix for safe patterns.
```

**Tips:**
- Dispatch parallel agents for independent review dimensions (architecture, style, tests)
- Distinguish between auto-fixable issues and issues requiring human judgment
- Include a severity system so users can filter noise
- Store review history to track improvement over time

---

## 7. CI/CD & Deployment

**Purpose:** Build, test, deploy, or manage release pipelines.

**Recommended structure:**
```
skills/<name>/
  SKILL.md
  config.json           # Environment configs, deploy targets
  scripts/
    deploy.sh           # Deployment script
    rollback.sh         # Rollback script
  references/
    environments.md     # Environment details and access
    runbook.md          # Deployment procedures
```

**Key SKILL.md sections:**
- Pre-flight checks (what must be true before deploying)
- Deploy workflow with explicit ordering
- Verification steps (how to confirm deployment succeeded)
- Rollback procedure
- Environment-specific notes

**Interview questions:**
- What environments exist (staging, production, etc.)?
- What's the deployment mechanism (git push, CLI tool, API call)?
- What pre-flight checks are required?
- How do you verify a deployment succeeded?
- What's the rollback procedure?

**Recommended tools:** `Bash, Read, Write, Glob, Grep, AskUserQuestion`

**Example description:**
```yaml
description: |
  Deploy, push to production, release, ship to staging, deploy service,
  roll out, CI/CD pipeline. Manages deployment pipeline with pre-flight
  checks, staged rollout, and rollback support.
```

**Tips:**
- Always include pre-flight checks (clean git state, tests pass, correct branch)
- Require explicit confirmation before production deploys
- Include rollback as a first-class workflow, not an afterthought
- Log every deployment with timestamp, commit SHA, deployer, outcome

---

## 8. Runbooks

**Purpose:** Guide Claude through investigating a symptom, performing diagnostic steps, and producing a structured incident report.

**Recommended structure:**
```
skills/<name>/
  SKILL.md
  references/
    symptoms.md         # Known symptoms and diagnostic trees
    commands.md         # Diagnostic commands reference
  templates/
    incident-report.md  # Structured report template
    postmortem.md       # Postmortem template
```

**Key SKILL.md sections:**
- Symptom identification
- Diagnostic decision tree (if X, check Y)
- Common fixes for known issues
- Report template with required fields
- Escalation criteria

**Interview questions:**
- What system or service does this runbook cover?
- What are the most common symptoms or alerts?
- What diagnostic commands or tools are available?
- What does the incident report need to include?
- When should the skill escalate vs attempt a fix?

**Recommended tools:** `Bash, Read, Write, Grep, Glob, AskUserQuestion`

**Example description:**
```yaml
description: |
  Investigate incident, debug issue, troubleshoot error, runbook, diagnose problem,
  incident response, check service health. Structured investigation runbook for
  service issues with diagnostic trees and incident reports.
```

**Tips:**
- Structure as a decision tree, not a linear list
- Include "check this first" quick diagnostics before deep investigation
- Template the report so it's consistent across incidents
- Store past incident reports for pattern matching
- Include safe vs unsafe diagnostic commands (read-only first)

---

## 9. Infrastructure Operations

**Purpose:** Perform maintenance tasks, migrations, infrastructure changes, or operational procedures.

**Recommended structure:**
```
skills/<name>/
  SKILL.md
  config.json           # Infrastructure targets and settings
  scripts/
    migrate.sh          # Migration script
    validate.sh         # Post-operation validation
  references/
    infrastructure.md   # System architecture and access
    procedures.md       # Standard operating procedures
  templates/
    change-log.md       # Change documentation template
```

**Key SKILL.md sections:**
- Pre-operation checklist
- Step-by-step procedure with verification at each step
- Rollback procedure for each step
- Post-operation validation
- Change documentation requirements

**Interview questions:**
- What infrastructure or system is this for?
- What's the blast radius if something goes wrong?
- What are the rollback options at each step?
- What validation confirms the operation succeeded?
- Are there maintenance windows or coordination requirements?

**Recommended tools:** `Bash, Read, Write, Glob, Grep, AskUserQuestion`

**Example description:**
```yaml
description: |
  Run migration, database maintenance, infrastructure update, system operation,
  maintenance procedure, operational task. Guides infrastructure operations with
  step-by-step validation and rollback support.
```

**Tips:**
- Every step should be independently verifiable and reversible
- Include explicit rollback for each step, not just the overall operation
- Require confirmation before destructive operations
- Log every action taken for audit trail
- Include a "dry run" mode that validates without executing
