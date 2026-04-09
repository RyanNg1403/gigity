import { Args, Command, Flags } from "@oclif/core";
import fs from "node:fs";
import path from "node:path";
import { ensureSynced } from "../lib/auto-sync.js";
import { resolveSession, AmbiguousSessionError } from "../lib/resolve-session.js";
import { diffMatchesGrep, grepDiffHunks, unifiedDiff } from "../lib/diff.js";
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
    "<%= config.bin %> log src/lib/db.ts --explain",
    "<%= config.bin %> log src/lib/db.ts --explain --session=dab1f061",
  ];

  static override args = {
    file: Args.string({ description: "File path (relative, absolute, or substring)", required: true }),
  };

  static override flags = {
    patch: Flags.boolean({ char: "p", description: "Show net unified diff for each session" }),
    grep: Flags.string({ description: "Only show sessions where the diff matches this pattern" }),
    explain: Flags.boolean({ description: "Show edit-by-edit motivations (default: last session, or use --session)" }),
    session: Flags.string({ description: "Session ID or prefix for --explain (default: last session in current project)" }),
    branch: Flags.string({ description: "Filter by git branch" }),
    limit: Flags.integer({ description: "Max sessions", default: 20 }),
    line: Flags.string({ char: "L", description: "Line range for --explain (e.g. 40,50 or 42). Only show edits affecting those lines" }),
    json: Flags.boolean({ description: "Output as JSON" }),
  };

  async run() {
    const { args, flags } = await this.parse(Log);
    const db = await ensureSynced((msg) => this.log(msg));

    // If --explain, run the explain flow
    if (flags.explain) {
      let session;
      try {
        session = resolveSession(db, flags.session);
      } catch (e) {
        if (e instanceof AmbiguousSessionError) this.error(e.message);
        throw e;
      }
      if (!session) {
        this.error(flags.session ? `Session not found: ${flags.session}` : "No sessions found in current project.");
      }
      await this.runExplain(session, args.file, { grep: flags.grep, lineRange: flags.line, json: flags.json });
      return;
    }

    // Find sessions that touched this file via tool_calls
    const resolvedPath = path.isAbsolute(args.file) ? args.file : path.resolve(args.file);
    const logBranchClause = flags.branch ? "AND s.git_branch = ?" : "";
    const logBranchParams = flags.branch ? [flags.branch] : [];

    const query = `
      SELECT DISTINCT tc.session_id, s.jsonl_path, s.created_at, s.model_used, s.first_prompt,
        p.original_path as project_path, p.name as project_name
      FROM tool_calls tc
      JOIN sessions s ON tc.session_id = s.id
      JOIN projects p ON s.project_id = p.id
      WHERE tc.file_path IS NOT NULL
        AND tc.tool_name IN ('Edit', 'Write')
        AND tc.file_path LIKE ?
        ${logBranchClause}
      ORDER BY s.created_at ASC
      LIMIT ?
    `;

    // Try exact resolved path first
    let rows = db.prepare(query).all(resolvedPath, ...logBranchParams, flags.limit) as Record<string, unknown>[];
    if (rows.length === 0) {
      // Substring fallback — scope to current project to avoid cross-project noise
      const cwd = path.resolve(".");
      const scopedQuery = `
        SELECT DISTINCT tc.session_id, s.jsonl_path, s.created_at, s.model_used, s.first_prompt,
          p.original_path as project_path, p.name as project_name
        FROM tool_calls tc
        JOIN sessions s ON tc.session_id = s.id
        JOIN projects p ON s.project_id = p.id
        WHERE tc.file_path IS NOT NULL
          AND tc.tool_name IN ('Edit', 'Write')
          AND tc.file_path LIKE ?
          AND (p.original_path LIKE ? OR p.original_path = ?)
          ${logBranchClause}
        ORDER BY s.created_at ASC
        LIMIT ?
      `;
      rows = db.prepare(scopedQuery).all(`%${args.file}%`, `%${cwd}%`, cwd, ...logBranchParams, flags.limit) as Record<string, unknown>[];
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

        // --grep: skip sessions where the diff doesn't match
        if (flags.grep && !diffMatchesGrep(text, flags.grep)) continue;

        entries.push({
          sessionId,
          date: ((row.created_at as string) || "").slice(0, 10),
          project: row.project_name as string,
          model: ((row.model_used as string) || "").replace("claude-", ""),
          prompt: ((row.first_prompt as string) || "").slice(0, 80).replace(/\n/g, " "),
          linesAdded: added,
          linesRemoved: removed,
          isNew: false,
          diffText: (flags.patch || flags.grep) ? text : undefined,
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

    this.log(`${entries.length} session${entries.length !== 1 ? "s" : ""}. Use --patch for diffs, --explain for motivations.`);
  }

  private async runExplain(
    session: import("../lib/resolve-session.js").ResolvedSession,
    file: string,
    opts: { grep?: string; lineRange?: string; json?: boolean } = {},
  ) {
    const sessionId = session.id;
    const jsonlPath = session.jsonl_path;

    // Parse -L range if provided
    let targetLines: string[] | null = null;
    let significantTarget: string[] | null = null;
    let lineStart = 0;
    let lineEnd = 0;

    if (opts.lineRange) {
      const parts = opts.lineRange.split(",").map((s) => parseInt(s.trim(), 10));
      lineStart = parts[0];
      lineEnd = parts.length > 1 ? parts[1] : lineStart;
      if (isNaN(lineStart) || isNaN(lineEnd) || lineStart < 1) {
        this.error(`Invalid line range: ${opts.lineRange}. Use -L 42 or -L 40,50`);
      }
      const resolvedFile = path.isAbsolute(file) ? file : path.resolve(file);
      if (!fs.existsSync(resolvedFile)) {
        this.error(`File not found (needed for -L): ${resolvedFile}`);
      }
      const fileContent = fs.readFileSync(resolvedFile, "utf-8");
      const allLines = fileContent.split("\n");
      targetLines = allLines.slice(lineStart - 1, lineEnd);
      if (targetLines.length === 0) {
        this.error(`Lines ${lineStart}-${lineEnd} out of range (file has ${allLines.length} lines)`);
      }
      // Only match on lines with meaningful content (skip braces, blank lines, etc.)
      significantTarget = targetLines.filter((l) => l.trim().length > 4);
    }

    // Find all Edit/Write tool_uses for this file in this session
    interface EditEntry {
      uuid: string;
      toolUseId: string;
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
            toolUseId: String(b.id),
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

    // Remove rejected edits (tool_result with is_error=true)
    const rejectedCount = edits.filter((e) => toolResultSuccess.get(e.toolUseId) === false).length;
    const successfulEdits = edits.filter((e) => toolResultSuccess.get(e.toolUseId) !== false);

    if (successfulEdits.length === 0) {
      const sid = sessionId.slice(0, 8);
      if (rejectedCount > 0) {
        this.log(`No successful edits to "${file}" in session ${sid} (${rejectedCount} rejected).`);
      } else {
        this.log(`No edits to "${file}" found in session ${sid}.`);
      }
      return;
    }

    // Filter edits by --grep and/or -L
    const filteredEdits = successfulEdits.filter((edit) => {
      // --grep: match pattern against old_string, new_string, or content
      if (opts.grep) {
        const p = opts.grep.toLowerCase();
        const os = (edit.oldString || "").toLowerCase();
        const ns = (edit.newString || "").toLowerCase();
        const ct = (edit.content || "").toLowerCase();
        if (!os.includes(p) && !ns.includes(p) && !ct.includes(p)) return false;
      }
      // -L: match significant target lines against edit content
      if (significantTarget && significantTarget.length > 0) {
        const combined = `${edit.oldString || ""}\n${edit.newString || ""}`;
        if (!significantTarget.some((line) => combined.includes(line.trim()))) return false;
      }
      return true;
    });

    if (filteredEdits.length === 0) {
      const sid = sessionId.slice(0, 8);
      if (opts.grep) this.log(`No edits matching "${opts.grep}" in session ${sid}.`);
      else if (opts.lineRange) this.log(`No edits affecting L${lineStart}-${lineEnd} in session ${sid}.`);
      return;
    }

    // Build uuid map for chain walking
    const uuidMap = await buildUuidMap(jsonlPath);

    // JSON output
    if (opts.json) {
      const jsonEdits = filteredEdits.map((edit) => {
        const ctx = traceEditContext(uuidMap, edit.uuid);
        return {
          tool: edit.toolName,
          filePath: edit.filePath,
          timestamp: edit.timestamp,
          userPrompt: ctx.userPrompt || null,
          claudeIntent: ctx.claudeIntent || null,
          oldString: edit.oldString || null,
          newString: edit.newString || null,
          content: edit.content || null,
        };
      });
      this.log(JSON.stringify({
        sessionId,
        file,
        date: session.created_at.slice(0, 10),
        model: (session.model_used || "").replace("claude-", ""),
        editsShown: filteredEdits.length,
        editsTotal: successfulEdits.length,
        rejected: rejectedCount,
        edits: jsonEdits,
      }, null, 2));
      return;
    }

    // Header
    const sid = sessionId.slice(0, 8);
    const model = (session.model_used || "").replace("claude-", "");
    this.log(`\x1b[1mExplain: ${file}\x1b[0m  session \x1b[33m${sid}\x1b[0m  ${session.created_at.slice(0, 10)}  ${model}`);
    if (opts.grep) this.log(`\x1b[2mFiltered by: --grep="${opts.grep}"\x1b[0m`);
    if (opts.lineRange) this.log(`\x1b[2mFiltered by: -L ${opts.lineRange}\x1b[0m`);
    this.log("");

    // Show target lines if -L (context for what the user is investigating)
    if (targetLines) {
      for (let i = 0; i < targetLines.length; i++) {
        this.log(`  \x1b[2m${String(lineStart + i).padStart(4)}\x1b[0m  ${targetLines[i]}`);
      }
      this.log("");
    }

    // Net diff from file-history (if available)
    const historyDir = getHistoryDir(sessionId);
    if (fs.existsSync(historyDir)) {
      const hashToPath = await buildHashToPathMap(jsonlPath);
      const versionGroups = scanFileHistory(historyDir);
      for (const [hash, versions] of versionGroups) {
        const fp = hashToPath.get(hash);
        if (!fp || !fp.toLowerCase().includes(file.toLowerCase())) continue;
        versions.sort((a, b) => a - b);
        if (versions.length < 2) continue;
        const oldContent = readSnapshot(historyDir, hash, versions[0]);
        const newContent = readSnapshot(historyDir, hash, versions[versions.length - 1]);
        if (oldContent && newContent && oldContent !== newContent) {
          let { text, added, removed } = computeDiff(oldContent, newContent, fp);
          // --grep: filter net diff to matching hunks only
          if (text && opts.grep) {
            const filtered = grepDiffHunks(text, opts.grep);
            if (filtered) {
              text = filtered;
            } else {
              text = "";
            }
          }
          if (text) {
            this.log(`\x1b[2mNet diff (\x1b[32m+${added}\x1b[2m/\x1b[31m-${removed}\x1b[2m):\x1b[0m`);
            this.log(text);
            this.log("");
          }
        }
        break;
      }
    }

    const rejectedNote = rejectedCount > 0 ? `, ${rejectedCount} rejected` : "";
    this.log(`\x1b[2m── Edit-by-edit breakdown (${filteredEdits.length}/${successfulEdits.length} edits${rejectedNote}) ──\x1b[0m\n`);

    for (let i = 0; i < filteredEdits.length; i++) {
      const edit = filteredEdits[i];
      const ctx = traceEditContext(uuidMap, edit.uuid);
      const time = edit.timestamp.slice(11, 19);

      this.log(`\x1b[1m${i + 1}. ${edit.toolName}\x1b[0m  ${time}`);

      // Chronological: user prompt → claude reasoning → diff
      if (ctx.userPrompt) {
        this.log(`  \x1b[33mUser:\x1b[0m   ${ctx.userPrompt.replace(/\n/g, " ").slice(0, 200)}`);
      }
      if (ctx.claudeIntent) {
        this.log(`  \x1b[36mClaude:\x1b[0m ${ctx.claudeIntent.replace(/\n/g, " ").slice(0, 200)}`);
      }

      // The resulting change
      if (edit.toolName === "Edit" && edit.oldString && edit.newString) {
        this.log("");
        const oldLines = edit.oldString.split("\n").slice(0, 5);
        const newLines = edit.newString.split("\n").slice(0, 5);
        for (const l of oldLines) this.log(`  \x1b[31m-${l}\x1b[0m`);
        if (edit.oldString.split("\n").length > 5) this.log(`  \x1b[2m  ... ${edit.oldString.split("\n").length - 5} more lines\x1b[0m`);
        for (const l of newLines) this.log(`  \x1b[32m+${l}\x1b[0m`);
        if (edit.newString.split("\n").length > 5) this.log(`  \x1b[2m  ... ${edit.newString.split("\n").length - 5} more lines\x1b[0m`);
      } else if (edit.toolName === "Write") {
        this.log("");
        const lines = (edit.content || "").split("\n");
        this.log(`  \x1b[32m${lines.length} lines written\x1b[0m`);
      }

      this.log("");
    }

    this.log(`${filteredEdits.length} edit${filteredEdits.length !== 1 ? "s" : ""} shown${filteredEdits.length < successfulEdits.length ? ` (${successfulEdits.length} total)` : ""}${rejectedCount > 0 ? `, ${rejectedCount} rejected` : ""} for ${file}.`);
  }
}

/** Compute diff with 2-space indentation for log output. */
function computeDiff(
  oldContent: string,
  newContent: string,
  filePath: string,
): { text: string; added: number; removed: number } {
  const result = unifiedDiff(oldContent, newContent, filePath);
  if (!result.text) return result;
  // Add 2-space indent for log display
  return { ...result, text: result.text.split("\n").map((l) => `  ${l}`).join("\n") };
}
