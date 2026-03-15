import fs from "fs";
import readline from "readline";

export interface JsonlRecord {
  type: string;
  uuid?: string;
  parentUuid?: string;
  isSidechain?: boolean;
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  slug?: string;
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
  // system type fields
  subtype?: string;
  compactMetadata?: unknown;
  durationMs?: number;
  // file-history-snapshot
  snapshot?: unknown;
  // plan content
  planContent?: string;
  [key: string]: unknown;
}

/** Stream-parse a JSONL file, yielding one record at a time */
export async function* parseJsonl(filePath: string): AsyncGenerator<JsonlRecord> {
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line) as JsonlRecord;
    } catch {
      // Skip malformed lines
    }
  }
}

/** Parse entire JSONL file into array (for smaller files) */
export async function parseJsonlAll(filePath: string): Promise<JsonlRecord[]> {
  const records: JsonlRecord[] = [];
  for await (const record of parseJsonl(filePath)) {
    records.push(record);
  }
  return records;
}
