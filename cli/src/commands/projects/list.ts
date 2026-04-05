import { Command, Flags } from "@oclif/core";
import { ensureSynced } from "../../lib/auto-sync.js";

export default class ProjectsList extends Command {
  static override description = "List all indexed projects";

  static override examples = [
    "<%= config.bin %> projects list",
    "<%= config.bin %> projects list --json",
  ];

  static override flags = {
    json: Flags.boolean({ description: "Output as JSON" }),
  };

  async run() {
    const { flags } = await this.parse(ProjectsList);
    const db = await ensureSynced(60_000, (msg) => this.log(msg));

    const rows = db.prepare(`
      SELECT id, name, original_path, session_count, last_activity
      FROM projects ORDER BY session_count DESC
    `).all() as { id: string; name: string; original_path: string; session_count: number; last_activity: string }[];

    if (flags.json) {
      this.log(JSON.stringify(rows, null, 2));
      return;
    }

    for (const r of rows) {
      this.log(`${r.original_path}  sessions=${r.session_count}  last=${r.last_activity || "n/a"}`);
    }
  }
}
