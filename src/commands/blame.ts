import { Args, Command, Flags } from "@oclif/core";
import path from "node:path";
import { ensureSynced } from "../lib/auto-sync.js";

export default class Blame extends Command {
  static override description = "Show which sessions modified a file";

  static override examples = [
    "<%= config.bin %> blame src/lib/db.ts",
    "<%= config.bin %> blame /absolute/path/to/file.ts",
    "<%= config.bin %> blame db.ts --limit=20",
    "<%= config.bin %> blame auth --json",
  ];

  static override args = {
    file: Args.string({ description: "File path (absolute, relative, or substring)", required: true }),
  };

  static override flags = {
    limit: Flags.integer({ description: "Max results", default: 20 }),
    json: Flags.boolean({ description: "Output as JSON" }),
  };

  async run() {
    const { args, flags } = await this.parse(Blame);
    const db = await ensureSynced((msg) => this.log(msg));

    // Resolve the file path for matching
    const resolvedPath = path.isAbsolute(args.file)
      ? args.file
      : path.resolve(args.file);

    const query = `
      SELECT tc.file_path, tc.tool_name, tc.timestamp,
        s.id as session_id, s.first_prompt, s.created_at, s.model_used,
        p.original_path as project_path, p.name as project_name
      FROM tool_calls tc
      JOIN sessions s ON tc.session_id = s.id
      JOIN projects p ON s.project_id = p.id
      WHERE tc.file_path IS NOT NULL
        AND tc.tool_name IN ('Edit', 'Write')
        AND tc.file_path LIKE ?
      ORDER BY tc.timestamp DESC
      LIMIT ?
    `;

    // Try exact match first, fall back to substring only if no results
    let rows = db.prepare(query).all(resolvedPath, flags.limit) as Record<string, unknown>[];
    if (rows.length === 0) {
      rows = db.prepare(query).all(`%${args.file}%`, flags.limit) as Record<string, unknown>[];
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

    // Group by session for cleaner output
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

    // Show unique file paths if the match was a substring
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
}
