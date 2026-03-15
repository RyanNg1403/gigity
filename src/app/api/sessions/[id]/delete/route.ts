import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { claudePaths } from "@/lib/claude-paths";
import fs from "fs";
import path from "path";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();

  const session = db.prepare("SELECT id, project_id, jsonl_path FROM sessions WHERE id = ?").get(id) as
    | { id: string; project_id: string; jsonl_path: string }
    | undefined;

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Delete from DB in a single transaction
  const deleteAll = db.transaction(() => {
    db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM messages WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM sessions_fts WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  });
  deleteAll();

  // Delete the JSONL file from ~/.claude
  if (session.jsonl_path) {
    try {
      fs.unlinkSync(session.jsonl_path);
    } catch {
      // File may already be gone
    }
  }

  // Remove the entry from sessions-index.json so sync doesn't resurrect it
  if (session.project_id) {
    const indexPath = path.join(claudePaths.projects, session.project_id, "sessions-index.json");
    try {
      if (fs.existsSync(indexPath)) {
        const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
        if (Array.isArray(index.entries)) {
          index.entries = index.entries.filter(
            (e: { sessionId?: string }) => e.sessionId !== id
          );
          // Atomic write
          const tmpPath = indexPath + ".tmp";
          fs.writeFileSync(tmpPath, JSON.stringify(index, null, 2), "utf-8");
          fs.renameSync(tmpPath, indexPath);
        }
      }
    } catch {
      // Non-critical — worst case the index has a stale entry pointing to a missing file
    }
  }

  return NextResponse.json({ success: true });
}
