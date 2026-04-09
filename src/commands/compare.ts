import { Args, Command, Flags } from "@oclif/core";
import { ensureSynced } from "../lib/auto-sync.js";
import { resolveSession, AmbiguousSessionError, ResolvedSession } from "../lib/resolve-session.js";
import { getFileSnapshots, readSnapshot, FileSnapshot } from "../lib/file-history.js";
import { unifiedDiff, formatStat, NetFileDiff } from "../lib/diff.js";

export default class Compare extends Command {
  static override description = "Compare file changes between two sessions";

  static override examples = [
    "<%= config.bin %> compare abc123 def456",
    "<%= config.bin %> compare abc123 def456 --stat",
    "<%= config.bin %> compare abc123 def456 --file=db.ts",
    "<%= config.bin %> compare abc123 def456 --json",
  ];

  static override args = {
    a: Args.string({ description: "First session ID or prefix", required: true }),
    b: Args.string({ description: "Second session ID or prefix", required: true }),
  };

  static override flags = {
    stat: Flags.boolean({ description: "Show summary only (files changed, lines added/removed)" }),
    file: Flags.string({ description: "Filter to a specific file (substring match)" }),
    json: Flags.boolean({ description: "Output as JSON" }),
  };

  async run() {
    const { args, flags } = await this.parse(Compare);
    const db = await ensureSynced((msg) => this.log(msg));

    const sessionA = this.resolveOrError(db, args.a);
    const sessionB = this.resolveOrError(db, args.b);

    // Build file → final content maps for both sessions
    const filesA = await this.buildFileMap(sessionA);
    const filesB = await this.buildFileMap(sessionB);

    // Classify files
    const allPaths = new Set([...filesA.keys(), ...filesB.keys()]);
    const onlyA: string[] = [];
    const onlyB: string[] = [];
    const shared: string[] = [];

    for (const p of allPaths) {
      if (flags.file && !p.toLowerCase().includes(flags.file.toLowerCase())) continue;
      if (filesA.has(p) && filesB.has(p)) shared.push(p);
      else if (filesA.has(p)) onlyA.push(p);
      else onlyB.push(p);
    }

    onlyA.sort();
    onlyB.sort();
    shared.sort();

    // Compute diffs for shared files (A final → B final)
    const diffs: NetFileDiff[] = [];
    for (const p of shared) {
      const contentA = filesA.get(p)!;
      const contentB = filesB.get(p)!;
      if (contentA === contentB) continue;
      const { text, added, removed } = unifiedDiff(contentA, contentB, p);
      if (text) {
        diffs.push({ filePath: p, linesAdded: added, linesRemoved: removed, isNew: false, diffText: text });
      }
    }

    const identical = shared.filter((p) => filesA.get(p) === filesB.get(p));

    if (flags.json) {
      const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
      this.log(JSON.stringify({
        sessionA: { id: sessionA.id, date: sessionA.created_at, project: sessionA.project_name, model: sessionA.model_used, branch: sessionA.git_branch },
        sessionB: { id: sessionB.id, date: sessionB.created_at, project: sessionB.project_name, model: sessionB.model_used, branch: sessionB.git_branch },
        onlyA: onlyA,
        onlyB: onlyB,
        identical: identical,
        diffs: diffs.map((d) => ({
          path: d.filePath,
          linesAdded: d.linesAdded,
          linesRemoved: d.linesRemoved,
          diff: stripAnsi(d.diffText),
        })),
      }, null, 2));
      return;
    }

    // Header
    const shortA = sessionA.id.slice(0, 8);
    const shortB = sessionB.id.slice(0, 8);
    const modelA = (sessionA.model_used || "").replace("claude-", "");
    const modelB = (sessionB.model_used || "").replace("claude-", "");
    const branchA = sessionA.git_branch ? `  ${sessionA.git_branch}` : "";
    const branchB = sessionB.git_branch ? `  ${sessionB.git_branch}` : "";

    this.log(`\x1b[1mCompare\x1b[0m`);
    this.log(`  \x1b[33mA\x1b[0m  ${shortA}  ${sessionA.created_at.slice(0, 16)}  ${sessionA.project_name}  ${modelA}${branchA}`);
    this.log(`  \x1b[36mB\x1b[0m  ${shortB}  ${sessionB.created_at.slice(0, 16)}  ${sessionB.project_name}  ${modelB}${branchB}`);
    this.log("");

    // Files only in A
    if (onlyA.length > 0) {
      this.log(`\x1b[33mOnly in A\x1b[0m (${onlyA.length}):`);
      for (const p of onlyA) this.log(`  ${p}`);
      this.log("");
    }

    // Files only in B
    if (onlyB.length > 0) {
      this.log(`\x1b[36mOnly in B\x1b[0m (${onlyB.length}):`);
      for (const p of onlyB) this.log(`  ${p}`);
      this.log("");
    }

    // Identical shared files
    if (identical.length > 0) {
      this.log(`\x1b[32mIdentical\x1b[0m (${identical.length}):`);
      for (const p of identical) this.log(`  ${p}`);
      this.log("");
    }

    // Differing shared files
    if (diffs.length > 0) {
      this.log(`\x1b[1mDifferences\x1b[0m (A → B, ${diffs.length} file${diffs.length > 1 ? "s" : ""}):\n`);

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
    } else if (shared.length > 0 && diffs.length === 0) {
      this.log("All shared files are identical.");
    }

    if (onlyA.length === 0 && onlyB.length === 0 && diffs.length === 0 && identical.length === 0) {
      this.log("No file changes found in either session.");
    }

    // Summary line
    this.log(`\n${filesA.size} file${filesA.size !== 1 ? "s" : ""} in A, ${filesB.size} file${filesB.size !== 1 ? "s" : ""} in B, ${shared.length} shared, ${diffs.length} differ${diffs.length !== 1 ? "" : "s"}`);
  }

  private resolveOrError(db: import("better-sqlite3").Database, idOrPrefix: string): ResolvedSession {
    try {
      const session = resolveSession(db, idOrPrefix);
      if (!session) this.error(`Session not found: ${idOrPrefix}`);
      return session;
    } catch (e) {
      if (e instanceof AmbiguousSessionError) this.error(e.message);
      throw e;
    }
  }

  /**
   * Build a map of filePath → final content for a session.
   * Uses file-history snapshots: final version content for each file.
   */
  private async buildFileMap(session: ResolvedSession): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const snapshots = await getFileSnapshots(session.id, session.jsonl_path);

    for (const snap of snapshots) {
      if (snap.firstVersion === snap.lastVersion) continue; // no change
      const content = readSnapshot(snap.historyDir, snap.hash, snap.lastVersion);
      if (content === null) continue;
      map.set(snap.filePath, content);
    }

    return map;
  }
}
