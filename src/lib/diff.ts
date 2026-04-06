import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { parseJsonl } from "./jsonl.js";
import { getHistoryDir, buildHashToPathMap, scanFileHistory } from "./file-history.js";

// ── Public types ────────────────────────────────────────────────

export interface NetFileDiff {
  filePath: string;
  linesAdded: number;
  linesRemoved: number;
  isNew: boolean;
  diffText: string;
}

export interface SessionDiffResult {
  diffs: NetFileDiff[];
  rejected: number;
}

// ── Main entry point ────────────────────────────────────────────

export async function computeSessionDiff(
  sessionId: string,
  jsonlPath: string,
): Promise<SessionDiffResult> {
  const historyDir = getHistoryDir(sessionId);
  const rejected = await countRejectedChanges(jsonlPath);

  // Step 1: Net diffs from file-history (existing files edited 2+ times)
  const historyDiffs = new Map<string, NetFileDiff>(); // filePath → diff
  if (fs.existsSync(historyDir)) {
    const hashToPath = await buildHashToPathMap(jsonlPath);
    const versionGroups = scanFileHistory(historyDir);

    for (const [hash, versions] of versionGroups) {
      if (versions.length < 2) continue; // need at least 2 snapshots
      const filePath = hashToPath.get(hash);
      if (!filePath) continue;

      versions.sort((a, b) => a - b);
      const oldFile = path.join(historyDir, `${hash}@v${versions[0]}`);
      const newFile = path.join(historyDir, `${hash}@v${versions[versions.length - 1]}`);

      const oldContent = fs.readFileSync(oldFile, "utf-8");
      const newContent = fs.readFileSync(newFile, "utf-8");
      if (oldContent === newContent) continue;

      const { text, added, removed } = unifiedDiff(oldContent, newContent, filePath);
      if (text) {
        historyDiffs.set(filePath, { filePath, linesAdded: added, linesRemoved: removed, isNew: false, diffText: text });
      }
    }
  }

  // Step 2: New files from Write tool calls (no file-history for these)
  const newFileDiffs = await extractNewFileWrites(jsonlPath, historyDiffs);

  // Combine: file-history diffs + new file diffs
  const diffs = [...historyDiffs.values(), ...newFileDiffs];

  // Step 3: If file-history gave us nothing, full fallback to tool calls
  if (diffs.length === 0) {
    const fallback = await fallbackFromToolCalls(jsonlPath);
    return { diffs: fallback, rejected };
  }

  return { diffs, rejected };
}

// ── New file detection from Write tool calls ────────────────────

async function extractNewFileWrites(
  jsonlPath: string,
  alreadyCovered: Map<string, NetFileDiff>,
): Promise<NetFileDiff[]> {
  // Find Write tool calls that created new files not covered by file-history
  const writes = new Map<string, string>(); // filePath → last content written
  const writeIds = new Map<string, string>(); // toolUseId → filePath
  const rejected = new Set<string>(); // rejected toolUseIds

  for await (const record of parseJsonl(jsonlPath)) {
    if (record.type === "assistant") {
      const content = record.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b.type === "tool_use" && b.name === "Write" && b.input) {
          const input = b.input as Record<string, unknown>;
          if (input.file_path && input.content != null) {
            writeIds.set(String(b.id), String(input.file_path));
          }
        }
      }
    } else if (record.type === "user") {
      const content = record.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b.type === "tool_result" && b.tool_use_id) {
          const id = String(b.tool_use_id);
          if (b.is_error === true) {
            rejected.add(id);
          } else if (writeIds.has(id)) {
            // Successful write — we need to re-read the JSONL to get content
            // For now, mark the file path as needing content
            writes.set(writeIds.get(id)!, "");
          }
        }
      }
    }
  }

  // Second pass to get actual content of successful writes
  const fileContents = new Map<string, string>();
  for await (const record of parseJsonl(jsonlPath)) {
    if (record.type !== "assistant") continue;
    const content = record.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const b = block as Record<string, unknown>;
      if (b.type === "tool_use" && b.name === "Write" && b.input) {
        const input = b.input as Record<string, unknown>;
        const fp = String(input.file_path || "");
        const id = String(b.id);
        if (writes.has(fp) && !rejected.has(id)) {
          fileContents.set(fp, String(input.content || ""));
        }
      }
    }
  }

  const diffs: NetFileDiff[] = [];
  for (const [filePath, content] of fileContents) {
    // Skip files already covered by file-history
    if (alreadyCovered.has(filePath)) continue;
    if (!content) continue;

    const lines = content.split("\n").length;
    diffs.push({
      filePath,
      linesAdded: lines,
      linesRemoved: 0,
      isNew: true,
      diffText: formatNewFile(filePath, content),
    });
  }

  return diffs;
}

