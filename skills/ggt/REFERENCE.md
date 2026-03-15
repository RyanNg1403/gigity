# ggt CLI Reference

Read this file when you need detailed schema information or query examples for `ggt sql`.

## Database Schema

### sessions
The main table. One row per Claude Code session.

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                    -- UUID, e.g. "f81f7a58-467e-4026-b0ba-04967a91f0df"
  project_id TEXT REFERENCES projects(id),-- Encoded folder name, e.g. "-Users-foo-my-project"
  first_prompt TEXT,                      -- First user message (up to 200 chars)
  summary TEXT,                           -- Auto-generated summary (may be NULL)
  message_count INTEGER DEFAULT 0,        -- Total user + assistant + system messages
  created_at TEXT,                        -- ISO-8601 timestamp
  modified_at TEXT,                       -- ISO-8601 timestamp
  git_branch TEXT,                        -- Branch at session start, NULL if unknown
  duration_ms INTEGER,                    -- Wall-clock duration (last - first timestamp)
  total_input_tokens INTEGER DEFAULT 0,   -- Non-cached input tokens
  total_output_tokens INTEGER DEFAULT 0,  -- Output tokens
  total_cache_read_tokens INTEGER DEFAULT 0,    -- Cache hits (cheap reads)
  total_cache_creation_tokens INTEGER DEFAULT 0,-- Cache writes (expensive)
  model_used TEXT,                        -- Primary model, e.g. "claude-sonnet-4-6"
  tool_call_count INTEGER DEFAULT 0,      -- Total tool invocations
  compression_count INTEGER DEFAULT 0,    -- Number of context compaction events
  jsonl_path TEXT,                        -- Absolute path to JSONL transcript file
  jsonl_mtime REAL,                       -- File modification time (for incremental sync)
  is_sidechain INTEGER DEFAULT 0          -- 1 if spawned by Agent tool
);
```

### projects
One row per project directory found in `~/.claude/projects/`.

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,          -- Encoded folder name, e.g. "-Users-foo-my-project"
  original_path TEXT,           -- Decoded path, e.g. "/Users/foo/my-project"
  name TEXT,                    -- Basename, e.g. "my-project"
  session_count INTEGER DEFAULT 0,
  last_activity TEXT            -- ISO-8601 timestamp of most recent session
);
```

### messages
One row per message. Contains token metadata but NOT message content (use `ggt messages list` for content).

```sql
CREATE TABLE messages (
  uuid TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  parent_uuid TEXT,                     -- For threading
  type TEXT,                            -- "user", "assistant", or "system"
  timestamp TEXT,                       -- ISO-8601
  model TEXT,                           -- Model used for this specific message
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_creation_tokens INTEGER DEFAULT 0,
  tool_names TEXT,                      -- JSON array, e.g. '["Bash","Read","Edit"]'
  has_thinking INTEGER DEFAULT 0,       -- 1 if extended thinking was used
  seq INTEGER                           -- Sequence number within session
);
```

### tool_calls
One row per tool invocation.

```sql
CREATE TABLE tool_calls (
  id TEXT PRIMARY KEY,
  message_uuid TEXT REFERENCES messages(uuid),
  session_id TEXT REFERENCES sessions(id),
  tool_name TEXT,               -- e.g. "Bash", "Read", "Edit", "Write", "Grep", "Agent"
  timestamp TEXT
);
```

### daily_stats
Aggregated daily metrics imported from `~/.claude/stats-cache.json`.

```sql
CREATE TABLE daily_stats (
  date TEXT PRIMARY KEY,        -- YYYY-MM-DD
  message_count INTEGER,
  session_count INTEGER,
  tool_call_count INTEGER,
  tokens_by_model TEXT          -- JSON object, e.g. '{"claude-sonnet-4-6": 150000}'
);
```

### sessions_fts (FTS5)
Full-text search on session-level text. Only indexes `first_prompt` and `summary`, not message content. For message-level search, use `ggt messages search` instead.

```sql
CREATE VIRTUAL TABLE sessions_fts USING fts5(
  session_id UNINDEXED,
  first_prompt,
  summary,
  content='',
  tokenize='unicode61'
);

-- Usage:
SELECT session_id FROM sessions_fts WHERE sessions_fts MATCH 'keyword';
```

