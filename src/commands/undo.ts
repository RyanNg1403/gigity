import { Args, Command, Flags } from "@oclif/core";
import fs from "node:fs";
import path from "node:path";
import { ensureSynced } from "../lib/auto-sync.js";
import { getFileSnapshots, readSnapshot } from "../lib/file-history.js";

export default class Undo extends Command {
  static override description = "Restore files to their pre-session state using file-history snapshots";

  static override examples = [
    "<%= config.bin %> undo abc123 --dry-run",
    "<%= config.bin %> undo abc123",
    "<%= config.bin %> undo abc123 --file=src/lib/db.ts",
    "<%= config.bin %> undo abc123 --file=db.ts --dry-run",
  ];

  static override args = {
    id: Args.string({ description: "Session ID (or prefix)", required: true }),
  };

  static override flags = {
    "dry-run": Flags.boolean({ description: "Show what would be restored without writing" }),
    file: Flags.string({ description: "Restore a specific file only (substring match)" }),
    json: Flags.boolean({ description: "Output as JSON" }),
  };

  async run() {
    const { args, flags } = await this.parse(Undo);
    const db = await ensureSynced(60_000, (msg) => this.log(msg));
    const dryRun = flags["dry-run"] ?? false;

    // Find session
    const session = db.prepare(`
      SELECT s.id, s.jsonl_path, s.first_prompt, s.created_at,
        p.original_path as project_path, p.name as project_name
      FROM sessions s JOIN projects p ON s.project_id = p.id
      WHERE s.id LIKE ?
      ORDER BY s.created_at DESC LIMIT 1
    `).get(`${args.id}%`) as Record<string, unknown> | undefined;

    if (!session) {
      this.error(`Session not found: ${args.id}`);
    }

    const sessionId = session.id as string;
    const jsonlPath = session.jsonl_path as string;
    const projectPath = session.project_path as string;

    // Get all file snapshots
    const snapshots = await getFileSnapshots(sessionId, jsonlPath);

    if (snapshots.length === 0) {
      this.error("No file-history snapshots found for this session.");
    }

    // Build restore plan: for each file with 2+ versions, restore to v1 (pre-session)
    // For files with only 1 version, v1 IS the original — the file was edited once
    interface RestoreEntry {
      filePath: string; // relative path from snapshot
      absolutePath: string; // resolved absolute path
      hash: string;
      historyDir: string;
      firstVersion: number;
      lastVersion: number;
      action: "restore" | "delete"; // restore to v1, or delete if created in session
      currentExists: boolean;
    }

    const entries: RestoreEntry[] = [];

    for (const snap of snapshots) {
      // Only include files that actually changed (2+ versions)
      if (snap.firstVersion === snap.lastVersion) continue;

      // Resolve absolute path: if relative, prepend project path
      const absolutePath = path.isAbsolute(snap.filePath)
        ? snap.filePath
        : path.resolve(projectPath, snap.filePath);

      const firstContent = readSnapshot(snap.historyDir, snap.hash, snap.firstVersion);

      // v1 exists on disk → restore to original state
      // v1 doesn't exist (null backup = new file) → file was created in session, delete it
      const currentExists = fs.existsSync(absolutePath);

      if (firstContent !== null) {
        entries.push({
          filePath: snap.filePath,
          absolutePath,
          hash: snap.hash,
          historyDir: snap.historyDir,
          firstVersion: snap.firstVersion,
          lastVersion: snap.lastVersion,
          action: "restore",
          currentExists,
        });
      } else {
        // No v1 on disk — file was created in this session
        entries.push({
          filePath: snap.filePath,
          absolutePath,
          hash: snap.hash,
          historyDir: snap.historyDir,
          firstVersion: snap.firstVersion,
          lastVersion: snap.lastVersion,
          action: "delete",
          currentExists,
        });
      }
    }

    // Filter by file if specified
    let filtered = entries;
    if (flags.file) {
      filtered = entries.filter((e) =>
        e.filePath.toLowerCase().includes(flags.file!.toLowerCase()) ||
        e.absolutePath.toLowerCase().includes(flags.file!.toLowerCase()),
      );
      if (filtered.length === 0) {
        this.error(`No files matching "${flags.file}" found in session's file-history.`);
      }
    }

    if (filtered.length === 0) {
      this.log("No files to restore (no changes detected in file-history).");
      return;
    }

    // JSON output
    if (flags.json) {
      this.log(JSON.stringify({
        sessionId,
        project: session.project_name,
        dryRun,
        files: filtered.map((e) => ({
          path: e.filePath,
          absolutePath: e.absolutePath,
          action: e.action,
          currentExists: e.currentExists,
          versions: `v${e.firstVersion} → v${e.lastVersion}`,
        })),
      }, null, 2));
      if (dryRun) return;
    }

    // Header
    const sid = sessionId.slice(0, 8);
    const prompt = ((session.first_prompt as string) || "").slice(0, 80).replace(/\n/g, " ");
    this.log(`\x1b[1mUndo session ${sid}\x1b[0m  ${session.project_name}  ${(session.created_at as string).slice(0, 16)}`);
    if (prompt) this.log(`\x1b[2m${prompt}\x1b[0m`);
    this.log("");

    // Show plan
    let restoreCount = 0;
    let deleteCount = 0;
    let skipCount = 0;

    for (const entry of filtered) {
      const shortPath = entry.filePath;

      if (entry.action === "restore") {
        if (!entry.currentExists) {
          // File was deleted after session — would recreate from v1
          this.log(`  \x1b[32m+ ${shortPath}\x1b[0m  \x1b[2m(recreate from v${entry.firstVersion})\x1b[0m`);
          restoreCount++;
        } else {
          // Restore to v1
          this.log(`  \x1b[33m~ ${shortPath}\x1b[0m  \x1b[2m(restore to v${entry.firstVersion})\x1b[0m`);
          restoreCount++;
        }
      } else {
        if (entry.currentExists) {
          this.log(`  \x1b[31m- ${shortPath}\x1b[0m  \x1b[2m(created in session, delete)\x1b[0m`);
          deleteCount++;
        } else {
          this.log(`  \x1b[2m  ${shortPath} (already gone)\x1b[0m`);
          skipCount++;
        }
      }
    }

    this.log("");
    const parts: string[] = [];
    if (restoreCount > 0) parts.push(`\x1b[33m${restoreCount} restore\x1b[0m`);
    if (deleteCount > 0) parts.push(`\x1b[31m${deleteCount} delete\x1b[0m`);
    if (skipCount > 0) parts.push(`\x1b[2m${skipCount} skip\x1b[0m`);
    this.log(parts.join(", "));

    if (dryRun) {
      this.log(`\n\x1b[2mDry run — no files changed. Remove --dry-run to apply.\x1b[0m`);
      return;
    }

    // Apply
    this.log("");
    let applied = 0;
    let errors = 0;

    for (const entry of filtered) {
      try {
        if (entry.action === "restore") {
          const content = readSnapshot(entry.historyDir, entry.hash, entry.firstVersion);
          if (content === null) {
            this.log(`  \x1b[31mERR\x1b[0m ${entry.filePath}: v${entry.firstVersion} not readable`);
            errors++;
            continue;
          }
          // Ensure parent directory exists
          const dir = path.dirname(entry.absolutePath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(entry.absolutePath, content);
          applied++;
        } else if (entry.action === "delete" && entry.currentExists) {
          fs.unlinkSync(entry.absolutePath);
          applied++;
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.log(`  \x1b[31mERR\x1b[0m ${entry.filePath}: ${msg}`);
        errors++;
      }
    }

    this.log(`\x1b[32mDone:\x1b[0m ${applied} file${applied !== 1 ? "s" : ""} restored${errors > 0 ? `, \x1b[31m${errors} error${errors !== 1 ? "s" : ""}\x1b[0m` : ""}`);
  }
}
