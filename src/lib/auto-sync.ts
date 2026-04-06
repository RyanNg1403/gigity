import { isDbStale, getWritableDb, getDb, resetDb } from "./db.js";
import { syncAll } from "./sync.js";
import Database from "better-sqlite3";

let _synced = false;

/**
 * Ensure the DB is up-to-date before querying.
 * If the DB file is older than maxAgeMs (default 60s), runs a sync first.
 * Returns a readonly DB handle for querying.
 */
export async function ensureSynced(
  maxAgeMs = 60_000,
  log?: (msg: string) => void
): Promise<Database.Database> {
  if (!_synced && isDbStale(maxAgeMs)) {
    const db = getWritableDb();
    const result = await syncAll(db);
    if (result.sessionsIndexed > 0 && log) {
      log(
        `Auto-synced: ${result.sessionsIndexed} session${result.sessionsIndexed > 1 ? "s" : ""} indexed (${result.durationMs}ms)`
      );
    }
    _synced = true;
    // Close writable and reset so getDb() opens a fresh readonly connection
    db.close();
    resetDb();
  }
  return getDb();
}

/** Force a sync regardless of staleness. Returns a readonly DB handle. */
export async function forceSync(
  log?: (msg: string) => void,
): Promise<Database.Database> {
  const db = getWritableDb();
  const result = await syncAll(db);
  if (log) {
    log(
      `Synced: ${result.sessionsIndexed} session${result.sessionsIndexed > 1 ? "s" : ""} indexed (${result.durationMs}ms)`
    );
  }
  _synced = true;
  db.close();
  resetDb();
  return getDb();
}
