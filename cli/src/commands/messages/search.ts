import { Args, Command, Flags } from "@oclif/core";
import { getDb } from "../../lib/db.js";
import { parseJsonl, extractText } from "../../lib/jsonl.js";

export default class MessagesSearch extends Command {
  static override description = "Search message content across sessions using keyword matching";

  static override examples = [
    '<%= config.bin %> messages search "authentication bug"',
    '<%= config.bin %> messages search "database migration" --project=my-app',
    '<%= config.bin %> messages search "decided to use" --type=assistant --limit=20',
    '<%= config.bin %> messages search "ENOENT" --session=abc1 --json',
  ];

  static override args = {
    query: Args.string({ description: "Search query (keywords)", required: true }),
  };

  static override flags = {
    project: Flags.string({ description: "Filter by project path (substring match)" }),
    session: Flags.string({ description: "Search within a specific session ID (or prefix)" }),
    type: Flags.string({ description: "Filter by message type: user, assistant", options: ["user", "assistant"] }),
    limit: Flags.integer({ description: "Max results", default: 10 }),
    context: Flags.integer({ description: "Lines of context around match", default: 0 }),
    json: Flags.boolean({ description: "Output as JSON" }),
  };

  async run() {
    const { args, flags } = await this.parse(MessagesSearch);
    const db = getDb();
    const queryLower = args.query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(Boolean);

    // Determine which sessions to search
    let sessions: { id: string; jsonl_path: string; project_path: string; project_name: string; first_prompt: string }[];

    if (flags.session) {
      sessions = db.prepare(`
        SELECT s.id, s.jsonl_path, s.first_prompt, p.original_path as project_path, p.name as project_name
        FROM sessions s JOIN projects p ON s.project_id = p.id
        WHERE s.id LIKE ?
      `).all(`${flags.session}%`) as typeof sessions;
    } else if (flags.project) {
      sessions = db.prepare(`
        SELECT s.id, s.jsonl_path, s.first_prompt, p.original_path as project_path, p.name as project_name
        FROM sessions s JOIN projects p ON s.project_id = p.id
        WHERE p.original_path LIKE ? OR p.name LIKE ?
        ORDER BY s.created_at DESC
      `).all(`%${flags.project}%`, `%${flags.project}%`) as typeof sessions;
    } else {
      sessions = db.prepare(`
        SELECT s.id, s.jsonl_path, s.first_prompt, p.original_path as project_path, p.name as project_name
        FROM sessions s JOIN projects p ON s.project_id = p.id
        ORDER BY s.created_at DESC
      `).all() as typeof sessions;
    }

    interface Match {
      session_id: string;
      project: string;
      msg_index: number;
      type: string;
      timestamp: string;
      model: string;
      snippet: string;
      score: number;
    }

    const results: Match[] = [];
    let totalSearched = 0;

    for (const sess of sessions) {
      if (results.length >= flags.limit) break;

      let msgIdx = 0;
      try {
        for await (const record of parseJsonl(sess.jsonl_path)) {
          if (!record.type || record.type === "file-history-snapshot" || record.type === "last-prompt" || record.type === "progress") continue;
          if (flags.type && record.type !== flags.type) { msgIdx++; continue; }
          if (record.type === "system") { msgIdx++; continue; }

          const text = extractText(record);
          const textLower = text.toLowerCase();

          // Simple BM25-inspired scoring: count term matches, weight by rarity
          let score = 0;
          for (const term of queryTerms) {
            const count = textLower.split(term).length - 1;
            if (count > 0) {
              score += Math.log(1 + count) * (1 / Math.max(term.length, 1));
            }
          }

          if (score > 0) {
            // Extract snippet around first match
            const firstTermIdx = Math.min(
              ...queryTerms.map((t) => {
                const i = textLower.indexOf(t);
                return i >= 0 ? i : Infinity;
              })
            );
            const snippetStart = Math.max(0, firstTermIdx - 80);
            const snippetEnd = Math.min(text.length, firstTermIdx + 200);
            const snippet = (snippetStart > 0 ? "..." : "") +
              text.slice(snippetStart, snippetEnd).replace(/\n/g, " ") +
              (snippetEnd < text.length ? "..." : "");

            results.push({
              session_id: sess.id,
              project: sess.project_name,
              msg_index: msgIdx,
              type: record.type,
              timestamp: (record.timestamp || "").slice(0, 19),
              model: record.message?.model || "",
              snippet,
              score,
            });

            if (results.length >= flags.limit) break;
          }
          msgIdx++;
        }
      } catch {
        // Skip unreadable files
      }
      totalSearched++;
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    if (flags.json) {
      this.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      this.log(`No matches for "${args.query}" across ${totalSearched} sessions`);
      return;
    }

    this.log(`Found ${results.length} matches across ${totalSearched} sessions:\n`);
    for (const r of results) {
      const label = r.type === "user" ? "YOU" : "CLAUDE";
      this.log(`[${r.project}] ${r.session_id.slice(0, 8)}  msg#${r.msg_index}  ${r.timestamp}  ${label}`);
      this.log(`  ${r.snippet}`);
      this.log("");
    }
  }
}
