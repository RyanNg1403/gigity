import { Args, Command, Flags } from "@oclif/core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { ensureSynced } from "../lib/auto-sync.js";
import { parseJsonl } from "../lib/jsonl.js";
import {
  getHistoryDir,
  buildHashToPathMap,
  scanFileHistory,
  readSnapshot,
  buildUuidMap,
  traceEditContext,
} from "../lib/file-history.js";

export default class Log extends Command {
  static override description = "Show history of a file across all sessions";

  static override examples = [
    "<%= config.bin %> log src/lib/db.ts",
    "<%= config.bin %> log src/lib/db.ts --patch",
    "<%= config.bin %> log src/lib/db.ts --explain=dab1f061",
    "<%= config.bin %> log db.ts --json",
  ];

  static override args = {
    file: Args.string({ description: "File path (relative, absolute, or substring)", required: true }),
  };

  static override flags = {
    patch: Flags.boolean({ description: "Show unified diff for each session", char: "p" }),
    explain: Flags.string({ description: "Show edit-by-edit motivations for a specific session (ID or prefix)" }),
    limit: Flags.integer({ description: "Max sessions", default: 20 }),
    json: Flags.boolean({ description: "Output as JSON" }),
  };

  async run() {
    const { args, flags } = await this.parse(Log);
    const db = await ensureSynced((msg) => this.log(msg));

    // If --explain, run the explain flow
    if (flags.explain) {
      await this.runExplain(db, args.file, flags.explain);
      return;
    }

    // Find sessions that touched this file via tool_calls
    const resolvedPath = path.isAbsolute(args.file) ? args.file : path.resolve(args.file);

    const query = `
      SELECT DISTINCT tc.session_id, s.jsonl_path, s.created_at, s.model_used, s.first_prompt,
        p.original_path as project_path, p.name as project_name
      FROM tool_calls tc
      JOIN sessions s ON tc.session_id = s.id
      JOIN projects p ON s.project_id = p.id
      WHERE tc.file_path IS NOT NULL
        AND tc.tool_name IN ('Edit', 'Write')
        AND tc.file_path LIKE ?
      ORDER BY s.created_at ASC
      LIMIT ?
    `;

    let rows = db.prepare(query).all(resolvedPath, flags.limit) as Record<string, unknown>[];
    if (rows.length === 0) {
      rows = db.prepare(query).all(`%${args.file}%`, flags.limit) as Record<string, unknown>[];
    }

    if (rows.length === 0) {
      this.log(`No sessions found that modified "${args.file}".`);
      return;
    }

    // For each session, compute net diff from file-history
    interface LogEntry {
      sessionId: string;
      date: string;
      project: string;
      model: string;
      prompt: string;
      linesAdded: number;
      linesRemoved: number;
      isNew: boolean;
      diffText?: string;
    }

    const entries: LogEntry[] = [];

    for (const row of rows) {
      const sessionId = row.session_id as string;
      const jsonlPath = row.jsonl_path as string;
      const historyDir = getHistoryDir(sessionId);

      if (!fs.existsSync(historyDir)) continue;

      const hashToPath = await buildHashToPathMap(jsonlPath);
      const versionGroups = scanFileHistory(historyDir);

      // Find the hash for our target file
      for (const [hash, versions] of versionGroups) {
        const filePath = hashToPath.get(hash);
        if (!filePath) continue;

        // Match: exact resolved path, or the relative path matches the query
        const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(row.project_path as string, filePath);
        if (absPath !== resolvedPath && !filePath.toLowerCase().includes(args.file.toLowerCase())) continue;

        versions.sort((a, b) => a - b);
        if (versions.length < 2) continue;

        const oldContent = readSnapshot(historyDir, hash, versions[0]);
        const newContent = readSnapshot(historyDir, hash, versions[versions.length - 1]);
        if (!oldContent || !newContent || oldContent === newContent) continue;

        const { added, removed, text } = computeDiff(oldContent, newContent, filePath);

        entries.push({
          sessionId,
          date: ((row.created_at as string) || "").slice(0, 10),
          project: row.project_name as string,
          model: ((row.model_used as string) || "").replace("claude-", ""),
          prompt: ((row.first_prompt as string) || "").slice(0, 80).replace(/\n/g, " "),
          linesAdded: added,
          linesRemoved: removed,
          isNew: false,
          diffText: flags.patch ? text : undefined,
        });
        break; // one match per session
      }
    }

    if (entries.length === 0) {
      this.log(`No file-history changes found for "${args.file}".`);
      return;
    }

    if (flags.json) {
      this.log(JSON.stringify(entries.map((e) => ({
        sessionId: e.sessionId, date: e.date, project: e.project, model: e.model,
        linesAdded: e.linesAdded, linesRemoved: e.linesRemoved,
      })), null, 2));
      return;
    }

    this.log(`\x1b[1mLog: ${args.file}\x1b[0m\n`);

    for (const e of entries) {
      const delta = `\x1b[32m+${e.linesAdded}\x1b[0m/\x1b[31m-${e.linesRemoved}\x1b[0m`;
      this.log(`\x1b[33m${e.sessionId.slice(0, 8)}\x1b[0m  ${e.date}  \x1b[36m${e.project}\x1b[0m  ${e.model}  ${delta}`);
      if (e.prompt) this.log(`         \x1b[2m${e.prompt}\x1b[0m`);

      if (e.diffText) {
        this.log("");
        this.log(e.diffText);
      }

      this.log("");
    }

    this.log(`${entries.length} session${entries.length !== 1 ? "s" : ""}. Use --patch for diffs, --explain=<session-id> for motivations.`);
  }

