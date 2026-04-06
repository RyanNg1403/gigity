import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DB_PATH = path.join(os.homedir(), ".claude", "gigity.db");

let _db: Database.Database | null = null;

export function getDb(writable = false): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH, { readonly: !writable });
  _db.pragma("journal_mode = WAL");
  if (!writable) _db.pragma("foreign_keys = OFF");
  return _db;
}

export function resetDb(): void {
  _db = null;
}

export function getWritableDb(): Database.Database {
  // Close readonly connection if open
  if (_db) {
    _db.close();
    _db = null;
  }
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = OFF");
  initSchema(_db);
  return _db;
}

/** Returns true if DB doesn't exist or is older than maxAgeMs */
export function isDbStale(maxAgeMs = 60_000): boolean {
  if (!fs.existsSync(DB_PATH)) return true;
  const mtime = fs.statSync(DB_PATH).mtimeMs;
  return Date.now() - mtime > maxAgeMs;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      original_path TEXT,
      name TEXT,
      session_count INTEGER DEFAULT 0,
      last_activity TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id),
      first_prompt TEXT,
      summary TEXT,
      message_count INTEGER DEFAULT 0,
      created_at TEXT,
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

    CREATE TABLE IF NOT EXISTS messages (
      uuid TEXT PRIMARY KEY,
      session_id TEXT REFERENCES sessions(id),
      parent_uuid TEXT,
      type TEXT,
      timestamp TEXT,
      model TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_creation_tokens INTEGER DEFAULT 0,
      tool_names TEXT,
      has_thinking INTEGER DEFAULT 0,
      seq INTEGER
    );

    CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY,
      message_uuid TEXT REFERENCES messages(uuid),
      session_id TEXT REFERENCES sessions(id),
      tool_name TEXT,
      timestamp TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_stats (
      date TEXT PRIMARY KEY,
      message_count INTEGER,
      session_count INTEGER,
      tool_call_count INTEGER,
      tokens_by_model TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(type);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_name ON tool_calls(tool_name);

    CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
      session_id UNINDEXED,
      first_prompt,
      summary,
      content='',
      tokenize='unicode61'
    );

    CREATE TABLE IF NOT EXISTS session_turns (
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

    CREATE TABLE IF NOT EXISTS session_metrics (
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

    CREATE TABLE IF NOT EXISTS turn_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      turn_number INTEGER,
      event_type TEXT,
      matched_rule TEXT,
      tokens_wasted INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_session_turns_session ON session_turns(session_id);
    CREATE INDEX IF NOT EXISTS idx_turn_events_session ON turn_events(session_id);
  `);
}
