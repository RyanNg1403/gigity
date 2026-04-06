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