  private async runExplain(db: import("better-sqlite3").Database, file: string, sessionPrefix: string) {
    // Find the session
    const session = db.prepare(`
      SELECT s.id, s.jsonl_path, s.first_prompt, s.created_at, s.model_used,
        p.original_path as project_path, p.name as project_name
      FROM sessions s JOIN projects p ON s.project_id = p.id
      WHERE s.id LIKE ?
      ORDER BY s.created_at DESC LIMIT 1
    `).get(`${sessionPrefix}%`) as Record<string, unknown> | undefined;

    if (!session) {
      this.error(`Session not found: ${sessionPrefix}`);
    }

    const sessionId = session.id as string;
    const jsonlPath = session.jsonl_path as string;

    // Find all Edit/Write tool_uses for this file in this session
    interface EditEntry {
      uuid: string;
      toolName: string;
      filePath: string;
      oldString?: string;
      newString?: string;
      content?: string;
      timestamp: string;
    }

    const edits: EditEntry[] = [];
    const toolResultSuccess = new Map<string, boolean>(); // toolUseId → succeeded

    for await (const record of parseJsonl(jsonlPath)) {
      if (record.type === "assistant") {
        const content = record.message?.content;
        if (!Array.isArray(content)) continue;
        for (const block of content) {
          const b = block as Record<string, unknown>;
          if (b.type !== "tool_use" || (b.name !== "Edit" && b.name !== "Write")) continue;
          const input = b.input as Record<string, unknown> | undefined;
          if (!input?.file_path) continue;
          const fp = String(input.file_path);

          // Match file
          if (!fp.toLowerCase().includes(file.toLowerCase())) continue;

          edits.push({
            uuid: record.uuid as string,
            toolName: String(b.name),
            filePath: fp,
            oldString: b.name === "Edit" ? String(input.old_string || "") : undefined,
            newString: b.name === "Edit" ? String(input.new_string || "") : undefined,
            content: b.name === "Write" ? String(input.content || "").slice(0, 500) : undefined,
            timestamp: record.timestamp || "",
          });
        }
      } else if (record.type === "user") {
        const content = record.message?.content;
        if (!Array.isArray(content)) continue;
        for (const block of content) {
          const b = block as Record<string, unknown>;
          if (b.type === "tool_result" && b.tool_use_id) {
            toolResultSuccess.set(String(b.tool_use_id), b.is_error !== true);
          }
        }
      }
    }

    if (edits.length === 0) {
      this.log(`No edits to "${file}" found in session ${sessionId.slice(0, 8)}.`);
      return;
    }

    // Build uuid map for chain walking
    const uuidMap = await buildUuidMap(jsonlPath);

    // Header
    const sid = sessionId.slice(0, 8);
    const model = ((session.model_used as string) || "").replace("claude-", "");
    this.log(`\x1b[1mExplain: ${file}\x1b[0m  session \x1b[33m${sid}\x1b[0m  ${(session.created_at as string).slice(0, 10)}  ${model}\n`);

    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i];
      const ctx = traceEditContext(uuidMap, edit.uuid);
      const time = edit.timestamp.slice(11, 19);

