import { Args, Command, Flags } from "@oclif/core";
import { ensureSynced } from "../lib/auto-sync.js";
import { resolveSession } from "../lib/resolve-session.js";
import { computeSessionDiff, formatStat, grepDiffHunks } from "../lib/diff.js";

export default class Diff extends Command {
  static override description = "Show net file changes in a session (first state → final state)";

  static override examples = [
    "<%= config.bin %> diff",
    "<%= config.bin %> diff abc123 --stat",
    "<%= config.bin %> diff --file=src/lib/db.ts",
    "<%= config.bin %> diff --grep=initSchema",
    "<%= config.bin %> diff abc123 --json",
  ];

  static override args = {
    id: Args.string({ description: "Session ID or prefix (default: last session in current project)" }),
  };

  static override flags = {
    stat: Flags.boolean({ description: "Show summary only (files changed, lines added/removed)" }),
    file: Flags.string({ description: "Filter to a specific file path (substring match)" }),
    grep: Flags.string({ description: "Only show diff hunks matching this pattern" }),
    json: Flags.boolean({ description: "Output as JSON" }),
  };

  async run() {
    const { args, flags } = await this.parse(Diff);
    const db = await ensureSynced((msg) => this.log(msg));

    const session = resolveSession(db, args.id);
    if (!session) {
      this.error(args.id ? `Session not found: ${args.id}` : "No sessions found in current project.");
    }

    let { diffs, rejected } = await computeSessionDiff(session.id, session.jsonl_path);

    if (diffs.length === 0) {
      this.log("No file changes in this session.");
      return;
    }

    if (flags.file) {
      diffs = diffs.filter((d) =>
        d.filePath.toLowerCase().includes(flags.file!.toLowerCase()),
      );
    }

    // --grep: filter to only hunks matching the pattern
    if (flags.grep) {
      diffs = diffs
        .map((d) => {
          const filtered = grepDiffHunks(d.diffText, flags.grep!);
          if (!filtered) return null;
          return { ...d, diffText: filtered };
        })
        .filter((d): d is NonNullable<typeof d> => d !== null);
    }

    if (diffs.length === 0) {
      this.log(`No changes matching "${flags.grep || flags.file}" in this session.`);
      return;
    }

    if (flags.json) {
      this.log(JSON.stringify({
        sessionId: session.id,
        project: session.project_name,
        createdAt: session.created_at,
        files: diffs.map((d) => ({
          path: d.filePath,
          linesAdded: d.linesAdded,
          linesRemoved: d.linesRemoved,
          isNew: d.isNew,
        })),
        rejected,
      }, null, 2));
      return;
    }

    const sid = session.id.slice(0, 8);
    const prompt = (session.first_prompt || "").slice(0, 80).replace(/\n/g, " ");
    this.log(`\x1b[1mSession ${sid}\x1b[0m  ${session.project_name}  ${session.created_at.slice(0, 16)}`);
    if (prompt) this.log(`\x1b[2m${prompt}\x1b[0m`);
    this.log("");

    if (rejected > 0) {
      this.log(`\x1b[33m${rejected} rejected change${rejected > 1 ? "s" : ""} not shown\x1b[0m\n`);
    }

    if (flags.stat) {
      this.log(formatStat(diffs));
    } else {
      for (const d of diffs) {
        this.log(d.diffText);
        this.log("");
      }
      this.log("---");
      this.log(formatStat(diffs));
    }
  }
}
