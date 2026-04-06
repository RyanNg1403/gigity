import { Args, Command, Flags } from "@oclif/core";
import { ensureSynced } from "../lib/auto-sync.js";
import { extractFileChanges, groupByFile, formatDiff, formatStat } from "../lib/diff.js";

export default class Diff extends Command {
  static override description = "Show file changes made in a session (edits, writes)";

  static override examples = [
    "<%= config.bin %> diff abc123",
    "<%= config.bin %> diff abc123 --stat",
    "<%= config.bin %> diff abc123 --file=src/lib/db.ts",
    "<%= config.bin %> diff abc123 --json",
  ];

  static override args = {
    id: Args.string({ description: "Session ID (or prefix)", required: true }),
  };

  static override flags = {
    stat: Flags.boolean({ description: "Show summary only (files changed, lines added/removed)" }),
    file: Flags.string({ description: "Filter to a specific file path (substring match)" }),
    json: Flags.boolean({ description: "Output as JSON" }),
  };

  async run() {
    const { args, flags } = await this.parse(Diff);
    const db = await ensureSynced(60_000, (msg) => this.log(msg));

    // Find session by prefix
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

    const jsonlPath = session.jsonl_path as string;
    const changes = await extractFileChanges(jsonlPath);

    if (changes.length === 0) {
      this.log("No file changes in this session.");
      return;
    }

    let summaries = groupByFile(changes);

    // Filter by file path if specified
    if (flags.file) {
      summaries = summaries.filter((s) =>
        s.filePath.toLowerCase().includes(flags.file!.toLowerCase())
      );
      if (summaries.length === 0) {
        this.log(`No changes matching "${flags.file}" in this session.`);
        return;
      }
    }

    if (flags.json) {
      this.log(JSON.stringify({
        sessionId: session.id,
        project: session.project_name,
        createdAt: session.created_at,
        files: summaries.map((s) => ({
          path: s.filePath,
          edits: s.edits,
          writes: s.writes,
          linesAdded: s.linesAdded,
          linesRemoved: s.linesRemoved,
          changes: s.changes.map((c) => ({
            tool: c.toolName,
            timestamp: c.timestamp,
            ...(c.toolName === "Edit" ? { oldString: c.oldString, newString: c.newString } : {}),
            ...(c.toolName === "Write" ? { contentLength: c.content?.length || 0 } : {}),
          })),
        })),
        rejected: changes.filter((c) => !c.succeeded).length,
      }, null, 2));
      return;
    }

    // Header
    const sid = (session.id as string).slice(0, 8);
    const prompt = ((session.first_prompt as string) || "").slice(0, 80).replace(/\n/g, " ");
    this.log(`\x1b[1mSession ${sid}\x1b[0m  ${session.project_name}  ${(session.created_at as string).slice(0, 16)}`);
    if (prompt) this.log(`\x1b[2m${prompt}\x1b[0m`);
    this.log("");

    // Rejected count
    const rejected = changes.filter((c) => !c.succeeded).length;
    if (rejected > 0) {
      this.log(`\x1b[33m${rejected} rejected change${rejected > 1 ? "s" : ""} not shown\x1b[0m\n`);
    }

    if (flags.stat) {
      this.log(formatStat(summaries));
    } else {
      this.log(formatDiff(summaries));
      // Also show stat summary at the bottom
      this.log("---");
      this.log(formatStat(summaries));
    }
  }
}
