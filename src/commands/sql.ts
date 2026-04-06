import { Args, Command, Flags } from "@oclif/core";
import { ensureSynced } from "../lib/auto-sync.js";

export default class Sql extends Command {
  static override description = "Run a raw SQL query against the Gigity database (read-only)";

  static override examples = [
    '<%= config.bin %> sql "SELECT COUNT(*) FROM sessions"',
    '<%= config.bin %> sql "SELECT tool_name, COUNT(*) as n FROM tool_calls GROUP BY tool_name ORDER BY n DESC LIMIT 10"',
    '<%= config.bin %> sql "SELECT * FROM sessions WHERE compression_count > 0" --json',
    '<%= config.bin %> sql "PRAGMA table_info(sessions)"',
  ];

  static override args = {
    query: Args.string({ description: "SQL query", required: true }),
  };

  static override flags = {
    json: Flags.boolean({ description: "Output as JSON" }),
  };

  async run() {
    const { args, flags } = await this.parse(Sql);
    const db = await ensureSynced((msg) => this.log(msg));

    // Safety: only allow SELECT/EXPLAIN/PRAGMA
    const trimmed = args.query.trim().toUpperCase();
    if (!trimmed.startsWith("SELECT") && !trimmed.startsWith("EXPLAIN") && !trimmed.startsWith("PRAGMA")) {
      this.error("Only SELECT, EXPLAIN, and PRAGMA queries are allowed");
    }

    try {
      const rows = db.prepare(args.query).all();

      if (flags.json) {
        this.log(JSON.stringify(rows, null, 2));
        return;
      }

      if (rows.length === 0) {
        this.log("(no results)");
        return;
      }

      // Simple tabular output
      const cols = Object.keys(rows[0] as Record<string, unknown>);
      this.log(cols.join("\t"));
      for (const row of rows) {
        const r = row as Record<string, unknown>;
        this.log(cols.map((c) => String(r[c] ?? "")).join("\t"));
      }
    } catch (error) {
      this.error(String(error));
    }
  }
}
