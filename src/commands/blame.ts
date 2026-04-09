import { Args, Command, Flags } from "@oclif/core";
import fs from "node:fs";
import path from "node:path";
import { ensureSynced } from "../lib/auto-sync.js";
import {
  getHistoryDir,
  buildHashToPathMap,
  scanFileHistory,
  readSnapshot,
  buildUuidMap,
  traceEditContext,
} from "../lib/file-history.js";

export default class Blame extends Command {
  static override description = "Show which sessions modified a file";

  static override examples = [
    "<%= config.bin %> blame src/lib/db.ts",
    "<%= config.bin %> blame src/lib/db.ts -L 40,50",
    "<%= config.bin %> blame db.ts --limit=20",
    "<%= config.bin %> blame auth --json",
  ];

  static override args = {
    file: Args.string({ description: "File path (absolute, relative, or substring)", required: true }),
  };

  static override flags = {
    line: Flags.string({ char: "L", description: "Line range (e.g. 40,50 or 42). Finds which session last changed those lines" }),
    branch: Flags.string({ description: "Filter by git branch" }),
    limit: Flags.integer({ description: "Max results", default: 20 }),
    json: Flags.boolean({ description: "Output as JSON" }),
  };

  async run() {
    const { args, flags } = await this.parse(Blame);
    const db = await ensureSynced((msg) => this.log(msg));

    // If -L is specified, run line-range blame
    if (flags.line) {
      await this.lineBlame(db, args.file, flags.line, flags.json ?? false, flags.branch);
      return;
    }

    // Standard blame
    const resolvedPath = path.isAbsolute(args.file) ? args.file : path.resolve(args.file);
    const branchClause = flags.branch ? "AND s.git_branch = ?" : "";
    const branchParams = flags.branch ? [flags.branch] : [];

    const query = `
      SELECT tc.file_path, tc.tool_name, tc.timestamp,
        s.id as session_id, s.first_prompt, s.created_at, s.model_used, s.jsonl_path,
        p.original_path as project_path, p.name as project_name
      FROM tool_calls tc
      JOIN sessions s ON tc.session_id = s.id
      JOIN projects p ON s.project_id = p.id
      WHERE tc.file_path IS NOT NULL
        AND tc.tool_name IN ('Edit', 'Write')
        AND tc.file_path LIKE ?
        ${branchClause}
      ORDER BY tc.timestamp DESC
      LIMIT ?
    `;

    let rows = db.prepare(query).all(resolvedPath, ...branchParams, flags.limit) as Record<string, unknown>[];
    if (rows.length === 0) {
      const cwd = path.resolve(".");
      const scopedQuery = `
        SELECT tc.file_path, tc.tool_name, tc.timestamp,
          s.id as session_id, s.first_prompt, s.created_at, s.model_used, s.jsonl_path,
          p.original_path as project_path, p.name as project_name
        FROM tool_calls tc
        JOIN sessions s ON tc.session_id = s.id
        JOIN projects p ON s.project_id = p.id
        WHERE tc.file_path IS NOT NULL
          AND tc.tool_name IN ('Edit', 'Write')
          AND tc.file_path LIKE ?
          AND (p.original_path LIKE ? OR p.original_path = ?)
          ${branchClause}
        ORDER BY tc.timestamp DESC
        LIMIT ?
      `;
      rows = db.prepare(scopedQuery).all(`%${args.file}%`, `%${cwd}%`, cwd, ...branchParams, flags.limit) as Record<string, unknown>[];
    }

    if (rows.length === 0) {
      this.log(`No sessions found that modified "${args.file}".`);
      this.log(`\x1b[2mNote: blame requires a re-sync to index file paths. Run: ggt sync\x1b[0m`);
      return;
    }

    if (flags.json) {
      this.log(JSON.stringify(rows.map((r) => ({
        filePath: r.file_path,
        tool: r.tool_name,
        timestamp: r.timestamp,
        sessionId: r.session_id,
        project: r.project_name,
        projectPath: r.project_path,
        model: r.model_used,
        prompt: r.first_prompt,
      })), null, 2));
      return;
    }

    const bySession = new Map<string, { session: Record<string, unknown>; ops: Record<string, unknown>[] }>();
    for (const r of rows) {
      const sid = r.session_id as string;
      if (!bySession.has(sid)) {
        bySession.set(sid, { session: r, ops: [] });
      }
      bySession.get(sid)!.ops.push(r);
    }

    this.log(`\x1b[1mBlame: ${args.file}\x1b[0m\n`);

    for (const [sid, { session, ops }] of bySession) {
      const shortId = sid.slice(0, 8);
      const timestamp = ((session.timestamp as string) || (session.created_at as string) || "").slice(0, 16);
      const model = ((session.model_used as string) || "").replace("claude-", "");
      const prompt = ((session.first_prompt as string) || "").slice(0, 70).replace(/\n/g, " ");
      const editCount = ops.filter((o) => o.tool_name === "Edit").length;
      const writeCount = ops.filter((o) => o.tool_name === "Write").length;

      const opParts: string[] = [];
      if (editCount > 0) opParts.push(`${editCount} edit${editCount > 1 ? "s" : ""}`);
      if (writeCount > 0) opParts.push(`${writeCount} write${writeCount > 1 ? "s" : ""}`);

      this.log(`  \x1b[33m${shortId}\x1b[0m  ${timestamp}  \x1b[36m${session.project_name}\x1b[0m  ${model}  ${opParts.join(", ")}`);
      if (prompt) this.log(`           \x1b[2m${prompt}\x1b[0m`);
    }

    const uniquePaths = [...new Set(rows.map((r) => r.file_path as string))];
    if (uniquePaths.length > 1) {
      this.log(`\n\x1b[2mMatched ${uniquePaths.length} files:\x1b[0m`);
      for (const p of uniquePaths.slice(0, 10)) {
        this.log(`  \x1b[2m${p}\x1b[0m`);
      }
      if (uniquePaths.length > 10) {
        this.log(`  \x1b[2m... and ${uniquePaths.length - 10} more\x1b[0m`);
      }
    }

    this.log(`\n${bySession.size} session${bySession.size > 1 ? "s" : ""}, ${rows.length} operation${rows.length > 1 ? "s" : ""}`);
  }

