import { Command, Flags } from "@oclif/core";
import { getDb } from "../../lib/db.js";

export default class SessionsList extends Command {
  static override description = "List sessions with optional filters";

  static override examples = [
    "<%= config.bin %> sessions list",
    "<%= config.bin %> sessions list --project=my-app --limit=10",
    "<%= config.bin %> sessions list --model=opus --after=2026-03-01",
    "<%= config.bin %> sessions list --branch=main --json",
  ];

  static override flags = {
    project: Flags.string({ description: "Filter by project path (substring match)" }),
    model: Flags.string({ description: "Filter by model name (substring match)" }),
    after: Flags.string({ description: "Sessions created after this date (YYYY-MM-DD)" }),
    before: Flags.string({ description: "Sessions created before this date (YYYY-MM-DD)" }),
    branch: Flags.string({ description: "Filter by git branch" }),
    limit: Flags.integer({ description: "Max results", default: 20 }),
    json: Flags.boolean({ description: "Output as JSON" }),
  };

  async run() {
    const { flags } = await this.parse(SessionsList);
    const db = getDb();

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (flags.project) {
      conditions.push("(p.original_path LIKE ? OR p.name LIKE ?)");
      params.push(`%${flags.project}%`, `%${flags.project}%`);
    }
    if (flags.model) {
      conditions.push("s.model_used LIKE ?");
      params.push(`%${flags.model}%`);
    }
    if (flags.after) {
      conditions.push("s.created_at >= ?");
      params.push(flags.after);
    }
    if (flags.before) {
      conditions.push("s.created_at <= ?");
      params.push(flags.before + "T23:59:59");
    }
    if (flags.branch) {
      conditions.push("s.git_branch = ?");
      params.push(flags.branch);
    }

    const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
    const query = `
      SELECT s.id, s.first_prompt, s.message_count, s.tool_call_count,
        s.model_used, s.created_at, s.duration_ms, s.git_branch,
        s.total_input_tokens, s.total_output_tokens,
        s.total_cache_read_tokens, s.total_cache_creation_tokens,
        s.compression_count, p.original_path as project_path, p.name as project_name
      FROM sessions s JOIN projects p ON s.project_id = p.id
      ${where}
      ORDER BY s.created_at DESC LIMIT ?
    `;
    params.push(flags.limit);

    const rows = db.prepare(query).all(...params) as Record<string, unknown>[];

    if (flags.json) {
      this.log(JSON.stringify(rows, null, 2));
      return;
    }

    for (const r of rows) {
      const prompt = ((r.first_prompt as string) || "").slice(0, 80).replace(/\n/g, " ");
      const created = ((r.created_at as string) || "").slice(0, 16);
      this.log(
        `${r.id}  ${created}  msgs=${r.message_count}  tools=${r.tool_call_count}  ${r.model_used || "?"}  ${r.project_name}`
      );
      if (prompt) this.log(`  "${prompt}"`);
    }
  }
}
