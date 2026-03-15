import fs from "fs";
import path from "path";
import { getDb } from "./db";
import { claudePaths } from "./claude-paths";
import { parseJsonl, type JsonlRecord } from "./parsers/jsonl";

interface SessionsIndexEntry {
  sessionId: string;
  fullPath?: string;
  fileMtime?: number;
  firstPrompt?: string;
  summary?: string;
  messageCount?: number;
  created?: string;
  modified?: string;
  gitBranch?: string;
  projectPath?: string;
  isSidechain?: boolean;
}

interface SessionsIndex {
  version: number;
  originalPath?: string;
  entries: SessionsIndexEntry[];
}

export interface SyncResult {
  projectsScanned: number;
  sessionsIndexed: number;
  messagesIndexed: number;
  toolCallsIndexed: number;
  durationMs: number;
}

/** Full sync: scan all projects and index sessions */
export async function syncAll(): Promise<SyncResult> {
  const start = Date.now();
  const db = getDb();
  let sessionsIndexed = 0;
  let messagesIndexed = 0;
  let toolCallsIndexed = 0;

  const projectsDir = claudePaths.projects;
  if (!fs.existsSync(projectsDir)) {
    return { projectsScanned: 0, sessionsIndexed: 0, messagesIndexed: 0, toolCallsIndexed: 0, durationMs: 0 };
  }

  const projectFolders = fs.readdirSync(projectsDir).filter((f) => {
    return fs.statSync(path.join(projectsDir, f)).isDirectory();
  });

  // Upsert projects
  const upsertProject = db.prepare(`
    INSERT INTO projects (id, original_path, name) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET original_path = excluded.original_path, name = excluded.name
  `);

  // Process each project
  for (const folder of projectFolders) {
    const projectDir = path.join(projectsDir, folder);

    // Try sessions-index.json first for authoritative metadata
    const indexPath = claudePaths.sessionsIndex(folder);
    const indexEntries: Map<string, SessionsIndexEntry> = new Map();
    let authorativePath: string | null = null;
    if (fs.existsSync(indexPath)) {
      try {
        const index: SessionsIndex = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
        authorativePath = index.originalPath || null;
        for (const entry of index.entries) {
          indexEntries.set(entry.sessionId, entry);
        }
      } catch {
        // ignore malformed index
      }
    }

    // Use authoritative path from sessions-index.json, fall back to lossy decode
    const originalPath = authorativePath || claudePaths.decodeFolderName(folder);
    const projectName = path.basename(originalPath);
    upsertProject.run(folder, originalPath, projectName);

    // Find all JSONL files
    const jsonlFiles = fs.readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));

    for (const jsonlFile of jsonlFiles) {
      const sessionId = jsonlFile.replace(".jsonl", "");
      const jsonlPath = path.join(projectDir, jsonlFile);
      const stat = fs.statSync(jsonlPath);
      const mtime = stat.mtimeMs;

      // Check if already indexed with same mtime (incremental)
      const existing = db
        .prepare("SELECT jsonl_mtime FROM sessions WHERE id = ?")
        .get(sessionId) as { jsonl_mtime: number } | undefined;

      if (existing && existing.jsonl_mtime === mtime) {
        continue; // Already up to date
      }

      // Parse and index this session
      const result = await indexSession(db, folder, sessionId, jsonlPath, mtime, indexEntries.get(sessionId));
      sessionsIndexed++;
      messagesIndexed += result.messages;
      toolCallsIndexed += result.toolCalls;
    }

    // Update project session count
    const count = db.prepare("SELECT COUNT(*) as c FROM sessions WHERE project_id = ?").get(folder) as { c: number };
    const lastSession = db
      .prepare("SELECT modified_at FROM sessions WHERE project_id = ? ORDER BY modified_at DESC LIMIT 1")
      .get(folder) as { modified_at: string } | undefined;

    db.prepare("UPDATE projects SET session_count = ?, last_activity = ? WHERE id = ?").run(
      count.c,
      lastSession?.modified_at || null,
      folder
    );
  }

  // Sync stats-cache into daily_stats
  syncStatsCache(db);

  return {
    projectsScanned: projectFolders.length,
    sessionsIndexed,
    messagesIndexed,
    toolCallsIndexed,
    durationMs: Date.now() - start,
  };
}

