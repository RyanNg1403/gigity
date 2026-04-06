---
name: ggt
description: >
  Search and query Claude Code session history via the ggt CLI. Use when recovering
  compacted context, finding past decisions, analyzing costs, or when the user references
  prior work ("we discussed", "remember when", "what did we decide", "find where").
  Trigger proactively when you detect context loss or missing information the user expects.
---

# ggt — Claude Code Session History CLI

`ggt` queries the Gigity SQLite database (`~/.claude/gigity.db`) which indexes all Claude Code sessions, and can search full message content directly from JSONL transcript files in `~/.claude/projects/`.

All commands are read-only and safe to run without user confirmation.

**Important**: The database auto-syncs when stale (>60s). If results seem outdated, run `ggt sync` to force a re-sync.

---

## Command Reference

### `ggt projects list`
List all indexed projects sorted by session count.
```bash
ggt projects list [--json]
```

Output: `{path}  sessions={count}  last={timestamp}`

---

### `ggt sessions list`
List sessions with filtering. Results ordered by most recent first.
```bash
ggt sessions list [flags]
```

| Flag | Type | Description | Example |
|------|------|-------------|---------|
| `--project` | string | Substring match on project path or name | `--project=my-app` |
| `--model` | string | Substring match on model ID | `--model=opus` |
| `--after` | date | Sessions on or after (YYYY-MM-DD) | `--after=2026-03-10` |
| `--before` | date | Sessions on or before (YYYY-MM-DD) | `--before=2026-03-15` |
| `--branch` | string | Exact match on git branch | `--branch=main` |
| `--limit` | int | Max results (default 20) | `--limit=50` |
| `--json` | bool | JSON array output | |

All path flags (`--project`) resolve `.` to the current directory.

Output per session:
```
  {id_prefix_8}  {created_at}  {project_name}  {model}  msgs={count}  tools={count}
         {first prompt text}
```

---

### `ggt sessions show <id>`
Show full metadata for one session. Supports **prefix matching** — only the first few characters of the session ID are needed (e.g., `f81f` matches `f81f7a58-467e-4026-...`).
```bash
ggt sessions show <id-or-prefix> [--json]
```

Output includes: project path, creation time, model, message/tool/compression counts, token breakdown (input, output, cache read, cache write), estimated cost in USD, and first prompt text.

---

### `ggt messages list <session>`
Read messages from a session's JSONL transcript. Supports prefix matching on session ID.
```bash
ggt messages list <session-id> [flags]
```

| Flag | Type | Description |
|------|------|-------------|
| `--type` | `user\|assistant\|system` | Show only one message type |
| `--offset` | int | Skip first N messages (for pagination) |
| `--limit` | int | Max messages (default 20) |
| `--full` | bool | Full content (default: 200-char truncation) |
| `--json` | bool | JSON output with full text |

Output per message:
```
[{seq}] {timestamp}  YOU|CLAUDE|SYSTEM ({model})
  {message text, truncated unless --full}
```

Content extraction covers: text blocks, thinking blocks, tool_use (name + input), and tool_result content. This means tool calls and their outputs are searchable, not just conversation text.

---

### `ggt sync`
Force a full re-sync of `~/.claude/` sessions into the SQLite database. Normally not needed — all read commands auto-sync when the DB is older than 60 seconds.
```bash
ggt sync
```

---

### `ggt sessions export <id>`
Export a session bundle for handoff to another machine.
```bash
ggt sessions export <id-or-prefix> [-o output-path]
```

The `.tar.gz` extension is added automatically. Bundles: JSONL transcript, subagents, tool results, file history, project memories, MCP configs (credentials redacted), skills, agents, hooks.

---

### `ggt sessions import <archive>`
Import a session bundle. Rewrites paths, offers interactive env setup, appends a handoff message.
```bash
ggt sessions import <archive.tar.gz> --project-dir <path> [--yes] [--note "..."]
```

---

### `ggt oneshot <query>`
Search → export → import in one command. Finds a session by message content, exports it, and imports it into the target project.
```bash
ggt oneshot "<search-phrase>" -p <dest-project> [-f <source-project>] [-n <archive-name>] [-y]
```

| Flag | Type | Description |
|------|------|-------------|
| `-p, --project` | string | **(required)** Destination project directory for import |
| `-f, --from` | string | Project to search in (default: cwd) |
| `-n, --name` | string | Archive filename without `.tar.gz` (default: `imported-session`) |
| `-y, --yes` | bool | Accept all bundled env artifacts without prompting |
| `--note` | string | Note to include in the handoff message |

---

### `ggt messages search <query>`
Search message content across sessions. Exact phrase matches rank first; individual terms are weighted by length (longer = more specific). Terms under 3 characters are skipped.
```bash
ggt messages search "<query>" [flags]
```

