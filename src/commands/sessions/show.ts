import { Args, Command, Flags } from "@oclif/core";
import { ensureSynced } from "../../lib/auto-sync.js";
import { estimateCost } from "../../lib/cost.js";

export default class SessionsShow extends Command {
  static override description = "Show detailed metadata for a session";

  static override examples = [
    "<%= config.bin %> sessions show abc123",
    "<%= config.bin %> sessions show f81f --json",
  ];

  static override args = {
    id: Args.string({ description: "Session ID (or prefix)", required: true }),
  };

  static override flags = {
    json: Flags.boolean({ description: "Output as JSON" }),
  };

  async run() {
    const { args, flags } = await this.parse(SessionsShow);
    const db = await ensureSynced((msg) => this.log(msg));

    // Support prefix matching
    const row = db.prepare(`
      SELECT s.*, p.original_path as project_path, p.name as project_name
      FROM sessions s JOIN projects p ON s.project_id = p.id
      WHERE s.id LIKE ?
      ORDER BY s.created_at DESC LIMIT 1
    `).get(`${args.id}%`) as Record<string, unknown> | undefined;

    if (!row) {
      this.error(`Session not found: ${args.id}`);
    }

    if (flags.json) {
      this.log(JSON.stringify(row, null, 2));
      return;
    }

    const cost = estimateCost(
      (row.model_used as string) || "",
      (row.total_input_tokens as number) || 0,
      (row.total_output_tokens as number) || 0,
      (row.total_cache_read_tokens as number) || 0,
      (row.total_cache_creation_tokens as number) || 0
    );

    this.log(`Session: ${row.id}`);
    this.log(`Project: ${row.project_path} (${row.project_name})`);
    this.log(`Created: ${row.created_at}`);
    this.log(`Model: ${row.model_used || "unknown"}`);
    this.log(`Messages: ${row.message_count}  Tool calls: ${row.tool_call_count}  Compressions: ${row.compression_count}`);
    this.log(`Branch: ${row.git_branch || "n/a"}`);
    this.log(`Tokens: in=${row.total_input_tokens} out=${row.total_output_tokens} cache_read=${row.total_cache_read_tokens} cache_write=${row.total_cache_creation_tokens}`);
    this.log(`Est. cost: $${cost.toFixed(2)}`);
    if (row.first_prompt) this.log(`Prompt: ${(row.first_prompt as string).slice(0, 200)}`);
  }
}
