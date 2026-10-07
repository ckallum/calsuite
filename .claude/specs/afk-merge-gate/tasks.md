# Tasks: AFK merge/gate loop

Requirements: [requirements.md](requirements.md). Design: [design.md](design.md).

## Phase 0: Authenticated review markers (this PR, closes #141)
- [x] **M1** afk-review v0.3.0 SHA-skip:
  - trusts only the loop's own login
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
  - require triage rights
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
- [ ] **W1** `.github/workflows/afk-gate.yml` (events, job-level concurrency behind the comment filter) and `.github/workflows/afk-gate-sweep.yml` (hourly cron + dispatch, same group). Permissions, checkout ref and env as in the design; header comments in the style of `afk-enroll.yml`. — deps: R1
- [ ] **W2** Docs: — deps: W1
  - `CLAUDE.md`: key files, plus a gotcha on the review-binding contract
  - `docs/afk-loops.html`: rewrite lane 4 for Actions, and mark lanes 2–3 shipped
  - the afk-review Downstream note
  - `CHANGELOG.md`
- [ ] **W3** Setup in the workflow header and CHANGELOG: `gh variable set AFK_LOOP_LOGIN --body <login>`, then `gh variable set AFK_GATE_MODE --body on` to go live. — deps: W1

## Phase 4: Rollout
- [ ] **D1** Make sure the review routine runs afk-review ≥ 0.3.0 (refresh the checkout its skills resolve from). Confirm its next marker ends in `verdict=…`; with legacy markers every PASS would be `FAIL(review-unverified)`. — deps: M2
- [ ] **D2** Merge in `dry-run`, set `AFK_LOOP_LOGIN`, run `workflow_dispatch`, and check the summary. — deps: W1, W3, D1
- [ ] **D3** Set `AFK_GATE_MODE=on`, then trial a throwaway PR through each path: — deps: D2
  - ready → @mention reaches the phone
  - push → bounce → re-review → ready
  - induced conflict → `FAIL(conflict)`
  - a non-marker comment during a sweep → the queued sweep survives
- [ ] **D4** Close out the design's "to verify while building" list, then schedule the review and fix routines. Until they're scheduled, a bounce waits for a human to run the review loop. — deps: D3

## Follow-ups (to be filed as issues)
- [ ] `/receiving-pr-feedback` has no author filter, so afk-fix acts on every commenter's feedback (security).
- [ ] Fork enrolment policy in `afk-enroll.yml`: forks reach the review model and spend tokens.
- [ ] babysit-pr vs the gate: duplicate "ready" banners, and a CI re-run racing an escalation.
- [ ] Remove `auto:*` labels from closed PRs (`afk-enroll.yml`, `closed`).
- [ ] v2 enforced mode: a required `afk/gate` status via a ruleset.
- [ ] Distribute `afk-enroll.yml` and the gate workflows to target repos.

## Completed
- 2026-10-07: M1–M5

## Blocked
