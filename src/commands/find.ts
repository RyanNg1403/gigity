import { Args, Command, Flags } from "@oclif/core";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { ensureSynced, forceSync } from "../lib/auto-sync.js";
import { extractReadableText, scoreMatch, SKIP_RECORD_TYPES } from "../lib/search.js";

interface FindResult {
  sessionId: string;
  score: number;
  modifiedAt: string;
  project: string;
}

function searchSessions(
  db: Database.Database,
  query: string,
  projectFilter: string | null,
  limit: number,
): FindResult[] {
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter(Boolean);

  let sessions: { id: string; jsonl_path: string; modified_at: string; project_path: string }[];

  if (projectFilter === null) {
    sessions = db.prepare(`
      SELECT s.id, s.jsonl_path, s.modified_at, p.original_path as project_path
      FROM sessions s JOIN projects p ON s.project_id = p.id
      ORDER BY s.modified_at DESC
    `).all() as typeof sessions;
  } else {
    sessions = db.prepare(`
      SELECT s.id, s.jsonl_path, s.modified_at, p.original_path as project_path
      FROM sessions s JOIN projects p ON s.project_id = p.id
      WHERE p.original_path LIKE ? OR p.name LIKE ?
      ORDER BY s.modified_at DESC
    `).all(`%${projectFilter}%`, `%${projectFilter}%`) as typeof sessions;
  }

  const bestBySession = new Map<string, { score: number; modified_at: string; project: string }>();

  for (const sess of sessions) {
    if (bestBySession.size >= limit * 3) break;

    try {
      for (const line of fs.readFileSync(sess.jsonl_path, "utf-8").split("\n")) {
        if (!line.trim()) continue;
        let record;
        try { record = JSON.parse(line); } catch { continue; }
        if (!record.type || SKIP_RECORD_TYPES.has(record.type)) continue;

        const text = extractReadableText(record);
        const { score } = scoreMatch(text.toLowerCase(), queryLower, queryTerms);

        if (score > 0) {
          const existing = bestBySession.get(sess.id);
          if (!existing || score > existing.score) {
            bestBySession.set(sess.id, { score, modified_at: sess.modified_at, project: sess.project_path });
          }
          break;
        }
      }
    } catch {
      // Skip unreadable
    }
  }

  return [...bestBySession.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit)
    .map(([id, info]) => ({ sessionId: id, score: info.score, modifiedAt: info.modified_at, project: info.project }));
}

export default class Find extends Command {
  static override description = "Find session IDs by searching message content (current project by default)";

  static override examples = [
    '<%= config.bin %> find "fix the auth bug"',
    '<%= config.bin %> find "refactor" --limit=5',
    '<%= config.bin %> find "database migration" --all',
    'ggt diff $(ggt find "auth bug" | awk \'{print $1}\')',
  ];

  static override args = {
    query: Args.string({ description: "Search query", required: true }),
  };

  static override flags = {
    project: Flags.string({ description: "Filter by project (substring match)" }),
    all: Flags.boolean({ description: "Search all projects (default: current project only)" }),
    limit: Flags.integer({ description: "Max sessions to return", default: 1 }),
    json: Flags.boolean({ description: "Output as JSON" }),
  };

  async run() {
    const { args, flags } = await this.parse(Find);
    let db = await ensureSynced((msg) => this.log(msg));

    const projectFilter = flags.all
      ? null
      : flags.project
        ? (flags.project === "." || flags.project === "./" ? path.resolve(".") : flags.project)
        : path.resolve(".");

    let results = searchSessions(db, args.query, projectFilter, flags.limit);

    // No results — force a fresh sync and retry
    if (results.length === 0) {
      db = await forceSync((msg) => this.log(msg));
      results = searchSessions(db, args.query, projectFilter, flags.limit);
    }

    if (results.length === 0) {
      this.log(`No sessions matching "${args.query}".`);
      return;
    }

    if (flags.json) {
      this.log(JSON.stringify(results.map((r) => ({
        sessionId: r.sessionId,
        lastActive: r.modifiedAt,
        project: r.project,
      })), null, 2));
      return;
    }

    for (const r of results) {
      this.log(`${r.sessionId}  ${(r.modifiedAt || "").slice(0, 16)}  ${r.project}`);
    }
  }
}
