import { parseJsonl, type JsonlRecord } from "./jsonl.js";

export interface FileChange {
  filePath: string;
  toolName: "Edit" | "Write";
  toolUseId: string;
  oldString?: string;
  newString?: string;
  content?: string;
  replaceAll?: boolean;
  timestamp: string;
  succeeded: boolean;
}

export interface FileSummary {
  filePath: string;
  edits: number;
  writes: number;
  linesAdded: number;
  linesRemoved: number;
  changes: FileChange[];
}

/**
 * Extract all file-modifying tool calls from a session JSONL,
 * matched with their tool_result to determine success/failure.
 */
export async function extractFileChanges(jsonlPath: string): Promise<FileChange[]> {
  const toolUses = new Map<string, FileChange>();
  const toolResults = new Map<string, { isError: boolean }>();

  for await (const record of parseJsonl(jsonlPath)) {
    if (record.type === "assistant") {
      extractToolUses(record, toolUses);
    } else if (record.type === "user") {
      extractToolResults(record, toolResults);
    }
  }

  // Match tool_use with tool_result and mark success/failure
  const changes: FileChange[] = [];
  for (const [id, change] of toolUses) {
    const result = toolResults.get(id);
    // If no result found, assume it succeeded (edge case: session still running)
    change.succeeded = result ? !result.isError : true;
    changes.push(change);
  }

  return changes;
}

function extractToolUses(record: JsonlRecord, out: Map<string, FileChange>) {
  const content = record.message?.content;
  if (!Array.isArray(content)) return;
  const timestamp = record.timestamp || "";

  for (const block of content) {
    const b = block as Record<string, unknown>;
    if (b.type !== "tool_use") continue;

    const name = b.name as string;
    const id = b.id as string;
    const input = b.input as Record<string, unknown> | undefined;
    if (!input?.file_path) continue;

    if (name === "Edit") {
      out.set(id, {
        filePath: String(input.file_path),
        toolName: "Edit",
        toolUseId: id,
        oldString: input.old_string != null ? String(input.old_string) : undefined,
        newString: input.new_string != null ? String(input.new_string) : undefined,
        replaceAll: input.replace_all === true,
        timestamp,
        succeeded: true,
      });
    } else if (name === "Write") {
      out.set(id, {
        filePath: String(input.file_path),
        toolName: "Write",
        toolUseId: id,
        content: input.content != null ? String(input.content) : undefined,
        timestamp,
        succeeded: true,
      });
    }
  }
}

function extractToolResults(record: JsonlRecord, out: Map<string, { isError: boolean }>) {
  const content = record.message?.content;
  if (!Array.isArray(content)) return;

  for (const block of content) {
    const b = block as Record<string, unknown>;
    if (b.type !== "tool_result" || !b.tool_use_id) continue;
    out.set(String(b.tool_use_id), { isError: b.is_error === true });
  }
}

/** Group changes by file path, only successful ones */
export function groupByFile(changes: FileChange[]): FileSummary[] {
  const successful = changes.filter((c) => c.succeeded);
  const groups = new Map<string, FileChange[]>();

  for (const c of successful) {
    const existing = groups.get(c.filePath) || [];
    existing.push(c);
    groups.set(c.filePath, existing);
  }

  const summaries: FileSummary[] = [];
  for (const [filePath, fileChanges] of groups) {
    let linesAdded = 0;
    let linesRemoved = 0;
    let edits = 0;
    let writes = 0;

    for (const c of fileChanges) {
      if (c.toolName === "Edit") {
        edits++;
        const oldLines = (c.oldString || "").split("\n").length;
        const newLines = (c.newString || "").split("\n").length;
        linesAdded += Math.max(0, newLines - oldLines);
        linesRemoved += Math.max(0, oldLines - newLines);
      } else {
        writes++;
        linesAdded += (c.content || "").split("\n").length;
      }
    }

    summaries.push({ filePath, edits, writes, linesAdded, linesRemoved, changes: fileChanges });
  }

  // Sort by first change timestamp
  summaries.sort((a, b) => (a.changes[0].timestamp < b.changes[0].timestamp ? -1 : 1));
  return summaries;
}

/** Format a file summary as unified-diff-style output */
export function formatDiff(summaries: FileSummary[]): string {
  const lines: string[] = [];

  for (const summary of summaries) {
    const shortPath = summary.filePath;

    for (const change of summary.changes) {
      if (change.toolName === "Write") {
        lines.push(`\x1b[1m+++ ${shortPath}\x1b[0m  \x1b[2m(write)\x1b[0m`);
        for (const line of (change.content || "").split("\n").slice(0, 50)) {
          lines.push(`\x1b[32m+${line}\x1b[0m`);
        }
        const totalLines = (change.content || "").split("\n").length;
        if (totalLines > 50) {
          lines.push(`\x1b[2m  ... ${totalLines - 50} more lines\x1b[0m`);
        }
        lines.push("");
      } else if (change.toolName === "Edit") {
        lines.push(`\x1b[1m--- ${shortPath}\x1b[0m`);
        lines.push(`\x1b[1m+++ ${shortPath}\x1b[0m`);
        for (const line of (change.oldString || "").split("\n")) {
          lines.push(`\x1b[31m-${line}\x1b[0m`);
        }
        for (const line of (change.newString || "").split("\n")) {
          lines.push(`\x1b[32m+${line}\x1b[0m`);
        }
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

/** Format a --stat style summary */
export function formatStat(summaries: FileSummary[]): string {
  if (summaries.length === 0) return "No file changes in this session.";

  const lines: string[] = [];
  let totalAdded = 0;
  let totalRemoved = 0;
  let totalEdits = 0;
  let totalWrites = 0;

  // Find max path length for alignment
  const maxPath = Math.min(60, Math.max(...summaries.map((s) => s.filePath.length)));

  for (const s of summaries) {
    const path = s.filePath.length > 60
      ? "..." + s.filePath.slice(s.filePath.length - 57)
      : s.filePath;
    const padded = path.padEnd(maxPath + 2);
    const bar = "\x1b[32m" + "+".repeat(Math.min(s.linesAdded, 25)) + "\x1b[31m" + "-".repeat(Math.min(s.linesRemoved, 25)) + "\x1b[0m";
    const ops = s.writes > 0 ? `${s.writes} write` : `${s.edits} edit${s.edits > 1 ? "s" : ""}`;
    lines.push(` ${padded} ${ops.padEnd(10)} ${bar}`);
    totalAdded += s.linesAdded;
    totalRemoved += s.linesRemoved;
    totalEdits += s.edits;
    totalWrites += s.writes;
  }

  lines.push("");
  const parts = [`${summaries.length} file${summaries.length > 1 ? "s" : ""} changed`];
  if (totalEdits > 0) parts.push(`${totalEdits} edit${totalEdits > 1 ? "s" : ""}`);
  if (totalWrites > 0) parts.push(`${totalWrites} write${totalWrites > 1 ? "s" : ""}`);
  parts.push(`\x1b[32m+${totalAdded}\x1b[0m/\x1b[31m-${totalRemoved}\x1b[0m lines`);
  lines.push(parts.join(", "));

  return lines.join("\n");
}