// ── Full fallback: per-edit when no file-history exists ─────────

async function fallbackFromToolCalls(jsonlPath: string): Promise<NetFileDiff[]> {
  const toolUses = new Map<string, { name: string; input: Record<string, unknown> }>();
  const toolResults = new Map<string, boolean>();

  for await (const record of parseJsonl(jsonlPath)) {
    if (record.type === "assistant") {
      const content = record.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b.type === "tool_use" && (b.name === "Edit" || b.name === "Write") && b.input) {
          const input = b.input as Record<string, unknown>;
          if (input.file_path) {
            toolUses.set(String(b.id), { name: String(b.name), input });
          }
        }
      }
    } else if (record.type === "user") {
      const content = record.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b.type === "tool_result" && b.tool_use_id) {
          toolResults.set(String(b.tool_use_id), b.is_error !== true);
        }
      }
    }
  }

  const byFile = new Map<string, { name: string; input: Record<string, unknown> }[]>();
  for (const [id, tu] of toolUses) {
    if (!(toolResults.get(id) ?? true)) continue;
    const fp = String(tu.input.file_path);
    const arr = byFile.get(fp) || [];
    arr.push(tu);
    byFile.set(fp, arr);
  }

  const diffs: NetFileDiff[] = [];
  for (const [filePath, changes] of byFile) {
    const lines: string[] = [];
    let added = 0;
    let removed = 0;

    for (const c of changes) {
      if (c.name === "Write") {
        const content = String(c.input.content || "");
        lines.push(`\x1b[1m+++ b/${filePath}\x1b[0m  \x1b[2m(write)\x1b[0m`);
        const cl = content.split("\n");
        for (const l of cl.slice(0, 50)) lines.push(`\x1b[32m+${l}\x1b[0m`);
        if (cl.length > 50) lines.push(`\x1b[2m  ... ${cl.length - 50} more lines\x1b[0m`);
        lines.push("");
        added += cl.length;
      } else {
        const old = String(c.input.old_string || "");
        const nw = String(c.input.new_string || "");
        lines.push(`\x1b[1m--- a/${filePath}\x1b[0m`);
        lines.push(`\x1b[1m+++ b/${filePath}\x1b[0m`);
        for (const l of old.split("\n")) { lines.push(`\x1b[31m-${l}\x1b[0m`); removed++; }
        for (const l of nw.split("\n")) { lines.push(`\x1b[32m+${l}\x1b[0m`); added++; }
        lines.push("");
      }
    }

    diffs.push({ filePath, linesAdded: added, linesRemoved: removed, isNew: false, diffText: lines.join("\n") });
  }

  return diffs;
}

// ── Diff helpers ────────────────────────────────────────────────