async function indexSession(
  db: ReturnType<typeof getDb>,
  projectId: string,
  sessionId: string,
  jsonlPath: string,
  mtime: number,
  indexEntry?: SessionsIndexEntry
): Promise<{ messages: number; toolCalls: number }> {
  // Parse all records FIRST, before touching the database
  const allRecords: JsonlRecord[] = [];
  for await (const record of parseJsonl(jsonlPath)) {
    allRecords.push(record);
  }

  // Pre-compute all metadata from parsed records
  let messageCount = 0;
  let toolCallCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheCreationTokens = 0;
  let compressionCount = 0;
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  let firstPrompt: string | null = indexEntry?.firstPrompt || null;
  const modelCounts: Record<string, number> = {};
  let seq = 0;

  // Pre-scan records to compute metadata
  for (const record of allRecords) {
    if (!record.type || record.type === "file-history-snapshot" || record.type === "last-prompt") continue;
    const timestamp = record.timestamp || null;
    if (timestamp) {
      if (!firstTimestamp) firstTimestamp = timestamp;
      lastTimestamp = timestamp;
    }
    if (record.type === "user") {
      messageCount++;
      if (!firstPrompt && record.message?.content) {
        const content = record.message.content;
        if (typeof content === "string") {
          firstPrompt = content.slice(0, 200);
        } else if (Array.isArray(content)) {
          const textBlock = content.find((b: { type: string }) => b.type === "text");
          if (textBlock && "text" in textBlock) {
            firstPrompt = (textBlock as { text: string }).text.slice(0, 200);
          }
        }
      }
    } else if (record.type === "assistant") {
      messageCount++;
      const usage = record.message?.usage;
      totalInputTokens += usage?.input_tokens || 0;
      totalOutputTokens += usage?.output_tokens || 0;
      totalCacheReadTokens += usage?.cache_read_input_tokens || 0;
      totalCacheCreationTokens += usage?.cache_creation_input_tokens || 0;
      const model = record.message?.model || null;
      if (model) modelCounts[model] = (modelCounts[model] || 0) + 1;
      if (Array.isArray(record.message?.content)) {
        for (const block of record.message!.content as { type: string }[]) {
          if (block.type === "tool_use") toolCallCount++;
        }
      }
    } else if (record.type === "system") {
      if (record.subtype === "compact" || record.compactMetadata) compressionCount++;
    }
  }

  let primaryModel: string | null = null;
  if (Object.keys(modelCounts).length > 0) {
    primaryModel = Object.entries(modelCounts).sort((a, b) => b[1] - a[1])[0][0];
  }
  let durationMs: number | null = null;
  if (firstTimestamp && lastTimestamp) {
    durationMs = new Date(lastTimestamp).getTime() - new Date(firstTimestamp).getTime();
  }

  // Now do all DB writes in a single atomic transaction
  const atomicReindex = db.transaction(() => {
    // 1. Clear old data
    db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);

    // 2. Insert complete session row
    db.prepare(`
      INSERT INTO sessions (id, project_id, first_prompt, summary, message_count, created_at, modified_at,
        git_branch, duration_ms, total_input_tokens, total_output_tokens, total_cache_read_tokens,
        total_cache_creation_tokens, model_used, tool_call_count, compression_count, jsonl_path, jsonl_mtime, is_sidechain)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId, projectId,
      firstPrompt || null, indexEntry?.summary || null, messageCount,
      indexEntry?.created || firstTimestamp, indexEntry?.modified || lastTimestamp,
      indexEntry?.gitBranch || null, durationMs,
      totalInputTokens, totalOutputTokens, totalCacheReadTokens, totalCacheCreationTokens,
      primaryModel, toolCallCount, compressionCount, jsonlPath, mtime,
      indexEntry?.isSidechain ? 1 : 0
    );

    // 3. Insert messages and tool calls
    const insertMessage = db.prepare(`
      INSERT OR IGNORE INTO messages (uuid, session_id, parent_uuid, type, timestamp, model,
        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, tool_names, has_thinking, seq)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertToolCall = db.prepare(`
      INSERT OR IGNORE INTO tool_calls (id, message_uuid, session_id, tool_name, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);

    seq = 0;
    for (const record of allRecords) {
      if (!record.type || record.type === "file-history-snapshot" || record.type === "last-prompt") continue;
      const uuid = record.uuid || `${sessionId}-${seq}`;
      const timestamp = record.timestamp || null;

      if (record.type === "user") {
        seq++;
        insertMessage.run(uuid, sessionId, record.parentUuid || null, "user", timestamp, null, 0, 0, 0, 0, null, 0, seq);
      } else if (record.type === "assistant") {
        seq++;
        const usage = record.message?.usage;
        const content = record.message?.content;
        const toolNames: string[] = [];
        let hasThinking = false;

        if (Array.isArray(content)) {
          for (const block of content) {
            const b = block as { type: string; name?: string; id?: string };
            if (b.type === "tool_use" && b.name) {
              toolNames.push(b.name);
              insertToolCall.run(b.id || `tc-${sessionId}-${seq}-${toolNames.length}`, uuid, sessionId, b.name, timestamp);
            }
            if (b.type === "thinking") hasThinking = true;
          }
        }

        insertMessage.run(
          uuid, sessionId, record.parentUuid || null, "assistant", timestamp,
          record.message?.model || null,
          usage?.input_tokens || 0, usage?.output_tokens || 0,
          usage?.cache_read_input_tokens || 0, usage?.cache_creation_input_tokens || 0,
          toolNames.length > 0 ? JSON.stringify(toolNames) : null,
          hasThinking ? 1 : 0, seq
        );
      } else if (record.type === "system") {
        seq++;
        insertMessage.run(uuid, sessionId, record.parentUuid || null, "system", timestamp, null, 0, 0, 0, 0, null, 0, seq);
      }
    }
  });

  atomicReindex();

  return { messages: messageCount, toolCalls: toolCallCount };
}

function syncStatsCache(db: ReturnType<typeof getDb>) {
  const statsPath = claudePaths.statsCache;
  if (!fs.existsSync(statsPath)) return;

  try {
    const stats = JSON.parse(fs.readFileSync(statsPath, "utf-8"));
    if (!stats.dailyActivity) return;

    const upsert = db.prepare(`
      INSERT INTO daily_stats (date, message_count, session_count, tool_call_count, tokens_by_model)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        message_count = excluded.message_count,
        session_count = excluded.session_count,
        tool_call_count = excluded.tool_call_count,
        tokens_by_model = excluded.tokens_by_model
    `);

    const tokensByDate: Record<string, Record<string, number>> = {};
    if (stats.dailyModelTokens) {
      for (const entry of stats.dailyModelTokens) {
        tokensByDate[entry.date] = entry.tokensByModel;
      }
    }

    const insertAll = db.transaction(() => {
      for (const day of stats.dailyActivity) {
        upsert.run(
          day.date,
          day.messageCount,
          day.sessionCount,
          day.toolCallCount,
          JSON.stringify(tokensByDate[day.date] || {})
        );
      }
    });
    insertAll();
  } catch {
    // ignore
  }
}
