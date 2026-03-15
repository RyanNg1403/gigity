import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";

const DB_PATH = path.join(os.homedir(), ".claude", "gigity.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH, { readonly: true });
  _db.pragma("journal_mode = WAL");
  return _db;
}
