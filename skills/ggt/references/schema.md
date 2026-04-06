# Database Schema & SQL Reference

Read this when you need `ggt sql` queries or schema details.

## Tables

### sessions
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                    -- UUID
  project_id TEXT REFERENCES projects(id),
  first_prompt TEXT,                      -- First user message (up to 200 chars)
  summary TEXT,
  message_count INTEGER DEFAULT 0,
  created_at TEXT,                        -- ISO-8601
  modified_at TEXT,
  git_branch TEXT,
  duration_ms INTEGER,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  total_cache_read_tokens INTEGER DEFAULT 0,
  total_cache_creation_tokens INTEGER DEFAULT 0,
  model_used TEXT,
  tool_call_count INTEGER DEFAULT 0,
  compression_count INTEGER DEFAULT 0,
  jsonl_path TEXT,
  jsonl_mtime REAL,
  is_sidechain INTEGER DEFAULT 0
);
```

### projects
```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,          -- Encoded folder name
  original_path TEXT,           -- Decoded path, e.g. "/Users/foo/my-project"
  name TEXT,                    -- Basename
  session_count INTEGER DEFAULT 0,
  last_activity TEXT
);
```

### messages
```sql
CREATE TABLE messages (
  uuid TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  parent_uuid TEXT,
  type TEXT,                            -- "user", "assistant", "system"
  timestamp TEXT,
  model TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_creation_tokens INTEGER DEFAULT 0,
  tool_names TEXT,                      -- JSON array, e.g. '["Bash","Edit"]'
  has_thinking INTEGER DEFAULT 0,
  seq INTEGER
);
```

### tool_calls
```sql
CREATE TABLE tool_calls (
  id TEXT PRIMARY KEY,
  message_uuid TEXT REFERENCES messages(uuid),
  session_id TEXT REFERENCES sessions(id),
  tool_name TEXT,
  timestamp TEXT,
  file_path TEXT                         -- For Edit/Write: the target file path
);
```

### daily_stats
```sql
CREATE TABLE daily_stats (
  date TEXT PRIMARY KEY,
  message_count INTEGER,
  session_count INTEGER,
  tool_call_count INTEGER,
  tokens_by_model TEXT                   -- JSON object
);
```

### session_turns (internal — not yet exposed by commands)
```sql
CREATE TABLE session_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  turn_number INTEGER,
  user_uuid TEXT,
  user_timestamp TEXT,
  user_text TEXT,
  assistant_count INTEGER DEFAULT 0,
  tool_call_count INTEGER DEFAULT 0,
  tool_error_count INTEGER DEFAULT 0,
  has_thinking INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  context_tokens INTEGER DEFAULT 0
);
```

### session_metrics (internal — not yet exposed by commands)
```sql
CREATE TABLE session_metrics (
  session_id TEXT PRIMARY KEY,
  metrics_version INTEGER DEFAULT 1,
  jsonl_mtime REAL,
  turn_count INTEGER DEFAULT 0,
  first_attempt_success_rate REAL DEFAULT 0,
  interruption_rate REAL DEFAULT 0,
  correction_rate REAL DEFAULT 0,
  tool_error_rate REAL DEFAULT 0,
  token_efficiency REAL DEFAULT 0,
  prompt_specificity REAL DEFAULT 0,
  error_loop_count INTEGER DEFAULT 0,
  thinking_effectiveness REAL DEFAULT 0,
  momentum TEXT DEFAULT 'stable',
  overall_score REAL DEFAULT 0,
  computed_at TEXT
);
```

### turn_events (internal — not yet exposed by commands)
```sql
CREATE TABLE turn_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  turn_number INTEGER,
  event_type TEXT,        -- 'success', 'interruption', 'correction', 'error_loop'
  matched_rule TEXT,
  tokens_wasted INTEGER DEFAULT 0
);
```

### sessions_fts (FTS5)
```sql
SELECT session_id FROM sessions_fts WHERE sessions_fts MATCH 'keyword';
```

---

## Cost formula

Per 1M tokens:

```sql
ROUND(
  (total_input_tokens * 5.0
   + total_output_tokens * 25.0
   + total_cache_read_tokens * 0.5
   + total_cache_creation_tokens * 10.0
  ) / 1000000, 2
) AS est_cost
```

Default rates are Opus 4.6. Per-model rates:

| Model | Input | Output | Cache Read | Cache Write |
|-------|-------|--------|------------|-------------|
| Opus 4.6/4.5 | $5 | $25 | $0.50 | $10 |
| Opus 4.1/4 | $15 | $75 | $1.50 | $30 |
| Sonnet 4.6/4.5/4 | $3 | $15 | $0.30 | $6 |
| Haiku 4.5 | $1 | $5 | $0.10 | $2 |

---

## Common queries

```sql
-- Per-project cost
SELECT p.name, COUNT(*) as sessions,
  ROUND(SUM(s.total_output_tokens * 25.0 + s.total_input_tokens * 5.0
    + s.total_cache_read_tokens * 0.5 + s.total_cache_creation_tokens * 10.0) / 1000000, 2) as est_cost
FROM projects p LEFT JOIN sessions s ON p.id = s.project_id
GROUP BY p.id ORDER BY est_cost DESC

-- Most expensive sessions
SELECT id, first_prompt, model_used,
  ROUND((total_output_tokens * 25.0 + total_input_tokens * 5.0
    + total_cache_read_tokens * 0.5 + total_cache_creation_tokens * 10.0) / 1000000, 2) as est_cost
FROM sessions ORDER BY est_cost DESC LIMIT 10

-- Sessions with context compressions
SELECT s.id, p.name, s.compression_count, s.message_count, s.first_prompt
FROM sessions s JOIN projects p ON s.project_id = p.id
WHERE s.compression_count > 0
ORDER BY s.compression_count DESC

-- Most used tools
SELECT tool_name, COUNT(*) as uses
FROM tool_calls GROUP BY tool_name ORDER BY uses DESC

-- Git branch activity
SELECT git_branch, COUNT(*) as sessions, SUM(message_count) as msgs
FROM sessions WHERE git_branch IS NOT NULL AND git_branch != ''
GROUP BY git_branch ORDER BY sessions DESC

-- Find sessions by FTS
SELECT s.id, s.first_prompt FROM sessions s
WHERE s.id IN (SELECT session_id FROM sessions_fts WHERE sessions_fts MATCH 'migration')

-- Adjacent sessions (continuations of same work)
SELECT s.id, s.created_at, s.message_count, s.first_prompt
FROM sessions s WHERE s.project_id = (
  SELECT project_id FROM sessions WHERE id = '<session-id>'
) ORDER BY s.created_at DESC LIMIT 5
```