  private async lineBlame(
    db: import("better-sqlite3").Database,
    file: string,
    lineRange: string,
    json: boolean,
    branch?: string,
  ) {
    // Parse line range: "42" or "40,50"
    const parts = lineRange.split(",").map((s) => parseInt(s.trim(), 10));
    const startLine = parts[0];
    const endLine = parts.length > 1 ? parts[1] : startLine;

    if (isNaN(startLine) || isNaN(endLine) || startLine < 1) {
      this.error(`Invalid line range: ${lineRange}. Use -L 42 or -L 40,50`);
    }

    // Read the current file to get target content
    const resolvedPath = path.isAbsolute(file) ? file : path.resolve(file);
    if (!fs.existsSync(resolvedPath)) {
      this.error(`File not found: ${resolvedPath}`);
    }

    const currentContent = fs.readFileSync(resolvedPath, "utf-8");
    const allLines = currentContent.split("\n");
    const targetLines = allLines.slice(startLine - 1, endLine);

    if (targetLines.length === 0) {
      this.error(`Lines ${startLine}-${endLine} out of range (file has ${allLines.length} lines)`);
    }

    const targetContent = targetLines.join("\n");

    // Show the target lines
    this.log(`\x1b[1mBlame: ${file} L${startLine}${endLine !== startLine ? `-${endLine}` : ""}\x1b[0m\n`);
    for (let i = 0; i < targetLines.length; i++) {
      this.log(`  \x1b[2m${String(startLine + i).padStart(4)}\x1b[0m  ${targetLines[i]}`);
    }
    this.log("");

    // Find sessions that touched this file (reverse chronological)
    const lbBranchClause = branch ? "AND s.git_branch = ?" : "";
    const lbBranchParams = branch ? [branch] : [];
    const sessions = db.prepare(`
      SELECT DISTINCT s.id, s.jsonl_path, s.created_at, s.model_used, s.first_prompt,
        p.original_path as project_path, p.name as project_name
      FROM tool_calls tc
      JOIN sessions s ON tc.session_id = s.id
      JOIN projects p ON s.project_id = p.id
      WHERE tc.file_path = ?
        AND tc.tool_name IN ('Edit', 'Write')
        ${lbBranchClause}
      ORDER BY s.created_at DESC
    `).all(resolvedPath, ...lbBranchParams) as Record<string, unknown>[];

    if (sessions.length === 0) {
      this.log("No sessions found that modified this file.");
      return;
    }

    // Walk sessions reverse-chronologically
    // For each, check if the target content exists in the pre-session snapshot
    // The first session where it DOESN'T exist in pre-snapshot → that session introduced it
    for (const sess of sessions) {
      const sessionId = sess.id as string;
      const jsonlPath = sess.jsonl_path as string;
      const historyDir = getHistoryDir(sessionId);
      if (!fs.existsSync(historyDir)) continue;

      const hashToPath = await buildHashToPathMap(jsonlPath);
      const versionGroups = scanFileHistory(historyDir);

      for (const [hash, versions] of versionGroups) {
        const fp = hashToPath.get(hash);
        if (!fp) continue;

        // Match: the file path must resolve to our target
        const absPath = path.isAbsolute(fp) ? fp : path.resolve(sess.project_path as string, fp);
        if (absPath !== resolvedPath) continue;

        versions.sort((a, b) => a - b);
        if (versions.length < 2) continue;

        // Read pre-session snapshot (earliest version)
        const preContent = readSnapshot(historyDir, hash, versions[0]);
        if (!preContent) continue;

        // Check if target content exists in the pre-session file
        if (!preContent.includes(targetContent)) {
          // This session introduced those lines!
          const model = ((sess.model_used as string) || "").replace("claude-", "");
          const date = ((sess.created_at as string) || "").slice(0, 16);

          // Find the specific edit that introduced this content (skip rejected edits)
          const uuidMap = await buildUuidMap(jsonlPath);
          const { parseJsonl } = await import("../lib/jsonl.js");
          const rejectedIds = new Set<string>();
          let editUuid: string | null = null;

          for await (const record of parseJsonl(jsonlPath)) {
            if (record.type === "user") {
              const content = record.message?.content;
              if (!Array.isArray(content)) continue;
              for (const block of content) {
                const b = block as Record<string, unknown>;
                if (b.type === "tool_result" && b.is_error === true && b.tool_use_id) {
                  rejectedIds.add(String(b.tool_use_id));
                }
              }
            } else if (record.type === "assistant") {
              const content = record.message?.content;
              if (!Array.isArray(content)) continue;
              for (const block of content) {
                const b = block as Record<string, unknown>;
                if (b.type === "tool_use" && (b.name === "Edit" || b.name === "Write") && !rejectedIds.has(String(b.id))) {
                  const input = b.input as Record<string, unknown> | undefined;
                  const ns = String(input?.new_string || input?.content || "");
                  if (ns.includes(targetContent) || targetContent.includes(ns.slice(0, 100))) {
                    editUuid = record.uuid as string;
                    break;
                  }
                }
              }
              if (editUuid) break;
            }
          }

          const ctx = editUuid ? traceEditContext(uuidMap, editUuid) : { userPrompt: null, claudeIntent: null };

          if (json) {
            this.log(JSON.stringify({
              sessionId,
              date: sess.created_at,
              project: sess.project_name,
              model: sess.model_used,
              lines: `${startLine}-${endLine}`,
              userPrompt: ctx.userPrompt,
              claudeIntent: ctx.claudeIntent,
            }, null, 2));
            return;
          }

          this.log(`\x1b[33mIntroduced by:\x1b[0m`);
          this.log(`  \x1b[33m${sessionId.slice(0, 8)}\x1b[0m  ${date}  \x1b[36m${sess.project_name}\x1b[0m  ${model}`);
          const prompt = ((sess.first_prompt as string) || "").slice(0, 100).replace(/\n/g, " ");
          if (prompt) this.log(`  \x1b[2m${prompt}\x1b[0m`);

          if (ctx.userPrompt) {
            this.log(`\n  \x1b[33mUser:\x1b[0m   ${ctx.userPrompt.replace(/\n/g, " ").slice(0, 200)}`);
          }
          if (ctx.claudeIntent) {
            this.log(`  \x1b[36mClaude:\x1b[0m ${ctx.claudeIntent.replace(/\n/g, " ").slice(0, 200)}`);
          }
          return;
        }
        // Target content exists in pre-snapshot — this session didn't introduce it, continue
        break;
      }
    }

    this.log(`\x1b[2mCould not trace — lines may predate indexed sessions or come from a Write without file-history.\x1b[0m`);
  }
}
