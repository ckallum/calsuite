# Converse mode (adversarial review)

Triggered when `$ARGUMENTS` contains `--converse <cli>` (e.g. `--converse codex`, `--converse codex:o3`, `--converse claude:sonnet`). Claude and an adversary CLI review the same diff independently and in parallel, exchange findings, then debate disagreements until consensus. The consensus report replaces the normal Step 5/7/8 summary. Skip everything else in this file unless converse mode is active.

## Step 0.5: Converse Mode (Adversarial Review)

**If `$ARGUMENTS` contains `--converse <model>`:**

Both models review independently and in parallel — neither sees the other's findings. Then they exchange results and debate disagreements until consensus. The user sees which issues both found (high confidence), which were unique to each, and what got dropped as false positives.

### Parse the adversary argument

The `--converse` value can be `cli` or `cli:model` (e.g., `codex`, `codex:o3`, `claude:sonnet`).

```bash
# Parse "codex:o3" → CLI="codex", MODEL="o3"
# Parse "codex"    → CLI="codex", MODEL="" (use CLI default)
IFS=':' read -r ADVERSARY_CLI ADVERSARY_MODEL <<< "<converse-value>"
```

### Supported CLIs and model flags

| CLI | Model flag | Default model | Non-interactive invocation |
|-----|-----------|---------------|---------------------------|
| `codex` | `-m <model>` | CLI default | `codex exec [-m <model>] -o "$CONVERSE_TMPDIR/file.txt" -` |
| `gemini` | `-m <model>` | CLI default | `gemini [-m <model>] -p "prompt" > "$CONVERSE_TMPDIR/file.txt"` |
| `claude` | `--model <model>` | CLI default | `claude [--model <model>] --print "prompt" > "$CONVERSE_TMPDIR/file.txt"` |

Validate the CLI is supported and installed:
```bash
# Allowlist check — reject unknown CLIs immediately (prevents arbitrary command injection from $ARGUMENTS)
case "$ADVERSARY_CLI" in
  codex|gemini|claude) ;;
  *) echo "Unsupported CLI: $ADVERSARY_CLI (allowed: codex, gemini, claude)"; exit 1 ;;
esac

# Existence check — stop if not installed
command -v "$ADVERSARY_CLI" >/dev/null 2>&1 || {
  echo "CLI '$ADVERSARY_CLI' not found. Install it first."
  exit 1
}

# Build model flag as an array — prevents glob expansion and preserves spaces in model names.
# A scalar like MODEL_FLAG="-m $ADVERSARY_MODEL" used unquoted would word-split and glob-expand,
# and quoted would collapse "-m foo" into a single argument the CLI rejects.
MODEL_FLAG=()
if [ -n "$ADVERSARY_MODEL" ]; then
  case "$ADVERSARY_CLI" in
    codex)  MODEL_FLAG=(-m "$ADVERSARY_MODEL") ;;
    gemini) MODEL_FLAG=(-m "$ADVERSARY_MODEL") ;;
    claude) MODEL_FLAG=(--model "$ADVERSARY_MODEL") ;;
  esac
fi
```

### CLI dispatch helper

Use the appropriate invocation per CLI. All three execution phases use this pattern:
```bash
# Usage: run_adversary <output-file> [&]
# Reads prompt from stdin, writes response to <output-file>
run_adversary() {
  local outfile="$1"
  case "$ADVERSARY_CLI" in
    codex)  codex exec "${MODEL_FLAG[@]}" -o "$outfile" - ;;
    gemini) gemini "${MODEL_FLAG[@]}" -p "$(cat -)" > "$outfile" ;;
    claude) claude "${MODEL_FLAG[@]}" --print "$(cat -)" > "$outfile" ;;
  esac
}
```

### Converse workflow

**Phase 1: Both models review in parallel**

Kick off BOTH reviews simultaneously — Claude's review and the adversary's review run at the same time.

**1a. Create a unique temp directory and save the diff:**
```bash
CONVERSE_TMPDIR=$(mktemp -d /tmp/converse-XXXXXX)

# PR mode:
gh pr diff <number> > "$CONVERSE_TMPDIR/diff.txt"
# Local mode:
git diff origin/main > "$CONVERSE_TMPDIR/diff.txt"
```

**1b. Launch the adversary review as a background process:**

Start the other model's independent review in the background BEFORE Claude begins its own review. Pipe the diff and a review prompt via stdin. Use **unquoted** heredoc delimiter so `$(cat ...)` expands:

