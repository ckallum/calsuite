# Retro Data-Gathering Agent Prompts

Full prompts for the three parallel data-gathering agents dispatched in Step 1 of `/retro`. SKILL.md names each agent in one line and links here for the verbatim prompt text. Dispatch all three in a single message so they run concurrently. Substitute `<RETRO_AUTHOR>` and `<window>` before dispatching.

---

## Agent 1 — Commit metrics + LOC breakdown

```
prompt: "Gather git commit metrics for the retro. Run these commands and return ALL raw output:

1. git log origin/main --author='<RETRO_AUTHOR>' --since='<window>' --format='%H|%ai|%s' --shortstat
2. git log origin/main --author='<RETRO_AUTHOR>' --since='<window>' --format='COMMIT:%H' --numstat
3. git log origin/main --author='<RETRO_AUTHOR>' --since='<window>' --format='%s' | grep -oE '#[0-9]+' | sed 's/^#//' | sort -n | uniq | sed 's/^/#/'

Return the raw output of all three commands, clearly labeled."
description: "Commit metrics"
```

## Agent 2 — Time patterns + sessions + streak

```
prompt: "Gather git timing data for the retro. Run these commands and return ALL raw output:

1. git log origin/main --author='<RETRO_AUTHOR>' --since='<window>' --format='%at|%ai|%s' | sort -n
2. git log origin/main --author='<RETRO_AUTHOR>' --format='%ad' --date=format:'%Y-%m-%d' | sort -u

For the streak calculation: count consecutive days backward from today that have at least one commit by this author. Return the raw output and the streak count."
description: "Time patterns + streak"
```

## Agent 3 — Hotspots + history

```
prompt: "Gather file hotspot data and retro history. Run these commands:

1. git log origin/main --author='<RETRO_AUTHOR>' --since='<window>' --format='' --name-only | grep -v '^$' | sort | uniq -c | sort -rn | head -20
2. ls -t .context/retros/*.json 2>/dev/null | head -1

If a prior retro JSON exists, read it and return the contents. Return all raw output."
description: "Hotspots + history"
```
