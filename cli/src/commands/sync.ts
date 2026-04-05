import { Command } from "@oclif/core";
import { getWritableDb } from "../lib/db.js";
import { syncAll } from "../lib/sync.js";

export default class Sync extends Command {
  static override description =
    "Sync ~/.claude/ session data into the local SQLite database";

  static override examples = ["<%= config.bin %> sync"];

  async run() {
    const db = getWritableDb();
    this.log("Syncing ~/.claude/ sessions...");
    const result = await syncAll(db);
    this.log(
      `Done: ${result.projectsScanned} projects, ${result.sessionsIndexed} sessions indexed in ${result.durationMs}ms`
    );
  }
}