      this.log(`\x1b[1m${i + 1}. ${edit.toolName}\x1b[0m  ${time}`);

      // Show what changed
      if (edit.toolName === "Edit" && edit.oldString && edit.newString) {
        const oldLines = edit.oldString.split("\n").slice(0, 5);
        const newLines = edit.newString.split("\n").slice(0, 5);
        for (const l of oldLines) this.log(`  \x1b[31m-${l}\x1b[0m`);
        if (edit.oldString.split("\n").length > 5) this.log(`  \x1b[2m  ... ${edit.oldString.split("\n").length - 5} more lines\x1b[0m`);
        for (const l of newLines) this.log(`  \x1b[32m+${l}\x1b[0m`);
        if (edit.newString.split("\n").length > 5) this.log(`  \x1b[2m  ... ${edit.newString.split("\n").length - 5} more lines\x1b[0m`);
      } else if (edit.toolName === "Write") {
        const lines = (edit.content || "").split("\n");
        this.log(`  \x1b[32m${lines.length} lines written\x1b[0m`);
      }

      // Show motivation
      if (ctx.claudeIntent) {
        this.log(`\n  \x1b[36mClaude:\x1b[0m ${ctx.claudeIntent.replace(/\n/g, " ").slice(0, 200)}`);
      }
      if (ctx.userPrompt) {
        this.log(`  \x1b[33mUser:\x1b[0m   ${ctx.userPrompt.replace(/\n/g, " ").slice(0, 200)}`);
      }

      this.log("");
    }

    this.log(`${edits.length} edit${edits.length !== 1 ? "s" : ""} to ${file} in this session.`);
  }
}

function computeDiff(
  oldContent: string,
  newContent: string,
  filePath: string,
): { text: string; added: number; removed: number } {
  const tmpOld = path.join(os.tmpdir(), `ggt-log-old-${process.pid}-${Date.now()}`);
  const tmpNew = path.join(os.tmpdir(), `ggt-log-new-${process.pid}-${Date.now()}`);

  fs.writeFileSync(tmpOld, oldContent);
  fs.writeFileSync(tmpNew, newContent);

  let rawDiff: string;
  try {
    rawDiff = execSync(`diff -u "${tmpOld}" "${tmpNew}"`, { encoding: "utf-8" });
    rawDiff = "";
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string };
    rawDiff = err.status === 1 ? (err.stdout || "") : "";
  } finally {
    try { fs.unlinkSync(tmpOld); } catch { /* */ }
    try { fs.unlinkSync(tmpNew); } catch { /* */ }
  }

  if (!rawDiff) return { text: "", added: 0, removed: 0 };

  let added = 0;
  let removed = 0;
  const colored: string[] = [];

  for (const [i, line] of rawDiff.split("\n").entries()) {
    if (i === 0 && line.startsWith("---")) {
      colored.push(`  \x1b[1m--- a/${filePath}\x1b[0m`);
    } else if (i === 1 && line.startsWith("+++")) {
      colored.push(`  \x1b[1m+++ b/${filePath}\x1b[0m`);
    } else if (line.startsWith("@@")) {
      colored.push(`  \x1b[36m${line}\x1b[0m`);
    } else if (line.startsWith("-")) {
      removed++;
      colored.push(`  \x1b[31m${line}\x1b[0m`);
    } else if (line.startsWith("+")) {
      added++;
      colored.push(`  \x1b[32m${line}\x1b[0m`);
    } else {
      colored.push(`  ${line}`);
    }
  }

  return { text: colored.join("\n"), added, removed };
}
