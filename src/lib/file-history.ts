import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseJsonl } from "./jsonl.js";

const FILE_HISTORY_DIR = path.join(os.homedir(), ".claude", "file-history");

export interface FileSnapshot {
  filePath: string; // relative path from snapshot records
  hash: string;
  firstVersion: number; // earliest version on disk
  lastVersion: number; // latest version on disk
  historyDir: string;
}

/** Get the file-history directory for a session */
export function getHistoryDir(sessionId: string): string {
  return path.join(FILE_HISTORY_DIR, sessionId);
}

/** Parse JSONL file-history-snapshot records → hash-to-filePath mapping */
export async function buildHashToPathMap(jsonlPath: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  for await (const record of parseJsonl(jsonlPath)) {
    if (record.type !== "file-history-snapshot") continue;
    const snapshot = record.snapshot as
      | { trackedFileBackups?: Record<string, { backupFileName: string | null }> }
      | undefined;
    if (!snapshot?.trackedFileBackups) continue;

    for (const [filePath, info] of Object.entries(snapshot.trackedFileBackups)) {
      if (info.backupFileName) {
        const hash = info.backupFileName.split("@v")[0];
        if (!map.has(hash)) map.set(hash, filePath);
      }
    }
  }

  return map;
}

/** Scan file-history directory, group actual files on disk by hash */
export function scanFileHistory(historyDir: string): Map<string, number[]> {
  const groups = new Map<string, number[]>();

  for (const file of fs.readdirSync(historyDir)) {
    const match = file.match(/^([a-f0-9]+)@v(\d+)$/);
    if (!match) continue;
    const [, hash, vStr] = match;
    const version = parseInt(vStr, 10);
    const arr = groups.get(hash) || [];
    arr.push(version);
    groups.set(hash, arr);
  }

  return groups;
}

/**
 * Get file snapshots for a session: each file's first and last version on disk,
 * mapped to its relative file path from JSONL.
 */
export async function getFileSnapshots(
  sessionId: string,
  jsonlPath: string,
): Promise<FileSnapshot[]> {
  const historyDir = getHistoryDir(sessionId);
  if (!fs.existsSync(historyDir)) return [];

  const hashToPath = await buildHashToPathMap(jsonlPath);
  const versionGroups = scanFileHistory(historyDir);
  const snapshots: FileSnapshot[] = [];

  for (const [hash, versions] of versionGroups) {
    const filePath = hashToPath.get(hash);
    if (!filePath) continue;

    versions.sort((a, b) => a - b);
    snapshots.push({
      filePath,
      hash,
      firstVersion: versions[0],
      lastVersion: versions[versions.length - 1],
      historyDir,
    });
  }

  return snapshots;
}

/** Read a specific snapshot version from disk */
export function readSnapshot(historyDir: string, hash: string, version: number): string | null {
  const filePath = path.join(historyDir, `${hash}@v${version}`);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf-8");
}

// ── Edit context tracing ────────────────────────────────────────

export interface EditContext {
  userPrompt: string | null;
  userTimestamp: string | null;
  claudeIntent: string | null;
}

/**
 * Walk the parentUuid chain from an Edit/Write tool_use message
 * back to the user prompt that triggered it and Claude's intent text.
 */
export function traceEditContext(
  byUuid: Map<string, { type: string; parentUuid?: string; timestamp?: string; message?: { content?: unknown } }>,
  editUuid: string,
): EditContext {
  let claudeIntent: string | null = null;
  let userPrompt: string | null = null;
  let userTimestamp: string | null = null;

  let current = byUuid.get(editUuid);
  let depth = 0;

  while (current && depth < 50) {
    const content = current.message?.content;

    if (current.type === "assistant" && !claudeIntent && Array.isArray(content)) {
      // Find the nearest assistant text block (Claude's intent)
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string" && (b.text as string).length > 10) {
          claudeIntent = (b.text as string).slice(0, 300);
          break;
        }
      }
    }

    if (current.type === "user" && Array.isArray(content)) {
      // Look for a real user text message (not tool_result passthrough)
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") {
          userPrompt = (b.text as string).slice(0, 300);
          userTimestamp = current.timestamp || null;
          return { userPrompt, userTimestamp, claudeIntent };
        }
      }
    } else if (current.type === "user" && typeof content === "string") {
      userPrompt = (content as string).slice(0, 300);
      userTimestamp = current.timestamp || null;
      return { userPrompt, userTimestamp, claudeIntent };
    }

    current = byUuid.get(current.parentUuid || "");
    depth++;
  }

  return { userPrompt, userTimestamp, claudeIntent };
}

/** Build a uuid → record map from a JSONL file for chain walking */
export async function buildUuidMap(
  jsonlPath: string,
): Promise<Map<string, { type: string; parentUuid?: string; timestamp?: string; message?: { content?: unknown } }>> {
  const map = new Map<string, { type: string; parentUuid?: string; timestamp?: string; message?: { content?: unknown } }>();

  for await (const record of parseJsonl(jsonlPath)) {
    if (record.uuid) {
      map.set(record.uuid as string, {
        type: record.type,
        parentUuid: record.parentUuid as string | undefined,
        timestamp: record.timestamp,
        message: record.message,
      });
    }
  }

  return map;
}

/**
 * Find the assistant message UUID that contains an Edit/Write tool_use
 * targeting a specific file path.
 */
export async function findEditUuids(
  jsonlPath: string,
  filePath: string,
): Promise<string[]> {
  const uuids: string[] = [];

  for await (const record of parseJsonl(jsonlPath)) {
    if (record.type !== "assistant") continue;
    const content = record.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      const b = block as Record<string, unknown>;
      if (b.type === "tool_use" && (b.name === "Edit" || b.name === "Write")) {
        const input = b.input as Record<string, unknown> | undefined;
        if (input?.file_path && String(input.file_path).endsWith(filePath)) {
          if (record.uuid) uuids.push(record.uuid as string);
          break;
        }
      }
    }
  }

  return uuids;
}
