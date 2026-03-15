import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { claudePaths } from "@/lib/claude-paths";

export async function GET() {
  try {
    const content = fs.readFileSync(claudePaths.settings, "utf-8");
    return NextResponse.json(JSON.parse(content));
  } catch {
    return NextResponse.json({});
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const json = JSON.stringify(body, null, 2);

    // Validate it's valid JSON object (not array, string, etc.)
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Settings must be a JSON object" }, { status: 400 });
    }

    // Create a backup before overwriting
    if (fs.existsSync(claudePaths.settings)) {
      const backupDir = path.join(claudePaths.root, "backups");
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      const timestamp = Date.now();
      fs.copyFileSync(claudePaths.settings, path.join(backupDir, `settings.json.backup.${timestamp}`));
    }

    // Atomic write via temp file
    const tmpPath = claudePaths.settings + ".tmp";
    fs.writeFileSync(tmpPath, json, "utf-8");
    fs.renameSync(tmpPath, claudePaths.settings);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
