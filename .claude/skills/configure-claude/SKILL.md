---
name: configure-claude
description: Install Claude Code hooks, scripts, plugins, and config into a project. Use when setting up a new project or syncing config to an existing one.
disable-model-invocation: true
allowed-tools: Bash(node *), Read, Glob
---

Install all Claude Code configs from this repository into a project's `.claude/` directory.

## What it does

1. Copies `scripts/hooks/` and `scripts/lib/` into the target project's `.claude/scripts/`
2. Reads `hooks/hooks.json`, resolves `${CALSUITE_DIR}` paths, and merges the `hooks` key into the target's `.claude/settings.json` (preserving existing keys)
3. Enables all manifest plugins in the project's `.claude/settings.json`
4. Checks global settings against `config/global-settings.json` and warns about missing marketplaces, plugins, MCP servers, or statusLine config

## Instructions

When this skill is invoked:

1. Determine the target project directory. If the current working directory is the calsuite repo itself (it contains `config/profiles.json` and `scripts/configure-claude.js`), ask the user which project to configure. Otherwise, use the current working directory.

2. Run the installer script. `$CALSUITE_DIR` is calsuite's checkout location — set the env var, or run from the calsuite repo root and drop the `$CALSUITE_DIR/` prefix:
   ```bash
   node "$CALSUITE_DIR/scripts/configure-claude.js" <target-directory>
   ```

3. Review the output and report what was installed to the user, including any global settings warnings.

4. If ccstatusline config is missing or outdated, offer to install it:
   ```bash
   node "$CALSUITE_DIR/scripts/configure-claude.js" --install-ccstatusline
   ```
