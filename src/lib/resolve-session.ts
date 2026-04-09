import path from "node:path";
import Database from "better-sqlite3";

export interface ResolvedSession {
  id: string;
  jsonl_path: string;
  first_prompt: string;
  created_at: string;
  model_used: string;
  project_path: string;
  project_name: string;
}

export class AmbiguousSessionError extends Error {
  matches: string[];
  constructor(prefix: string, matches: string[]) {
    super(`Ambiguous session prefix "${prefix}" — matches ${matches.length} sessions:\n${matches.map((id) => `  ${id}`).join("\n")}\nUse a longer prefix to disambiguate.`);
    this.name = "AmbiguousSessionError";
    this.matches = matches;
  }
}

/**
 * Resolve a session by ID prefix, or default to the most recent session
 * in the current project if no ID is provided.
 *
 * Throws AmbiguousSessionError if a prefix matches multiple sessions.
 */
export function resolveSession(
  db: Database.Database,
  idOrPrefix?: string,
): ResolvedSession | null {
  const query = `
    SELECT s.id, s.jsonl_path, s.first_prompt, s.created_at, s.model_used,
      p.original_path as project_path, p.name as project_name
    FROM sessions s JOIN projects p ON s.project_id = p.id
  `;

  if (idOrPrefix) {
    // Exact match first
    const exact = db.prepare(`${query} WHERE s.id = ?`).get(idOrPrefix) as ResolvedSession | undefined;
    if (exact) return exact;

    // Prefix match — fetch up to 10 to detect ambiguity
    const matches = db.prepare(`${query} WHERE s.id LIKE ? ORDER BY s.created_at DESC LIMIT 10`)
      .all(`${idOrPrefix}%`) as ResolvedSession[];

    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];

    throw new AmbiguousSessionError(idOrPrefix, matches.map((m) => m.id));
  }

  // No ID — most recent session in current project
  const cwd = path.resolve(".");
  return (db.prepare(
    `${query} WHERE p.original_path LIKE ? OR p.original_path = ? ORDER BY s.modified_at DESC LIMIT 1`,
  ).get(`%${cwd}%`, cwd) as ResolvedSession | undefined) || null;
}
