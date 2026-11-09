# Tasks: AFK merge/gate loop

Requirements: [requirements.md](requirements.md). Design: [design.md](design.md).

## Phase 0: Authenticated review markers (this PR, closes #141)
- [x] **M1** afk-review v0.3.0 SHA-skip:
  - trusts only unedited markers by the loop's own login
  - matches the marker body exactly
  - treats any lookup failure as an error, never a skip
- [x] **M2** The afk-review marker records `verdict=ready|needs-fixes`, and is written only when the head is unchanged across the review. — deps: M1
- [x] **M3** Every afk-review block is self-contained:
  - literal `<owner/repo>`, `<N>`, `<SHA>`, `<VERDICT>` substitutions
  - the escalation reason passed through a quoted heredoc
  - one `AFKREV_*` status line per block
  - deps: M1
- [x] **M4** Identity precondition:
  - resolve the login
  - `AFK_LOOP_LOGIN` can never contradict the token
  - triage rights required when the token's repo response includes permissions; reported as unverified when it doesn't
  - report `running as`
  - deps: M1
- [x] **M5** `scripts/test-afk-review-blocks.sh` (bash and zsh, writer→reader round trip, `--mutation-check`) and a zsh sweep case in `scripts/test-afk-fix-blocks.sh`. Both wired into `checks.yml`. — deps: M2, M3, M4

## Phase 1: Gate core (pure)
- [ ] **G1** `scripts/lib/afk-gate.cjs`: marker builders and parsers for review, ready, bounce and escalate markers. — deps: M2
- [ ] **G2** `evaluate(snapshot, config, now)`: gate table, review binding, CI classification, aggregation, and the cause-anchored age cap. — deps: G1
- [ ] **G3** Fixtures in `scripts/test-fixtures/afk-gate/`: — deps: G2
  - real-PR captures: #145 final, #132 hand-labelled, #138 `NEUTRAL`
  - one synthetic case per gate-table and binding-table row
  - "ready 30 h ago, base just moved, `UNKNOWN`" → `WAIT`
  - half-finished label moves (including `auto:ready` beside a claim label) and a truncated label list
  - a required check still in progress → `WAIT(ci-pending)`; one that concluded `SKIPPED` → `FAIL(ci-failed)`
  - `REVIEW_REQUIRED` + `BLOCKED` → `READY` with the approval note; the same plus `requiresSignatures` → `FAIL(protection)`; the same with a ruleset-required check missing → `WAIT(ci-missing)`, never `READY`
  - a PR ready for days whose contexts become truncated → `WAIT(truncated)`, never `FAIL(stuck)`
  - a ruleset check with an `integrationId` satisfied by a same-name check from another app → `WAIT(ci-missing)`
  - `auto:ready` beside a claim label applied 25 h ago → `FAIL(stuck:label-race)`; applied 5 min ago → `WAIT`
  - a bounce marker with no `labeled auto:needs-review` after it → `BOUNCE` (comment skipped); with one → `FAIL(review-marker-missing)`; an unfinished bounce on a PR that already has 3 bounces in 24 h → `BOUNCE`, not `FAIL(bounce-cap)`
  - base rules truncated past the page → `WAIT(truncated)`; an app-bound required check reported as a commit status → `WAIT(ci-missing)`, named in the summary
  - the auto:* set changes between snapshot and write (a sweep drops the stale claim) → `skipped (changed during run)`, no escalation
  - a claim removed and re-applied between snapshot and write (same set, newer `labeled` event) → `skipped (changed during run)`, not `FAIL(stuck:label-race)`
  - branch protection requiring a check from one app, satisfied only by another app's same-name check → `WAIT(ci-missing)`; protection bindings unreadable + `REVIEW_REQUIRED` + `BLOCKED` → `FAIL(protection)`
  - arrival dates come from the activity log: a force-push back to the PR's first head, then `UNKNOWN` → `WAIT`, not `FAIL(stuck)`
  - marker-lag with no `labeled auto:ready` event → `WAIT`, never capped, even when the newest other label event is 25 h old
  - 3 bounces in 24 h → `FAIL(bounce-cap)`; 3 spread over a week → `BOUNCE`
  - an edited marker (`updated_at != created_at`) is untrusted; a login that differs only in case is trusted
- [ ] **G4** `node --test` suite, including a marker-drift test (skill literal vs lib regex), in `checks.yml`. — deps: G2, G3

## Phase 2: Runner
- [ ] **R1** `scripts/afk-gate.cjs`: — deps: G2
  - env config, validating `AFK_LOOP_LOGIN` and a non-empty required-checks list
  - effective-mode resolution
  - paginated GraphQL snapshot, with `errors` attributed by `path`
  - per-PR REST comments, timeline and same-repo compare
  - evaluate, then act, with a re-read before every write
  - `$GITHUB_STEP_SUMMARY`
  - a non-zero exit when any PR is `error`
- [ ] **R2** A small `gh` wrapper in the runner: — deps: R1
  - reports `ENOENT` and non-zero exits distinctly
  - keeps stdout `data` on exit 1
  - has a timeout
  - never falls back to another account
