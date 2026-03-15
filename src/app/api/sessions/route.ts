import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const db = getDb();
  const url = new URL(req.url);
  const projectId = url.searchParams.get("project");
  const search = url.searchParams.get("q");
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const offset = parseInt(url.searchParams.get("offset") || "0");

  let query = `SELECT s.*, p.name as project_name FROM sessions s JOIN projects p ON s.project_id = p.id`;
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (projectId) {
    conditions.push("s.project_id = ?");
    params.push(projectId);
  }

  if (search) {
    // Use FTS5 for text search when available, fall back to LIKE
    const ftsAvailable = hasFtsData(db);
    if (ftsAvailable) {
      // FTS5 match: escape special chars and append * for prefix matching
      const ftsQuery = search.replace(/['"]/g, "").split(/\s+/).filter(Boolean).map(t => `"${t}"*`).join(" ");
      conditions.push("s.id IN (SELECT session_id FROM sessions_fts WHERE sessions_fts MATCH ?)");
      params.push(ftsQuery);
    } else {
      conditions.push("(s.first_prompt LIKE ? OR s.summary LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  query += " ORDER BY s.created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const sessions = db.prepare(query).all(...params);

  const countQuery = conditions.length > 0
    ? `SELECT COUNT(*) as total FROM sessions s WHERE ${conditions.join(" AND ")}`
    : "SELECT COUNT(*) as total FROM sessions";
  const countParams = params.slice(0, -2); // exclude limit/offset
  const { total } = db.prepare(countQuery).get(...countParams) as { total: number };

  return NextResponse.json({ sessions, total });
}

/** Check if the FTS table has been populated (i.e., a sync has run since FTS was added) */
function hasFtsData(db: ReturnType<typeof getDb>): boolean {
  try {
    const row = db.prepare("SELECT COUNT(*) as c FROM sessions_fts").get() as { c: number };
    return row.c > 0;
  } catch {
    return false;
  }
}
