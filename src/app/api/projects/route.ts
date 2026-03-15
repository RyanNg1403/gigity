import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();
  const projects = db
    .prepare("SELECT * FROM projects ORDER BY last_activity DESC")
    .all();
  return NextResponse.json(projects);
}
