# AFK merge/gate loop — Requirements

**Status:** proposed, 2026-10-07. Design: [design.md](design.md). Tasks: [tasks.md](tasks.md).

This is the fourth AFK loop. The review loop (`skills/afk-review`) and the fix loop (`skills/afk-fix`) are live. On 2026-10-07 the trial PR #145 went enrol → review BLOCKED → fix → re-review PASS → `auto:ready` with no human involved, and then it stopped. `auto:ready` has no owner, so nothing tells the maintainer the PR is ready, and nothing notices when it stops being ready.

## User stories

- As the maintainer, I want a phone notification when an `auto:ready` PR is actually safe to merge, so I stop polling GitHub.
- As the maintainer, I want a PR that stops being safe after review to leave `auto:ready`, with the reason written on it, so the label never lies. "Stops being safe" covers new commits, red CI, a conflict and requested changes.
- As the maintainer, I want the gate to spend zero Claude tokens and to work while my laptop is closed.

## Functional requirements

1. **FR-1 Select.** Every run evaluates all **open** PRs labelled `auto:ready`. Closed and merged PRs keep their labels today: #132, #139, #144 and #145 all still carry `auto:ready`. So selection must filter on state.
2. **FR-2 Evaluate.** Each PR gets exactly one outcome from the [gate table](design.md#gate-table): `READY`, `WAIT`, `BOUNCE`, `FAIL(gate)`, `skipped` or `error`.
3. **FR-3 Notify on READY.**
   - Post one comment per (PR, head SHA). It @mentions the notify target and carries a hidden `afk-gate ready` marker.
   - The label stays `auto:ready`.
   - A later run at the same SHA writes nothing.
4. **FR-4 Escalate on FAIL.**
   - Comment first, naming the gate in a fixed vocabulary.
   - Then move `auto:ready` → `auto:needs-human`, and only if the comment landed.
   - Never leave `auto:needs-human` alongside `auto:ready`. The gate skips such a PR silently (it's in the inbox), so a stale `auto:ready` would linger on it.
5. **FR-5 Bounce an unreviewed head.**
   - When no trusted review marker exists for the current head, comment and then move `auto:ready` → `auto:needs-review`, so the review loop re-reviews the new commits.
   - After 3 bounces on one PR, FAIL instead (`bounce-cap`).
6. **FR-6 Wait.**
   - `WAIT` writes nothing.
   - A `WAIT` whose current cause has lasted more than 24 h becomes `FAIL(stuck)`. The clock starts when that cause began, not when the label was applied: a PR that was announced ready days ago and then briefly reads `UNKNOWN` after a merge to its base must not escalate.
   - Drafts are held with no cap. A human drafted the PR on purpose.
7. **FR-7 Never merge.**
   - v1 has no merge path.
   - A future merge mode must use `gh pr merge --match-head-commit <sha>` and never `--auto`. `--auto` enables auto-merge when required checks haven't passed.
8. **FR-8 Modes.**
   - A repo variable selects `off`, `dry-run` or `on`.
   - The default is `dry-run`, which writes only the run summary.
9. **FR-9 Report.** Each run writes a job summary with one line per PR: `#N → ready (notified | already notified) | wait (<cause>) | needs-review (unreviewed head) | needs-human (<gate>) | skipped (<why>) | error (<why>)`.
10. **FR-10 Authenticated review markers.** Delivered with this spec; closes #141.
    - The review loop's SHA marker records its verdict.
    - The marker counts only when its author is the loop's own login.

## Non-functional requirements

1. **NFR-1 Zero tokens.** No Claude session, model call or Desktop routine.
2. **NFR-2 Unattended.** It runs while the maintainer's machine is off.
3. **NFR-3 Fail closed.**
   - An API error, or a GraphQL `errors` entry for a PR, makes that PR `error` for the run: no writes. The job then finishes red, which GitHub emails.
   - A truncated connection, or an enum value the gate doesn't know, is `WAIT`.
   - Neither is ever `READY`.
   - Missing required configuration fails the job loudly and writes nothing.
4. **NFR-4 Safe on a public repo.**
   - Never checks out or runs PR code.
   - Trusts review markers only from the configured loop login, and its own markers only from `github-actions[bot]`.
   - Never echoes strings the PR author controls (titles, branch names) into comments. Check names appear only after sanitising, inside code spans.
5. **NFR-5 Idempotent.** Any number of runs over unchanged GitHub state produce no new writes.
6. **NFR-6 Fresh-clone test.**
   - Merging the workflow files is the install.
   - Setup is two documented commands: `gh variable set AFK_LOOP_LOGIN` (required), and `gh variable set AFK_GATE_MODE --body on` to leave `dry-run` once the dry-run summary looks right.
   - No maintainer paths and nothing untracked.
7. **NFR-7 Latency.**
   - Common case: about 1 minute from the review loop's marker comment to the notification.
   - Worst case: about 1 hour, via the scheduled sweep.
8. **NFR-8 Testable.** Gate evaluation is a pure function over a PR snapshot. It is unit-tested in CI with fixtures captured from real PRs.

## Out of scope

- **Merging,** including GitHub auto-merge. `allow_auto_merge` is off on calsuite.
- **Enforced mode.** An `afk/gate` commit status made required by a ruleset, so the merge button itself refuses an ungated head. Noted as [v2](design.md#v2-enforced-mode).
- **Repos other than calsuite.** The installer copies nothing into `.github/`. `afk-enroll.yml` has the same gap; solve both together.
- **Fork policy upstream of the gate.** `afk-enroll` enrols fork PRs, so the review loop spends tokens on them. The gate never announces a fork as ready. Whether to enrol forks at all is a separate issue.
- **babysit-pr's own "ready to merge" banner.** It fires on green CI regardless of review. Reconciling it with the gate is a separate issue.
- **macOS banners.** A read-only local notifier can come later.
- **Removing `auto:*` labels from closed PRs.**
