import Database from "better-sqlite3";
import path from "path";
import os from "os";

const DB_PATH = path.join(os.homedir(), ".claude", "gigity.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = OFF");

  initSchema(_db);
  return _db;
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
  `);
}