| Flag | Type | Description |
|------|------|-------------|
| `--project` | string | Restrict search to a project (substring) |
| `--session` | string | Search within one session (prefix) |
| `--type` | `user\|assistant` | Only search user or assistant messages |
| `--limit` | int | Max results (default 10) |
| `--json` | bool | JSON with score, session_id, msg_index |

Extracts only human-readable text blocks (no tool inputs, no file paths, no JSON blobs). Returns snippets around the first match.

**Search tips:**
- Exact phrase matches rank highest — paste the exact text you're looking for
- Use distinctive terms: function names, error messages, library names — not generic words
- `--type=user` finds what the user asked; `--type=assistant` finds what Claude answered
- `--project=.` restricts search to the current working directory's project
- Reads raw JSONL files, so it works even if FTS hasn't been synced

---

### `ggt sql <query>`
Raw SQL escape hatch. Read-only: only `SELECT`, `EXPLAIN`, and `PRAGMA` are allowed.
```bash
ggt sql "<query>" [--json]
```

For the complete schema with column descriptions, cost formulas, and dozens of ready-to-use query patterns, read `REFERENCE.md` in this skill directory.

#### Database schema (quick reference)

**sessions** — One row per Claude Code session
```
id, project_id, first_prompt, summary, message_count, created_at, modified_at,
git_branch, duration_ms, model_used, tool_call_count, compression_count,
total_input_tokens, total_output_tokens, total_cache_read_tokens,
total_cache_creation_tokens, jsonl_path, is_sidechain
```

**projects** — One row per project directory
```
id, original_path, name, session_count, last_activity
```

**messages** — Message metadata (no content body — use `messages list` for that)
```
uuid, session_id, type, timestamp, model, input_tokens, output_tokens,
cache_read_tokens, cache_creation_tokens, tool_names (JSON array), has_thinking, seq
```

**tool_calls** — One row per tool invocation
```
id, message_uuid, session_id, tool_name, timestamp
```

**daily_stats** — Aggregated daily metrics
```
date, message_count, session_count, tool_call_count, tokens_by_model (JSON)
```

**sessions_fts** — FTS5 virtual table on `first_prompt` and `summary`
```sql
SELECT session_id FROM sessions_fts WHERE sessions_fts MATCH 'keyword'
```

---

## Workflow Patterns

Tested, copy-paste-ready patterns. Replace `<placeholders>` with actual values.

### 1. Recover compacted context

When you're missing information the user expects you to have, search the current project's sessions:

```bash
ggt messages search "<distinctive-term>" --project="<project-name>" --limit=5
```

If a match is found, read surrounding messages for full context:

```bash
ggt messages list <session-prefix> --offset=<msg_index minus 3> --limit=10 --full
```

### 2. Find a past decision and its reasoning

Decisions often appear in assistant messages. Search for the topic, then read the exchange:

```bash
# Find where the decision was discussed
ggt messages search "decided to use <technology>" --project=<name> --type=assistant --limit=3

# Read the full exchange — user question + Claude's reasoning
ggt messages list <session-prefix> --offset=<N-2> --limit=8 --full
```

### 3. Resume work from a previous session

When the user says "continue what we were doing" or "pick up where we left off":

```bash
# Find recent sessions in this project
ggt sessions list --project="<project-name>" --limit=5

# Read the last user messages to see where they stopped
ggt messages list <session-prefix> --type=user --offset=<msg_count minus 10> --limit=10 --full
```

### 4. Find which session modified a specific file

Tool call inputs (file paths, commands) are searchable:

```bash
ggt messages search "src/components/Auth.tsx" --project=<name> --type=assistant --limit=5
```

### 5. Summarize what was done in a date range

```bash
# All sessions from a day, across projects
ggt sessions list --after=2026-03-14 --before=2026-03-14 --limit=50

# Week overview with project breakdown
ggt sessions list --after=2026-03-10 --before=2026-03-16 --json | python3 -c "
import json,sys
for s in json.load(sys.stdin):
    print(f\"{s['created_at'][:10]}  {s['project_name']:20s}  {(s['first_prompt'] or '')[:60]}\")
"
```

### 6. Cost analysis

