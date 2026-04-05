import { Args, Command, Flags } from "@oclif/core";
import { ensureSynced } from "../../lib/auto-sync.js";
import { parseJsonl } from "../../lib/jsonl.js";

/** Extract only human-readable text (no tool inputs, no file paths, no JSON blobs) */
function extractReadableText(record: { type: string; message?: { content?: unknown } }): string {
  const content = record.message?.content;
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const block of content) {
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") {
      parts.push(b.text);
    }
  }
  return parts.join(" ");
}

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
    const db = await ensureSynced(60_000, (msg) => this.log(msg));
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

          const text = extractReadableText(record);
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

    const uniqueSessions = new Set(results.map((r) => r.session_id));
    this.log(`Found ${results.length} match${results.length > 1 ? "es" : ""} in ${uniqueSessions.size} session${uniqueSessions.size > 1 ? "s" : ""}:\n`);

    for (const r of results) {
      const label = r.type === "user" ? "YOU" : "CLAUDE";
      const snippet = r.snippet.slice(0, 300);
      this.log(`  ${r.project}/${r.session_id.slice(0, 8)}  ${r.timestamp}  ${label}`);
      this.log(`  ${snippet}`);
      this.log("");
    }
  }
}