### Indexes
```
idx_sessions_project  ON sessions(project_id)
idx_sessions_created  ON sessions(created_at)
idx_messages_session  ON messages(session_id)
idx_messages_type     ON messages(type)
idx_tool_calls_session ON tool_calls(session_id)
idx_tool_calls_name   ON tool_calls(tool_name)
```

---

## Cost Estimation Formula

Costs are per 1M tokens. Use this formula in SQL queries:

```sql
ROUND(
  (total_input_tokens * 5.0
   + total_output_tokens * 25.0
   + total_cache_read_tokens * 0.5
   + total_cache_creation_tokens * 10.0
  ) / 1000000, 2
) AS est_cost
```

These are default rates (Opus 4.6). For multi-model accuracy, join on `model_used` and use per-model rates:

| Model | Input | Output | Cache Read | Cache Write |
|-------|-------|--------|------------|-------------|
| claude-opus-4-6 | $5 | $25 | $0.50 | $10 |
| claude-opus-4-5-20251101 | $5 | $25 | $0.50 | $10 |
| claude-opus-4-1-20250805 | $15 | $75 | $1.50 | $30 |
| claude-sonnet-4-6 | $3 | $15 | $0.30 | $6 |
| claude-sonnet-4-5-20250929 | $3 | $15 | $0.30 | $6 |
| claude-haiku-4-5-20251001 | $1 | $5 | $0.10 | $2 |

---

## Common Query Patterns

### Aggregations

```sql
-- Total sessions, messages, and cost
SELECT COUNT(*) as sessions,
  SUM(message_count) as messages,
  SUM(tool_call_count) as tools,
  ROUND(SUM(total_output_tokens * 25.0 + total_input_tokens * 5.0
    + total_cache_read_tokens * 0.5 + total_cache_creation_tokens * 10.0) / 1000000, 2) as est_cost
FROM sessions

-- Per-project summary
SELECT p.name, p.original_path, COUNT(s.id) as sessions,
  SUM(s.message_count) as msgs, SUM(s.tool_call_count) as tools,
  ROUND(SUM(s.total_output_tokens * 25.0 + s.total_input_tokens * 5.0
    + s.total_cache_read_tokens * 0.5 + s.total_cache_creation_tokens * 10.0) / 1000000, 2) as est_cost
FROM projects p LEFT JOIN sessions s ON p.id = s.project_id
GROUP BY p.id ORDER BY est_cost DESC

-- Per-model summary
SELECT model_used, COUNT(*) as sessions,
  SUM(message_count) as msgs, SUM(compression_count) as compressions,
  ROUND(AVG(message_count), 1) as avg_msgs,
  ROUND(SUM(total_output_tokens * 25.0 + total_input_tokens * 5.0
    + total_cache_read_tokens * 0.5 + total_cache_creation_tokens * 10.0) / 1000000, 2) as est_cost
FROM sessions WHERE model_used IS NOT NULL
GROUP BY model_used ORDER BY est_cost DESC

-- Daily cost trend
SELECT DATE(created_at) as day, COUNT(*) as sessions,
  ROUND(SUM(total_output_tokens * 25.0 + total_input_tokens * 5.0
    + total_cache_read_tokens * 0.5 + total_cache_creation_tokens * 10.0) / 1000000, 2) as est_cost
FROM sessions WHERE created_at >= '2026-03-01'
GROUP BY day ORDER BY day
```

### Filtering & Finding

```sql
-- Sessions with context compressions (long/complex sessions)
SELECT s.id, p.name, s.message_count, s.compression_count, s.first_prompt
FROM sessions s JOIN projects p ON s.project_id = p.id
WHERE s.compression_count > 0
ORDER BY s.compression_count DESC

-- Most expensive sessions
SELECT id, first_prompt, model_used, message_count,
  ROUND((total_output_tokens * 25.0 + total_input_tokens * 5.0
    + total_cache_read_tokens * 0.5 + total_cache_creation_tokens * 10.0) / 1000000, 2) as est_cost
FROM sessions ORDER BY est_cost DESC LIMIT 10

-- Sessions on a specific git branch
SELECT s.id, s.created_at, s.message_count, s.first_prompt
FROM sessions s WHERE s.git_branch = 'feature/auth'
ORDER BY s.created_at DESC

-- Sessions in a date range
SELECT s.id, p.name, s.created_at, s.message_count, s.first_prompt
FROM sessions s JOIN projects p ON s.project_id = p.id
WHERE s.created_at BETWEEN '2026-03-10' AND '2026-03-15T23:59:59'
ORDER BY s.created_at DESC

-- Find sessions by prompt keyword (FTS5)
SELECT s.id, s.first_prompt, s.message_count
FROM sessions s
WHERE s.id IN (SELECT session_id FROM sessions_fts WHERE sessions_fts MATCH 'migration')
ORDER BY s.created_at DESC

-- Adjacent sessions (likely continuations of same work)
SELECT s.id, s.created_at, s.message_count, s.first_prompt
FROM sessions s WHERE s.project_id = (
  SELECT project_id FROM sessions WHERE id = '<session-id>'
)
ORDER BY s.created_at DESC LIMIT 5
```

