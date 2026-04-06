import { Args, Command, Flags } from "@oclif/core";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { ensureSynced, forceSync } from "../lib/auto-sync.js";

function extractReadableText(record: { type: string; message?: { content?: unknown } }): string {
  const content = record.message?.content;
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
  }
  return parts.join(" ");
}

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

  let sessions: { id: string; jsonl_path: string; modified_at: string; project_name: string }[];

  if (projectFilter === null) {
    sessions = db.prepare(`
      SELECT s.id, s.jsonl_path, s.modified_at, p.name as project_name
      FROM sessions s JOIN projects p ON s.project_id = p.id
      ORDER BY s.modified_at DESC
    `).all() as typeof sessions;
  } else {
    sessions = db.prepare(`
      SELECT s.id, s.jsonl_path, s.modified_at, p.name as project_name
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
        if (!record.type || record.type === "file-history-snapshot" || record.type === "last-prompt" || record.type === "progress" || record.type === "system") continue;

        const text = extractReadableText(record);
        const textLower = text.toLowerCase();

        let score = 0;
        if (textLower.indexOf(queryLower) >= 0) {
          score = 1000 + queryLower.length;
        } else {
          let matched = 0;
          for (const term of queryTerms) {
            if (term.length < 3) continue;
            if (textLower.indexOf(term) >= 0) {
              score += term.length;
              matched++;
            }
          }
          const meaningfulTerms = queryTerms.filter((t) => t.length >= 3).length;
          if (matched < Math.max(1, Math.ceil(meaningfulTerms * 0.5))) score = 0;
        }

        if (score > 0) {
          const existing = bestBySession.get(sess.id);
          if (!existing || score > existing.score) {
            bestBySession.set(sess.id, { score, modified_at: sess.modified_at, project: sess.project_name });
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
      this.error(`No sessions matching "${args.query}"`);
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
