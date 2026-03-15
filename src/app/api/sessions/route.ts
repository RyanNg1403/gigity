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
    conditions.push("(s.first_prompt LIKE ? OR s.summary LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
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
