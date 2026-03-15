import { NextResponse } from "next/server";
import { syncAll } from "@/lib/sync";

export async function POST() {
  try {
    const result = await syncAll();
    return NextResponse.json(result);
  } catch (error) {
    const err = error as Error;
    return NextResponse.json({ error: err.message, stack: err.stack }, { status: 500 });
  }
}
