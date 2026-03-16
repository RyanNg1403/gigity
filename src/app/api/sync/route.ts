import { NextResponse } from "next/server";
import { syncAll } from "@/lib/sync";
import { getDb } from "@/lib/db";
import { computeAllStaleMetrics } from "@/lib/metrics";

export async function POST() {
  try {
    const result = await syncAll();
    const db = getDb();
    const metricsComputed = computeAllStaleMetrics(db);
    return NextResponse.json({ ...result, metricsComputed });
  } catch (error) {
    const err = error as Error;
    return NextResponse.json({ error: err.message, stack: err.stack }, { status: 500 });
  }
}