- [ ] **R3** Runner harness with a stub `gh`: — deps: R1, R2
  - write order: comment, add, remove
  - dedupe; BOUNCE marker re-check; abort on a changed head or lost label
  - `dry-run` and `off` write nothing
  - a missing `AFK_LOOP_LOGIN` fails loudly

## Phase 3: Workflows and docs
- [ ] **W1** `.github/workflows/afk-gate.yml` (events, job-level concurrency behind the comment filter on author and marker text) and `.github/workflows/afk-gate-sweep.yml` (hourly cron + dispatch, same group). Permissions, checkout ref and env as in the design; header comments in the style of `afk-enroll.yml`. — deps: R1
- [ ] **W2** Docs: — deps: W1
  - `CLAUDE.md`: key files, plus a gotcha on the review-binding contract
  - `docs/afk-loops.html`: rewrite lane 4 for Actions, and mark lanes 2–3 shipped
  - the afk-review Downstream note
  - `CHANGELOG.md`
- [ ] **W3** Setup in the workflow header and CHANGELOG: `gh variable set AFK_LOOP_LOGIN --body <login>`, then `gh variable set AFK_GATE_MODE --body on` to go live, once the `/receiving-pr-feedback` author filter has shipped. — deps: W1

## Phase 4: Rollout
- [ ] **D1** Make sure the review routine runs afk-review ≥ 0.3.0 (refresh the checkout its skills resolve from). Confirm its next marker ends in `verdict=…`; with legacy markers every PASS would be `FAIL(review-unverified)`. — deps: M2
- [ ] **D2** Merge in `dry-run`, set `AFK_LOOP_LOGIN`, run `workflow_dispatch`, and check the summary. — deps: W1, W3, D1
- [ ] **D3** Set `AFK_GATE_MODE=on`, then trial a throwaway PR through each path:
  - ready → @mention reaches the phone
  - push → bounce → re-review → ready
  - induced conflict → `FAIL(conflict)`
  - a non-marker comment during a sweep → the queued sweep survives
  - deps: D2, the `/receiving-pr-feedback` author filter (Follow-ups)
- [ ] **D4** Close out the design's "to verify while building" list, then schedule the review and fix routines. Until they're scheduled, a bounce waits for a human to run the review loop. — deps: D3

## Follow-ups (to be filed as issues)
- [ ] **Prerequisite for `AFK_GATE_MODE=on` (D3).** `/receiving-pr-feedback` has no author filter, so afk-fix acts on every commenter's feedback (security). afk-fix holds `AFK_LOOP_LOGIN`'s token, so trusted review markers rest on this filter (design.md, Security considerations).
- [ ] `/receiving-pr-feedback`'s staged-replies file is keyed by repo and PR only, so two afk-fix runs on one PR (after a sweep reset and re-claim) share it. afk-fix's claim-id check stops the stale run from publishing, but not from staging into the file; key the file by the claim id.
- [ ] Serialise concurrent afk-fix claims. Two runs passing 3.1's re-read within the same seconds both claim and share one `labeled auto:fixing` event id. A loop-authored claim comment per run, where the earliest one after the latest `labeled` event wins, would leave exactly one owner. Needed only if manual runs overlap the routine.
- [ ] afk-review per-run claim identity: port afk-fix's labeled-event claim id into afk-review's claim, transition and escalate blocks. A review that overruns the 30-min cutoff while a sibling's sweep fires can still stack `{needs-review, ready}` plus a marker.
- [ ] The two sweeps report the same conditions differently: on a list failure afk-review prints `AFKREV_ERROR … exit 1` and afk-fix `AFKFIX_OK sweep skipped … exit 0`; on a partial failure afk-review prints `AFKREV_ERROR sweep incomplete … (#n:timeline|labels|edit …)` and afk-fix `AFKFIX_OK sweep done`. Unify both halves when extracting the shared sweep ([#142](https://github.com/ckallum/calsuite/issues/142)).
- [ ] Route a SHA-skipped PR instead of leaving it: a PR in `auto:needs-review` whose head already has a trusted marker goes back to its verdict's label (`ready` → `auto:ready`, `needs-fixes` → `auto:needs-fixes`, legacy → `auto:needs-human`), so a relabel at an unchanged head isn't a dead state.
- [ ] De-duplicate the two block harnesses, `scripts/test-afk-review-blocks.sh` and `scripts/test-afk-fix-blocks.sh`, into a shared `scripts/lib/afk-harness.sh`. Also de-duplicate the three copies of afk-fix's claim-id check.
- [ ] Fork enrolment policy in `afk-enroll.yml`: forks reach the review model and spend tokens.
- [ ] babysit-pr vs the gate: duplicate "ready" banners, and a CI re-run racing an escalation.
- [ ] Remove `auto:*` labels from closed PRs (`afk-enroll.yml`, `closed`).
- [ ] v2 enforced mode: a required `afk/gate` status via a ruleset.
- [ ] Distribute `afk-enroll.yml` and the gate workflows to target repos.

## Completed
- 2026-10-07: M1–M5

## Blocked
