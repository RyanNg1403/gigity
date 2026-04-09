---
name: ggt
description: >
  git for AI coding sessions. Use for debugging (diff, blame, undo, log), recovering
  compacted context (find, search), analyzing costs, or transferring sessions.
  Trigger proactively when you detect context loss, need to trace file changes,
  or the user references prior work.
---

# ggt — git for AI coding sessions

All commands auto-sync fresh data and are read-only (except `undo`). Session IDs support prefix matching (first 4-8 chars) — ambiguous prefixes error with a list of matches. All path flags resolve `.` to cwd. Commands that default to "current project" also prefer the **current git branch** when resolving sessions.

**Syntax:** `diff`, `undo`, `log --explain` take session ID as a **positional arg** (`ggt diff abc123`), not a flag. `log` and `blame` take **file** as a positional arg — they are file-scoped, not session-scoped. Use `sessions list`, `find`, or `cost` for session-level overview.

**Output parsing:** Use `--json` when you need to extract specific fields (session IDs, scores, costs). Use `--no-color` on `diff`, `log`, `blame` to strip ANSI escape codes for cleaner text parsing. Both flags work on all commands.

---

## Context efficiency rules

**Never start with full output.** Always narrow first, then drill:

1. `--stat` or `--grep` before raw `diff` — get the summary or filter to one function
2. `blame` before `log` — know which session matters before loading diffs
3. `-L` on blame — pinpoint lines, don't load the whole file history
4. `--grep` on log — only sessions touching the relevant code, not all sessions
5. **Never `messages list --full` without narrowing first** — user messages often contain pasted files, API responses, and tool dumps that can be thousands of lines

**Dangerous (context-blowing):**
- `ggt diff` on a large session with no filters — can dump hundreds of lines
- `ggt log <file> --patch` on a frequently edited file — full diffs for every session
- `ggt log <file> --explain` with no `--grep` or `-L` — dumps every edit in the session
- `ggt messages list <id> --full` with high `--limit` — user messages can contain entire pasted files, JSON payloads, and tool outputs of unpredictable size

**Safe (token-efficient):**
- `ggt diff --stat` → `ggt diff --grep=functionName` → `ggt diff --file=path`
- `ggt blame file -L 40,50` → one answer, minimal output
- `ggt log file` (compact) → `ggt log file --grep=term` → `ggt log file --explain --session=X`
- `ggt log file --explain --grep=fn` → only edits touching `fn`, skips the rest
- `ggt log file --explain -L 40,50` → only edits affecting those lines
- `ggt messages list <id> --limit=10` (truncated) → scan topics → `messages search "term" --session=<id>` → `messages list <id> --offset=N --limit=1 --full` on the one that matters

---

## Debug: what changed and why

```bash
# Step 1: summary first (ALWAYS start here)
ggt diff --stat

# Step 2: narrow to what matters
ggt diff --grep=parseConfig               # only hunks touching parseConfig
ggt diff --file=src/lib/db.ts             # one file only

# Who changed this file?
ggt blame src/lib/db.ts

# Who wrote lines 40-50? (most focused — one answer)
ggt blame src/lib/db.ts -L 40,50

# File history — start compact, drill if needed
ggt log src/lib/db.ts                     # compact timeline (safe)
ggt log src/lib/db.ts --grep=initSchema   # only sessions that touched initSchema
ggt log src/lib/db.ts --explain --session=abc123  # specific session motivations
ggt log src/lib/db.ts --explain --grep=initSchema # only edits touching initSchema
ggt log src/lib/db.ts --explain -L 40,50  # only edits affecting lines 40-50

# Revert
ggt undo --dry-run                        # preview first
ggt undo --file=src/lib/db.ts             # one file only
ggt undo --force                          # skip divergence check

# Compare two sessions
ggt compare abc123 def456                 # full diff A→B
ggt compare abc123 def456 --stat          # summary only
```

`diff`, `undo`, and `log --explain` default to the **last session in the current project on the current branch** when no session ID is given. Use `--branch` on `find`, `log`, `blame`, `cost` to filter by branch.

For full flags: read `references/debug.md`

---

## Recover compacted context

```bash
# Find a session by what was said in it (defaults to current project)
ggt find "decided to use Postgres"
ggt find "rate limiting" --all --limit=5  # search all projects

# Search message content across sessions
ggt messages search "authentication bug" --project=. --limit=5

# Read the conversation around a match — narrow first, then --full
ggt messages list <session-prefix> --limit=10         # truncated scan
ggt messages list <session-prefix> --offset=N --limit=1 --full  # one message
```

For full flags: read `references/search.md`

---

## Investigate a file

When you need to understand why a file looks the way it does:

```bash
# Step 1: who touched it?
ggt blame src/lib/db.ts

# Step 2: what specifically changed? (pick a session from blame)
ggt log src/lib/db.ts --patch               # net diff per session

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
ggt cost --by=branch                      # branch breakdown
```

---

## Transfer sessions

```bash
# One command: search → export → import
ggt oneshot "fix the auth bug" -d ../target-project

# Or step by step
ggt sessions export abc123 -o handoff
ggt sessions import handoff.tar.gz --dest .
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
