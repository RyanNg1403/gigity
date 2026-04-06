import fs from "node:fs";
import readline from "node:readline";

export interface JsonlRecord {
  type: string;
  uuid?: string;
  timestamp?: string;
  message?: {
    role: string;
    model?: string;
    content?: unknown;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  subtype?: string;
  compactMetadata?: { preTokens?: number; postTokens?: number };
  [key: string]: unknown;
}

/** Stream-parse a JSONL file */
export async function* parseJsonl(filePath: string): AsyncGenerator<JsonlRecord> {
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line) as JsonlRecord;
    } catch {
      // skip malformed
    }
  }
}

/** Extract plain text from a record's content */
export function extractText(record: JsonlRecord): string {
  const content = record.message?.content;
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const block of content) {
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    if (b.type === "thinking" && typeof b.thinking === "string") parts.push(b.thinking);
    if (b.type === "tool_use" && typeof b.name === "string") {
      parts.push(b.name);
      if (b.input) parts.push(JSON.stringify(b.input));
    }
    if (b.type === "tool_result") {
      const c = b.content;
      if (typeof c === "string") parts.push(c);
      if (Array.isArray(c)) {
        for (const sub of c) {
          const s = sub as Record<string, unknown>;
          if (s.type === "text" && typeof s.text === "string") parts.push(s.text);
        }
      }
    }
  }
  return parts.join(" ");
}
