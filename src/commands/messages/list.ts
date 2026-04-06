import { Args, Command, Flags } from "@oclif/core";
import { ensureSynced } from "../../lib/auto-sync.js";
import { parseJsonl, extractText } from "../../lib/jsonl.js";

export default class MessagesList extends Command {
  static override description = "List messages from a session";

  static override examples = [
    "<%= config.bin %> messages list abc123",
    "<%= config.bin %> messages list abc1 --type=user --limit=10",
    "<%= config.bin %> messages list abc1 --type=assistant --full",
    "<%= config.bin %> messages list abc1 --offset=50 --limit=20 --json",
  ];

  static override args = {
    session: Args.string({ description: "Session ID (or prefix)", required: true }),
  };

  static override flags = {
    type: Flags.string({ description: "Filter by type: user, assistant, system", options: ["user", "assistant", "system"] }),
    offset: Flags.integer({ description: "Skip first N messages", default: 0 }),
    limit: Flags.integer({ description: "Max messages to show", default: 20 }),
    json: Flags.boolean({ description: "Output as JSON" }),
    full: Flags.boolean({ description: "Show full message content (default: truncated)" }),
  };

  async run() {
    const { args, flags } = await this.parse(MessagesList);
    const db = await ensureSynced((msg) => this.log(msg));

    const session = db.prepare(
      "SELECT jsonl_path FROM sessions WHERE id LIKE ? LIMIT 1"
    ).get(`${args.session}%`) as { jsonl_path: string } | undefined;

    if (!session) {
      this.error(`Session not found: ${args.session}`);
    }

    const messages: { index: number; type: string; timestamp: string; model: string; text: string }[] = [];
    let idx = 0;

    for await (const record of parseJsonl(session.jsonl_path)) {
      if (!record.type || record.type === "file-history-snapshot" || record.type === "last-prompt" || record.type === "progress") continue;
      if (flags.type && record.type !== flags.type) { idx++; continue; }

      if (idx >= flags.offset && messages.length < flags.limit) {
        const text = extractText(record);
        messages.push({
          index: idx,
          type: record.type,
          timestamp: (record.timestamp || "").slice(0, 19),
          model: record.message?.model || "",
          text,
        });
      }
      idx++;
      if (messages.length >= flags.limit && idx > flags.offset + flags.limit) break;
    }

    if (flags.json) {
      this.log(JSON.stringify(messages, null, 2));
      return;
    }

    for (const m of messages) {
      const maxLen = flags.full ? Infinity : 200;
      const preview = m.text.replace(/\n/g, " ").slice(0, maxLen);
      const truncated = m.text.length > maxLen ? "..." : "";
      const label = m.type === "user" ? "YOU" : m.type === "assistant" ? "CLAUDE" : "SYSTEM";
      this.log(`[${m.index}] ${m.timestamp}  ${label}${m.model ? ` (${m.model})` : ""}`);
      if (preview) this.log(`  ${preview}${truncated}`);
    }
  }
}