```bash
# Total cost by project
ggt sql "SELECT p.name, COUNT(*) as sessions, ROUND(SUM(s.total_output_tokens * 25.0 + s.total_input_tokens * 5.0 + s.total_cache_read_tokens * 0.5 + s.total_cache_creation_tokens * 10.0) / 1000000, 2) as est_cost FROM sessions s JOIN projects p ON s.project_id = p.id GROUP BY p.id ORDER BY est_cost DESC"

# Daily cost trend
ggt sql "SELECT DATE(created_at) as day, COUNT(*) as sessions, ROUND(SUM(total_output_tokens * 25.0 + total_input_tokens * 5.0 + total_cache_read_tokens * 0.5 + total_cache_creation_tokens * 10.0) / 1000000, 2) as est_cost FROM sessions WHERE created_at >= '2026-03-01' GROUP BY day ORDER BY day"

# Most expensive sessions
ggt sql "SELECT id, first_prompt, model_used, ROUND((total_output_tokens * 25.0 + total_input_tokens * 5.0 + total_cache_read_tokens * 0.5 + total_cache_creation_tokens * 10.0) / 1000000, 2) as est_cost FROM sessions ORDER BY est_cost DESC LIMIT 10"
```

### 7. Find error patterns and debugging history

```bash
ggt messages search "ENOENT" --project=<name> --limit=5
ggt messages search "TypeError: Cannot read" --project=<name> --limit=5
ggt messages search "exit code 1" --project=<name> --type=assistant --limit=5
```

### 8. Tool usage analysis

```bash
# Most-used tools
ggt sql "SELECT tool_name, COUNT(*) as uses FROM tool_calls GROUP BY tool_name ORDER BY uses DESC LIMIT 15"

# Tool usage per project
ggt sql "SELECT p.name, tc.tool_name, COUNT(*) as uses FROM tool_calls tc JOIN sessions s ON tc.session_id = s.id JOIN projects p ON s.project_id = p.id GROUP BY p.name, tc.tool_name ORDER BY p.name, uses DESC"

# Sessions with highest tool call density
ggt sql "SELECT id, first_prompt, message_count, tool_call_count, ROUND(CAST(tool_call_count AS REAL) / message_count, 2) as tools_per_msg FROM sessions WHERE message_count > 10 ORDER BY tools_per_msg DESC LIMIT 10"
```

### 9. Sessions that hit context limits

```bash
ggt sql "SELECT s.id, p.name, s.message_count, s.compression_count, s.first_prompt FROM sessions s JOIN projects p ON s.project_id = p.id WHERE s.compression_count > 0 ORDER BY s.compression_count DESC"
```

### 10. Cross-project search

Find where a concept, library, or pattern appears across all work:

```bash
ggt messages search "better-sqlite3" --limit=10
ggt messages search "rate limiting" --limit=10
ggt messages search "CORS" --limit=10
```

### 11. Composing with pipes

Chain commands using `--json` output with `jq` or `python3`:

```bash
# Get session details for all sessions matching a search
ggt messages search "database migration" --json | python3 -c "
import json,sys
seen = set()
for m in json.load(sys.stdin):
    if m['session_id'] not in seen:
        seen.add(m['session_id'])
        print(m['session_id'])
" | while read sid; do ggt sessions show "$sid"; echo '---'; done

# Find sessions in project, search each for a keyword
ggt sessions list --project=myapp --json | python3 -c "
import json,sys
for s in json.load(sys.stdin): print(s['id'])
" | while read sid; do ggt messages search 'authentication' --session="$sid" --limit=2 2>/dev/null; done
```

### 12. Git branch history

```bash
# Sessions by branch
ggt sql "SELECT git_branch, COUNT(*) as sessions, SUM(message_count) as msgs FROM sessions WHERE git_branch IS NOT NULL AND git_branch != '' GROUP BY git_branch ORDER BY sessions DESC LIMIT 15"

# All sessions on a specific branch
ggt sessions list --branch=feature/auth --limit=20
```

### 13. Model comparison

```bash
ggt sql "SELECT model_used, COUNT(*) as sessions, SUM(message_count) as total_msgs, ROUND(AVG(message_count), 1) as avg_msgs, SUM(compression_count) as compressions, ROUND(SUM(total_output_tokens * 25.0 + total_input_tokens * 5.0 + total_cache_read_tokens * 0.5 + total_cache_creation_tokens * 10.0) / 1000000, 2) as est_cost FROM sessions WHERE model_used IS NOT NULL GROUP BY model_used ORDER BY est_cost DESC"
```

---

## How Claude Code sessions work

Understanding session boundaries helps search effectively:

- **Context compaction** (`/compact` or auto-compact) does NOT create a new session. The JSONL file keeps all messages; only the in-memory context is summarized. This is the primary reason context gets "lost" — the messages are still in the file and searchable with ggt.
- **Exiting plan mode** (accepting a plan) DOES create a new session. The planning conversation and the implementation conversation become separate sessions with timestamps seconds apart.
- **`/clear`** creates a new session with a clean slate.
- **Adjacent sessions** in the same project with close timestamps are continuations of the same work — always search both when recovering context.
- **`is_sidechain`** sessions are sub-conversations spawned by the Agent tool.

When recovering lost context, always check ALL recent sessions in the project, not just the current one — the information may be in a sibling session created by plan mode or clear.
