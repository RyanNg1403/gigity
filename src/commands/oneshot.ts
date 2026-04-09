import { Args, Command, Flags } from "@oclif/core";
import path from "node:path";
import { execSync } from "node:child_process";
import { ensureSynced } from "../lib/auto-sync.js";
import { parseJsonl } from "../lib/jsonl.js";
import { extractReadableText, scoreMatch, SKIP_RECORD_TYPES } from "../lib/search.js";

export default class Oneshot extends Command {
  static override description =
    "Search for a message, export its session, and import it into a project — all in one command.";

  static override examples = [
    '<%= config.bin %> oneshot "accept the first three" -d ../byterover-cli',
    '<%= config.bin %> oneshot "fix auth bug" -d ../my-app -n auth-handoff',
    '<%= config.bin %> oneshot "database migration" -d . -f my-other-project',
  ];

  static override args = {
    query: Args.string({ description: "Search phrase to find the session", required: true }),
  };

  static override flags = {
    dest: Flags.string({
      char: "d",
      description: "Destination project directory for import",
      required: true,
    }),
    name: Flags.string({
      char: "n",
      description: "Archive file name (without .tar.gz)",
      default: "imported-session",
    }),
    from: Flags.string({
      char: "f",
      description: "Project to search sessions in (substring match, default: cwd)",
    }),
    yes: Flags.boolean({
      char: "y",
      description: "Accept all bundled environment artifacts without prompting",
      default: false,
    }),
    note: Flags.string({
      description: "Optional note to include in the handoff message",
    }),
  };

  async run() {
    const { args, flags } = await this.parse(Oneshot);
    const db = await ensureSynced((msg) => this.log(msg));

    // 1. Resolve --from (default to cwd)
    const fromProject = flags.from
      ? flags.from === "." || flags.from === "./" ? path.resolve(".") : flags.from
      : path.resolve(".");

    // 2. Search for the session
    this.log(`Searching for: "${args.query}" in ${fromProject}...`);

    const sessions = db.prepare(`
      SELECT s.id, s.jsonl_path, p.name as project_name
      FROM sessions s JOIN projects p ON s.project_id = p.id
      WHERE p.original_path LIKE ? OR p.name LIKE ?
      ORDER BY s.created_at DESC
    `).all(`%${fromProject}%`, `%${fromProject}%`) as { id: string; jsonl_path: string; project_name: string }[];

    if (sessions.length === 0) {
      this.error(`No sessions found for project matching "${fromProject}"`);
    }

    const queryLower = args.query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter((t) => t.length >= 3);

    let bestMatch: { sessionId: string; project: string; score: number; snippet: string } | null = null;

    for (const sess of sessions) {
      try {
        for await (const record of parseJsonl(sess.jsonl_path)) {
          if (!record.type || SKIP_RECORD_TYPES.has(record.type)) continue;

          const text = extractReadableText(record);
          const { score, matchIdx } = scoreMatch(text.toLowerCase(), queryLower, queryTerms);

          if (score > 0 && matchIdx >= 0 && (!bestMatch || score > bestMatch.score)) {
            const start = Math.max(0, matchIdx - 30);
            const end = Math.min(text.length, matchIdx + 120);
            const snippet = (start > 0 ? "..." : "") + text.slice(start, end).replace(/\n/g, " ") + (end < text.length ? "..." : "");
            bestMatch = { sessionId: sess.id, project: sess.project_name, score, snippet };
          }
        }
      } catch {
        // skip unreadable
      }
      if (bestMatch && bestMatch.score >= 1000) break; // exact phrase found, stop early
    }

    if (!bestMatch) {
      this.error(`No messages matching "${args.query}" in project "${fromProject}"`);
    }

    this.log(`\nFound session: ${bestMatch.project}/${bestMatch.sessionId.slice(0, 8)}`);
    this.log(`  ${bestMatch.snippet}\n`);

    // 3. Export
    const destProject = path.resolve(flags.dest);
    const archivePath = path.resolve(destProject, flags.name.endsWith(".tar.gz") ? flags.name : `${flags.name}.tar.gz`);

    this.log(`Exporting session ${bestMatch.sessionId.slice(0, 8)}...`);
    try {
      execSync(`ggt sessions export ${bestMatch.sessionId} -o "${archivePath}"`, {
        stdio: "inherit",
      });
    } catch {
      this.error("Export failed");
    }

    // 4. Import
    this.log(`\nImporting into ${destProject}...`);
    const yesFlag = flags.yes ? " --yes" : "";
    const noteFlag = flags.note ? ` --note "${flags.note.replace(/"/g, '\\"')}"` : "";
    try {
      execSync(`ggt sessions import "${archivePath}" --dest "${destProject}"${yesFlag}${noteFlag}`, {
        stdio: "inherit",
      });
    } catch {
      this.error("Import failed");
    }

    this.log(`\nDone. Archive saved at: ${archivePath}`);
  }
}
