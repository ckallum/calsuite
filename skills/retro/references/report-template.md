# Retro Output Templates

The JSON snapshot schema (Step 12) and the narrative report structure (Steps 12-15) for `/retro`. SKILL.md keeps the control flow inline and points here for the verbatim shapes. The JSON snapshot is the only file `/retro` writes; everything else in this file is emitted to the conversation.

---

## JSON snapshot schema (Step 12)

Save to `.context/retros/<date>.json` after `mkdir -p .context/retros`:

```json
{
  "date": "2026-03-12",
  "window": "7d",
  "metrics": {
    "commits": 47,
    "prs_merged": 12,
    "insertions": 3200,
    "deletions": 800,
    "net_loc": 2400,
    "test_loc": 1300,
    "test_ratio": 0.41,
    "active_days": 6,
    "sessions": 14,
    "deep_sessions": 5,
    "avg_session_minutes": 42,
    "loc_per_session_hour": 350,
    "feat_pct": 0.40,
    "fix_pct": 0.30,
    "peak_hour": 22
  },
  "streak_days": 47,
  "tweetable": "Week of Mar 8: 47 commits, 3.2k LOC, 38% tests, 12 PRs, peak: 10pm"
}
```

---

## Narrative report template (Steps 13-15)

Telemetry (Step 13) and the learning loop (Step 14) feed into the narrative written in Step 15. Emit the full report to the conversation in this order.

### Step 13 — Skill Usage Telemetry output

```
### Skill Usage
Top 5: /ship (12), /review (8), /debug (5), /plan (4), /context7 (3)
Heavy use → consider automating: /babysit-pr (7× — run via /loop?)
Never used in window (excluding the current /retro run): /plan-ceo — keep or drop from profile?
```

### Step 14 — Learning loop proposals

```
### Proposed Skill Updates
- Improve: "XL PRs slipped through unsplit"
  → Edit skills/ship/SKILL.md Step 6: add hard rule — abort if diff > 1500 LOC without explicit override.
- Improve: "Fix-ratio 60% on auth module"
  → Edit skills/review/SKILL.md: add auth-module checklist (regression tests required).
```

Do **not** apply the edits automatically. Print the proposals and ask (AskUserQuestion) whether to apply each one.

### Step 15 — Full narrative structure

**Tweetable summary** (first line):
```
Week of Mar 8: 47 commits, 3.2k LOC, 38% tests, 12 PRs, peak: 10pm | Streak: 47d
```

## Engineering Retro: [date range]

### Summary Table
(from Step 2)

### Trends vs Last Retro
(from Step 11 — skip if first retro)

### Time & Session Patterns
(from Steps 3-4)
- When the most productive hours are
- Whether sessions are getting longer or shorter
- Estimated hours per day of active coding

### Shipping Velocity
(from Steps 5-7)
- Commit type mix
- PR size discipline
- Fix-chain detection

### Code Quality Signals
- Test LOC ratio trend
- Hotspot analysis
- Any XL PRs that should have been split

### Focus & Highlights
(from Step 8)
- Focus score with interpretation
- Ship of the week callout

### Top 3 Wins
3 highest-impact things shipped. For each: what, why it matters, what's impressive.

### 3 Things to Improve
Specific, actionable, anchored in actual commits.

### 3 Habits for Next Week
Small, practical, realistic. Each takes <5 minutes to adopt.

### Week-over-Week Trends
(if applicable, from Step 9)

### Skill Usage
(from Step 13 — omit if telemetry file missing)

### Proposed Skill Updates
(from Step 14 — opt-in)
