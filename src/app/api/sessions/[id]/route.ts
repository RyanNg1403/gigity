import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseJsonlAll } from "@/lib/parsers/jsonl";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();

  const session = db.prepare(`
    SELECT s.*, p.name as project_name, p.original_path
    FROM sessions s JOIN projects p ON s.project_id = p.id
    WHERE s.id = ?
  `).get(id) as Record<string, unknown> | undefined;

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Read full JSONL for conversation replay
  const jsonlPath = session.jsonl_path as string;
  let records: Awaited<ReturnType<typeof parseJsonlAll>> = [];
  try {
    records = await parseJsonlAll(jsonlPath);
  } catch {
    records = [];
  }

  // Filter to user/assistant/system records for replay
  const conversation = records
    .filter((r) => r.type === "user" || r.type === "assistant" || r.type === "system")
    .map((r) => ({
      type: r.type,
      uuid: r.uuid,
      parentUuid: r.parentUuid,
      timestamp: r.timestamp,
      model: r.message?.model,
      content: r.message?.content,
      usage: r.message?.usage,
      role: r.message?.role,
      gitBranch: r.gitBranch,
      cwd: r.cwd,
      // Pass through compression metadata for context pressure visualization
      subtype: r.subtype,
      compactMetadata: r.compactMetadata,
    }));

  return NextResponse.json({ session, conversation });
}
