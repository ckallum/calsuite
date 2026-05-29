---
name: update-docs
description: |
  update the changelog, refresh docs, update SPECLOG, sync project docs,
  document recent work, write up what changed, bump the docs, refresh tasks.md,
  update README for recent changes, post-merge docs pass.
  Update project documentation, specs, and changelog based on recent changes —
  delegates to the @doc-updater agent for workspace-aware updates.
user-invocable: true
arguments: Optional spec name to focus on e.g. "auth-system"
---

# /update-docs

Update all project documentation by delegating to the `@doc-updater` agent.

## Instructions

Run the `@doc-updater` agent to detect changed workspaces, update workspace-level docs, and synchronize root-level tracking files (SPECLOG.md, CHANGELOG.md, tasks.md).

If `$ARGUMENTS` is provided, focus the update on the specified spec only — still update SPECLOG.md and CHANGELOG.md but scope task detection and doc updates to that spec's files and related workspaces.

If no arguments are provided, perform a full documentation update across all workspaces and specs.