```bash
cat <<PROMPT_EOF | run_adversary "$CONVERSE_TMPDIR/adversary-review.txt" &
You are a code reviewer. Below is a diff. Perform a thorough code review.

For each issue found, output:
- [file:line] SEVERITY (CRITICAL/HIGH/MEDIUM/LOW): description
  Fix: suggested fix

Look for: security issues, race conditions, logic errors, missing error handling,
convention violations, silent failures, type safety issues, missing validation,
resource leaks, and anything that tests wouldn't catch.

DIFF:
$(cat "$CONVERSE_TMPDIR/diff.txt")
PROMPT_EOF
ADVERSARY_PID=$!
```

**1c. Run Claude's review (Steps 1-5 as normal):**

While the adversary runs in the background, proceed with the full Claude review workflow (Steps 1 through 5). Collect all findings into `CLAUDE_FINDINGS`.

**1d. Wait for the adversary to finish:**

```bash
wait $ADVERSARY_PID
```

Read the adversary's independent findings from `$CONVERSE_TMPDIR/adversary-review.txt`. Store as `ADVERSARY_FINDINGS`.

Both reviews are now complete — neither has seen the other's findings.

**Phase 2: Exchange findings and identify disagreements**

Now both models have independent findings. Send BOTH sets to the adversary and ask it to compare:

```bash
cat <<PROMPT_EOF | run_adversary "$CONVERSE_TMPDIR/round-1.txt"
You previously reviewed a diff and found these issues:

YOUR FINDINGS:
$(cat "$CONVERSE_TMPDIR/adversary-review.txt")

Another reviewer (Claude) independently found these issues:

CLAUDE'S FINDINGS:
${CLAUDE_FINDINGS}

Compare both sets of findings. For each item from EITHER reviewer:
- AGREE: <finding summary> — both reviewers found this or you confirm the other's finding
- DISAGREE: <finding from Claude> — <why you think it's wrong>
- UNIQUE_MINE: <your finding Claude missed> — <why it matters>
- UNIQUE_THEIRS: <Claude's finding you missed> — ACCEPT if valid, REJECT with reason if not

Be honest — if Claude caught something you missed, say so. If you found something they missed, explain why it matters.
PROMPT_EOF
```

Claude also independently processes the adversary's findings:
- For each adversary finding that Claude also found: mark as AGREE
- For each adversary finding Claude missed: verify against the actual code, ACCEPT or REJECT
- For each Claude finding the adversary missed: note as UNIQUE_CLAUDE

**Phase 3: Debate disagreements (max 3 rounds)**

Only debate items where the two models DISAGREE. Skip items both agree on.

For each round:

1. Read the adversary's response.
2. For each DISAGREE item: re-examine the code. Either concede (drop the finding) or defend with evidence (cite specific lines).
3. For each REJECT from the adversary on Claude's unique findings: defend with code evidence or concede.
4. Send Claude's responses back to the adversary:

```bash
cat <<PROMPT_EOF | run_adversary "$CONVERSE_TMPDIR/round-N.txt"
Continuing the code review debate. Only respond to unresolved items.

For each item, respond:
- RESOLVED: <finding> — we agree on <outcome: KEEP or DROP>
- STILL_DISAGREE: <finding> — <new evidence or reasoning>

Stop debating items marked RESOLVED.

PREVIOUS EXCHANGE:
${PREVIOUS_ROUNDS}

CLAUDE'S RESPONSE:
${CLAUDE_RESPONSE}
PROMPT_EOF
```

**Exit conditions (stop debating when ANY is true):**
- All items are RESOLVED
- Max 3 rounds reached
- Adversary response repeats previous arguments without new evidence

**Phase 4: Build consensus report**

Compile the final findings from the debate:

```markdown
## Adversarial Review: Claude × <Adversary>

### Both found independently (high confidence)
1. [file:line] Issue description — severity
   Found by both reviewers independently — very likely real.

### Claude only → accepted by adversary
1. [file:line] Issue description — severity

### Adversary only → accepted by Claude
1. [file:line] Issue description — severity

### Dropped by debate (false positives)
1. [file:line] Original finding by <reviewer> — dropped because: <reason>

### Unresolved (no consensus after 3 rounds)
1. [file:line] Finding — Claude says: X, Adversary says: Y

### Review Stats
- Claude found: N issues | Adversary found: M issues
- Both found independently: X | Unique to Claude: Y | Unique to adversary: Z
- Dropped as false positive: W | Unresolved: V
- Debate rounds: R

### Debate Log
<Round 1 — Exchange>
Claude's findings: [summary]
Adversary's findings: [summary]
<Round 2 — Disagreements>
...
```

**Phase 5: Output**

- **PR mode:** Post the consensus report as a PR comment using `gh pr comment`.
- **Local mode:** Print the consensus report to the user.

Clean up temp directory:
```bash
rm -rf "$CONVERSE_TMPDIR"
```

**Then STOP.** Do not proceed to Step 7/8 — the converse report replaces the normal summary.
