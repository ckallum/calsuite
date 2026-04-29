---
name: guardian
description: "Configure Guardian autonomous mode, switch modes, view audit log, and manage rules"
user-invocable: true
argument-hint: "[mode|log|rules] [args]"
allowed-tools: Bash(node *), Bash(cat *), Bash(tail *), Bash(jq *), Read, Glob, Edit
---

# /guardian

Manage the Guardian autonomous approval system — switch modes, view audit logs, and edit rules.

## Instructions

Parse `$ARGUMENTS` to determine the subcommand:

### `mode <autonomous|supervised|lockdown>`

Switch Guardian's operating mode:

1. Read the project's `.claude/config/guardian-rules.json` (or fall back to the repo's `config/guardian-rules.json`)
2. Update the `"mode"` field to the requested value
3. Read the `permissions` object for the new mode
4. Update the project's `.claude/settings.json` — merge the mode's `allow` list into `permissions.allow`
5. Report what changed

**Modes:**
- **autonomous** (alias: **AFK**) — Broad permissions, guardian blocks only dangerous ops. Best for unattended work — work that can run end-to-end without human input.
- **supervised** (alias: **HITL**) — Read-only tools + safe git. Human-in-the-loop work where the user wants to approve each meaningful action.
- **lockdown** — Minimal read-only access. For auditing or untrusted environments.

**AFK vs HITL is the same axis as autonomous vs supervised.** The aliases exist because `/sweep-issues` (labelling) and `/execute` (running labelled work) use AFK/HITL — those labels map directly onto these modes when an agent picks up the work.

### `log [N]`

View the Guardian audit log:

1. Find log files at `~/.claude/guardian/logs/*.jsonl`
2. Show the last N entries (default 20), formatted with jq
3. If no logs exist, say so

```bash
tail -n 20 ~/.claude/guardian/logs/$(date +%Y-%m-%d).jsonl | jq .
```

### `rules list`

Display all current deny and warn rules from the guardian config, formatted as a table.

### `rules add <deny|warn> <json>`

Add a new rule to the config. The JSON should include `id`, `tool`, `match`, and `reason` fields.

### `rules remove <rule-id>`

Remove a rule by its ID from either the deny or warn list.

### No arguments / `status`

Show current mode, number of deny/warn rules, and last 5 audit log entries.