function unifiedDiff(
  oldContent: string,
  newContent: string,
  filePath: string,
): { text: string; added: number; removed: number } {
  const tmpOld = path.join(os.tmpdir(), `ggt-old-${process.pid}-${Date.now()}`);
  const tmpNew = path.join(os.tmpdir(), `ggt-new-${process.pid}-${Date.now()}`);

  fs.writeFileSync(tmpOld, oldContent);
  fs.writeFileSync(tmpNew, newContent);

  let rawDiff: string;
  try {
    rawDiff = execSync(`diff -u "${tmpOld}" "${tmpNew}"`, { encoding: "utf-8" });
    rawDiff = "";
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string };
    rawDiff = err.status === 1 ? (err.stdout || "") : "";
  } finally {
    try { fs.unlinkSync(tmpOld); } catch { /* */ }
    try { fs.unlinkSync(tmpNew); } catch { /* */ }
  }

  if (!rawDiff) return { text: "", added: 0, removed: 0 };

  let added = 0;
  let removed = 0;
  const colored: string[] = [];

  for (const [i, line] of rawDiff.split("\n").entries()) {
    if (i === 0 && line.startsWith("---")) {
      colored.push(`\x1b[1m--- a/${filePath}\x1b[0m`);
    } else if (i === 1 && line.startsWith("+++")) {
      colored.push(`\x1b[1m+++ b/${filePath}\x1b[0m`);
    } else if (line.startsWith("@@")) {
      colored.push(`\x1b[36m${line}\x1b[0m`);
    } else if (line.startsWith("-")) {
      removed++;
      colored.push(`\x1b[31m${line}\x1b[0m`);
    } else if (line.startsWith("+")) {
      added++;
      colored.push(`\x1b[32m${line}\x1b[0m`);
    } else {
      colored.push(line);
    }
  }

  return { text: colored.join("\n"), added, removed };
}

function formatNewFile(filePath: string, content: string): string {
  const lines: string[] = [];
  lines.push(`\x1b[1m+++ b/${filePath}\x1b[0m  \x1b[2m(new)\x1b[0m`);
  const contentLines = content.split("\n");
  for (const l of contentLines.slice(0, 50)) {
    lines.push(`\x1b[32m+${l}\x1b[0m`);
  }
  if (contentLines.length > 50) {
    lines.push(`\x1b[2m  ... ${contentLines.length - 50} more lines\x1b[0m`);
  }
  return lines.join("\n");
}

// ── Rejected change counter ─────────────────────────────────────

async function countRejectedChanges(jsonlPath: string): Promise<number> {
  const editWriteIds = new Set<string>();
  let rejected = 0;

  for await (const record of parseJsonl(jsonlPath)) {
    if (record.type === "assistant") {
      const content = record.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b.type === "tool_use" && (b.name === "Edit" || b.name === "Write")) {
          editWriteIds.add(String(b.id));
        }
      }
    } else if (record.type === "user") {
      const content = record.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b.type === "tool_result" && b.is_error === true && editWriteIds.has(String(b.tool_use_id))) {
          rejected++;
        }
      }
    }
  }

  return rejected;
}

// ── Stat formatting ─────────────────────────────────────────────

export function formatStat(diffs: NetFileDiff[]): string {
  if (diffs.length === 0) return "No file changes in this session.";

  const lines: string[] = [];
  let totalAdded = 0;
  let totalRemoved = 0;

  const maxPath = Math.min(60, Math.max(...diffs.map((d) => d.filePath.length)));

  for (const d of diffs) {
    const p = d.filePath.length > 60 ? "..." + d.filePath.slice(d.filePath.length - 57) : d.filePath;
    const padded = p.padEnd(maxPath + 2);
    const total = d.linesAdded + d.linesRemoved;
    const barLen = Math.min(total, 40);
    const addBar = total > 0 ? Math.round((d.linesAdded / total) * barLen) : 0;
    const remBar = barLen - addBar;
    const bar = `\x1b[32m${"+".repeat(addBar)}\x1b[31m${"-".repeat(remBar)}\x1b[0m`;
    const label = d.isNew ? "(new)" : "";
    lines.push(` ${padded} | ${String(total).padStart(4)} ${bar} ${label}`);
    totalAdded += d.linesAdded;
    totalRemoved += d.linesRemoved;
  }

  lines.push("");
  lines.push(
    ` ${diffs.length} file${diffs.length > 1 ? "s" : ""} changed, ` +
      `\x1b[32m${totalAdded} insertion${totalAdded !== 1 ? "s" : ""}(+)\x1b[0m, ` +
      `\x1b[31m${totalRemoved} deletion${totalRemoved !== 1 ? "s" : ""}(-)\x1b[0m`,
  );

  return lines.join("\n");
}
