import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getWritableDb, getDb, resetDb } from "./db.js";
import { syncAll } from "./sync.js";
import Database from "better-sqlite3";

const DB_PATH = path.join(os.homedir(), ".claude", "gigity.db");
const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");

let _synced = false;

/**
 * Fast pre-check: are there any files newer than the DB?
 * Scans JSONL and sessions-index.json mtimes — just stat calls, no parsing.
 */
function hasNewData(): boolean {
  if (!fs.existsSync(DB_PATH)) return true;

  const dbMtime = fs.statSync(DB_PATH).mtimeMs;

  if (!fs.existsSync(PROJECTS_DIR)) return false;

  try {
    for (const folder of fs.readdirSync(PROJECTS_DIR)) {
      const projectDir = path.join(PROJECTS_DIR, folder);
      let stat;
      try {
        stat = fs.statSync(projectDir);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      for (const file of fs.readdirSync(projectDir)) {
        if (!file.endsWith(".jsonl") && file !== "sessions-index.json") continue;
        try {
          if (fs.statSync(path.join(projectDir, file)).mtimeMs > dbMtime) return true;
        } catch {
          continue;
        }
      }
    }
  } catch {
    return true;
  }

  // Also check stats-cache.json
  try {
    const statsPath = path.join(CLAUDE_DIR, "stats-cache.json");
    if (fs.existsSync(statsPath) && fs.statSync(statsPath).mtimeMs > dbMtime) {
      return true;
    }
  } catch {
    /* ignore */
  }

  return false;
}

/**
 * Ensure the DB has the latest data before querying.
 * Runs a fast mtime scan — only syncs when files have actually changed.
 * Returns a readonly DB handle.
 */
export async function ensureSynced(
  log?: (msg: string) => void,
): Promise<Database.Database> {
  if (!_synced && hasNewData()) {
    const db = getWritableDb();
    const result = await syncAll(db);
    if (result.sessionsIndexed > 0 && log) {
      log(
        `Auto-synced: ${result.sessionsIndexed} session${result.sessionsIndexed > 1 ? "s" : ""} indexed (${result.durationMs}ms)`,
      );
    }
    _synced = true;
    db.close();
    resetDb();
  }
  return getDb();
}

/** Force a full sync regardless of mtime. Returns a readonly DB handle. */
export async function forceSync(
  log?: (msg: string) => void,
): Promise<Database.Database> {
  const db = getWritableDb();
  const result = await syncAll(db);
  if (log) {
    log(
      `Synced: ${result.sessionsIndexed} session${result.sessionsIndexed > 1 ? "s" : ""} indexed (${result.durationMs}ms)`,
    );
  }
  _synced = true;
  db.close();
  resetDb();
  return getDb();
}
