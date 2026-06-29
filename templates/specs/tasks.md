# Tasks: [Spec Name]

<!--
OPTIONAL dependency annotations — read by `/roadmap` to draw the dependency
tree (critical path, sequential vs parallelisable). Plain `- [ ] ...` tasks
still work; without annotations, /roadmap infers deps from phase order (phases
run in sequence, tasks within a phase run in parallel).

To annotate, give a task a bold **ID** and an optional trailing `— deps: …`:

  - [ ] **T1** Scaffold the data model
  - [ ] **T2** Build the API client — deps: T1
  - [ ] **T3** Wire the UI — deps: T1, T2

IDs are short and unique across the file (T1, API-1, whatever). `deps:` lists
the IDs this task waits on. Mix annotated and plain tasks freely.
-->

## Phase 1: [Phase Name]
- [ ] Task description
- [ ] Task description

## Phase 2: [Phase Name]
- [ ] Task description
- [ ] Task description

## Completed
<!-- Move completed tasks here with date -->

## Blocked
<!-- Tasks that are blocked, with reason -->
