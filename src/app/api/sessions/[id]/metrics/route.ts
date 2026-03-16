import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const metrics = db.prepare("SELECT * FROM session_metrics WHERE session_id = ?").get(id) || null;
  const events = db.prepare(
    "SELECT turn_number, event_type, matched_rule, tokens_wasted FROM turn_events WHERE session_id = ? ORDER BY turn_number"
  ).all(id);

  return NextResponse.json({ metrics, events });
}