### Tool Analysis

```sql
-- Most used tools overall
SELECT tool_name, COUNT(*) as uses
FROM tool_calls GROUP BY tool_name ORDER BY uses DESC LIMIT 15

-- Tool usage by project
SELECT p.name, tc.tool_name, COUNT(*) as uses
FROM tool_calls tc
JOIN sessions s ON tc.session_id = s.id
JOIN projects p ON s.project_id = p.id
GROUP BY p.name, tc.tool_name
ORDER BY p.name, uses DESC

-- Tool call density per session (which sessions were most tool-heavy)
SELECT id, first_prompt, message_count, tool_call_count,
  ROUND(CAST(tool_call_count AS REAL) / message_count, 2) as tools_per_msg
FROM sessions WHERE message_count > 10
ORDER BY tools_per_msg DESC LIMIT 10

-- Which tools were used in a specific session
SELECT tool_name, COUNT(*) as uses
FROM tool_calls WHERE session_id LIKE '<prefix>%'
GROUP BY tool_name ORDER BY uses DESC
```

### Token Analysis

```sql
-- Sessions with highest output token count (most verbose Claude responses)
SELECT id, first_prompt, model_used, total_output_tokens
FROM sessions ORDER BY total_output_tokens DESC LIMIT 10

-- Cache efficiency: ratio of cache reads to total input
SELECT id, first_prompt,
  total_input_tokens as fresh_input,
  total_cache_read_tokens as cached_input,
  CASE WHEN (total_input_tokens + total_cache_read_tokens) > 0
    THEN ROUND(CAST(total_cache_read_tokens AS REAL) /
      (total_input_tokens + total_cache_read_tokens) * 100, 1)
    ELSE 0 END as cache_hit_pct
FROM sessions WHERE total_cache_read_tokens > 0
ORDER BY cache_hit_pct DESC LIMIT 10

-- Git branch activity
SELECT git_branch, COUNT(*) as sessions, SUM(message_count) as msgs,
  SUM(tool_call_count) as tools
FROM sessions
WHERE git_branch IS NOT NULL AND git_branch != ''
GROUP BY git_branch ORDER BY sessions DESC LIMIT 15
```

### Schema Introspection

```sql
-- List all tables
SELECT name FROM sqlite_master WHERE type='table' ORDER BY name

-- Show columns of a table
PRAGMA table_info(sessions)

-- Count rows in each table
SELECT 'sessions' as tbl, COUNT(*) as rows FROM sessions
UNION ALL SELECT 'messages', COUNT(*) FROM messages
UNION ALL SELECT 'tool_calls', COUNT(*) FROM tool_calls
UNION ALL SELECT 'projects', COUNT(*) FROM projects
UNION ALL SELECT 'daily_stats', COUNT(*) FROM daily_stats
```

---

## CLI Command Quick Reference

| Command | Purpose | Key Flags |
|---------|---------|-----------|
| `ggt projects list` | List projects | `--json` |
| `ggt sessions list` | List sessions | `--project`, `--model`, `--after`, `--before`, `--branch`, `--limit`, `--json` |
| `ggt sessions show <id>` | Session detail | `--json` (prefix match on id) |
| `ggt messages list <id>` | Read messages | `--type`, `--offset`, `--limit`, `--full`, `--json` |
| `ggt messages search <q>` | Search content | `--project`, `--session`, `--type`, `--limit`, `--json` |
| `ggt sql <query>` | Raw SQL | `--json` (SELECT/EXPLAIN/PRAGMA only) |

All commands support `--json` for piping to `jq` or `python3`.
Session IDs support prefix matching — use first 4-8 chars instead of the full UUID.
