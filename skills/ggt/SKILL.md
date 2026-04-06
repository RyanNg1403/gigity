---
name: ggt
description: >
  git for AI coding sessions. Use for debugging (diff, blame, undo, log), recovering
  compacted context (find, search), analyzing costs, or transferring sessions.
  Trigger proactively when you detect context loss, need to trace file changes,
  or the user references prior work.
---

# ggt — git for AI coding sessions

All commands auto-sync fresh data and are read-only (except `undo`). Session IDs support prefix matching (first 4-8 chars). All path flags resolve `.` to cwd.

---

## Debug: what changed and why

```bash
# What did the last session change?
ggt diff --stat                           # file summary
ggt diff                                  # full net diffs

# What changed in a specific function?
ggt diff --grep=parseConfig               # only hunks touching parseConfig

# Who changed this file?
ggt blame src/lib/db.ts

# Who wrote lines 40-50? (traces back to user prompt + Claude's reasoning)
ggt blame src/lib/db.ts -L 40,50

# History of a file across sessions
ggt log src/lib/db.ts                     # compact timeline
ggt log src/lib/db.ts --grep=initSchema   # only sessions that touched initSchema
ggt log src/lib/db.ts --explain           # edit-by-edit: user prompt → Claude intent → diff

# Revert the last session's changes
ggt undo --dry-run                        # preview
ggt undo                                  # apply
ggt undo --file=src/lib/db.ts             # one file only
```

`diff`, `undo`, and `log --explain` default to the **last session in the current project** when no session ID is given.

For full flags: read `references/debug.md`

---

## Recover compacted context

```bash
# Find a session by what was said in it (defaults to current project)
ggt find "decided to use Postgres"
ggt find "rate limiting" --all --limit=5  # search all projects

# Search message content across sessions
ggt messages search "authentication bug" --project=. --limit=5

# Read the conversation around a match
ggt messages list <session-prefix> --offset=<N-3> --limit=10 --full
```

For full flags: read `references/search.md`

---

## Investigate a file

When you need to understand why a file looks the way it does:

```bash
# Step 1: who touched it?
ggt blame src/lib/db.ts

# Step 2: what specifically changed? (pick a session from blame)
ggt log src/lib/db.ts --net               # net diff per session

# Step 3: why was line 42 written?
ggt blame src/lib/db.ts -L 42

# Step 4: full motivation chain for a session
ggt log src/lib/db.ts --explain --session=abc123
```

---

## Cost

```bash
ggt cost                                  # current project total
ggt cost --all --by=project               # per-project breakdown
ggt cost --by=day --after=2026-04-01      # daily trend
ggt cost --by=model                       # model breakdown
```

---

## Transfer sessions

```bash
# One command: search → export → import
ggt oneshot "fix the auth bug" -p ../target-project

# Or step by step
ggt sessions export abc123 -o handoff
ggt sessions import handoff.tar.gz --project-dir .
```

For full flags: read `references/transfer.md`

---

## How sessions work

- **Compaction** does NOT create a new session — messages stay in the JSONL, only in-memory context is summarized. This is why context gets "lost" but is still searchable with ggt.
- **Plan mode exit** and **`/clear`** DO create new sessions. Adjacent sessions with close timestamps are continuations — search both.
- **`is_sidechain`** sessions are sub-conversations from the Agent tool.

## SQL escape hatch

```bash
ggt sql "SELECT COUNT(*) FROM sessions"
```

For DB schema and query patterns: read `references/schema.md`
