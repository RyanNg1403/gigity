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

    // Find all JSONL files
    const jsonlFiles = fs.readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));

    // If no authoritative path, extract cwd from JSONL records
    if (!authorativePath && jsonlFiles.length > 0) {
      for (const jf of jsonlFiles) {
        if (authorativePath) break;
        try {
          const firstLines = fs.readFileSync(path.join(projectDir, jf), "utf-8").split("\n").slice(0, 30);
          for (const line of firstLines) {
            if (!line.trim()) continue;
            const rec = JSON.parse(line);
            if (rec.cwd) {
              authorativePath = rec.cwd;
              break;
            }
          }
        } catch { /* ignore */ }
      }
    }

    const originalPath = authorativePath || folder;
    const projectName = authorativePath ? path.basename(authorativePath) : folder;
    upsertProject.run(folder, originalPath, projectName);

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

  // Turn extraction types
  interface TurnData {
    turnNumber: number;
    userUuid: string | null;
    userTimestamp: string | null;
    userText: string;
    assistantCount: number;
    toolCallCount: number;
    toolErrorCount: number;
    hasThinking: boolean;
    outputTokens: number;
    contextTokens: number;
    hasInterruption: boolean;
    toolErrorSequences: { toolName: string; count: number }[];
  }

  interface TurnEvent {
    turnNumber: number;
    eventType: string;
    matchedRule: string;
    tokensWasted: number;
  }

  const turns: TurnData[] = [];
  let currentTurn: TurnData | null = null;
  // Track consecutive tool errors within a turn
  let lastToolName: string | null = null;
  let consecutiveErrors = 0;

  function extractUserText(content: unknown): string {
    if (!content) return "";
    if (typeof content === "string") return content.slice(0, 500);
    if (Array.isArray(content)) {
      const textParts: string[] = [];
      for (const b of content) {
        if ((b as { type: string }).type === "text" && (b as { text?: string }).text) {
          textParts.push((b as { text: string }).text);
        }
      }
      return textParts.join(" ").slice(0, 500);
    }
    return "";
  }

  function isToolResultOnlyContent(content: unknown): boolean {
    if (!content || typeof content === "string") return false;
    if (Array.isArray(content)) {
      return content.every((b: { type: string }) => b.type === "tool_result");
    }
    return false;
  }

  // Pre-scan records to compute metadata + extract turns
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

      // Turn extraction: tool-result-only messages belong to current turn
      const content = record.message?.content;
      if (isToolResultOnlyContent(content)) {
        // Check for tool errors in tool results
        if (currentTurn && Array.isArray(content)) {
          for (const block of content) {
            const b = block as { type: string; is_error?: boolean; tool_use_id?: string };
            if (b.type === "tool_result" && b.is_error) {
              currentTurn.toolErrorCount++;
            }
          }
        }
      } else {
        // Real user message — starts a new turn
        if (currentTurn) turns.push(currentTurn);
        currentTurn = {
          turnNumber: turns.length,
          userUuid: record.uuid || null,
          userTimestamp: timestamp,
          userText: extractUserText(content),
          assistantCount: 0,
          toolCallCount: 0,
          toolErrorCount: 0,
          hasThinking: false,
          outputTokens: 0,
          contextTokens: 0,
          hasInterruption: false,
          toolErrorSequences: [],
        };
        lastToolName = null;
        consecutiveErrors = 0;

        // Check for interruption marker
        const userText = extractUserText(content);
        if (userText.includes("[Request interrupted by user")) {
          currentTurn.hasInterruption = true;
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

      if (currentTurn) {
        currentTurn.assistantCount++;
        currentTurn.outputTokens += usage?.output_tokens || 0;
        currentTurn.contextTokens += (usage?.input_tokens || 0) + (usage?.cache_read_input_tokens || 0) + (usage?.cache_creation_input_tokens || 0);
      }

      if (Array.isArray(record.message?.content)) {
        for (const block of record.message!.content as { type: string; name?: string; is_error?: boolean }[]) {
          if (block.type === "tool_use") {
            toolCallCount++;
            if (currentTurn) {
              currentTurn.toolCallCount++;
              // Track consecutive errors for error loop detection
              if (block.name) {
                if (block.name === lastToolName) {
                  // Same tool — will check error status from tool_result
                } else {
                  // Different tool — reset streak
                  if (lastToolName && consecutiveErrors >= 3) {
                    currentTurn.toolErrorSequences.push({ toolName: lastToolName, count: consecutiveErrors });
                  }
                  lastToolName = block.name;
                  consecutiveErrors = 0;
                }
              }
            }
          }
          if (block.type === "thinking" && currentTurn) {
            currentTurn.hasThinking = true;
          }
        }
      }
    } else if (record.type === "system") {
      if (record.subtype === "compact" || record.compactMetadata) compressionCount++;
    }
  }
  // Push last turn
  if (currentTurn) turns.push(currentTurn);

  // Error loop detection: scan tool_result records to count consecutive errors per tool
  // We need a second pass to properly track error sequences
  {
    let currentTurnIdx = -1;
    let errToolName: string | null = null;
    let errCount = 0;
    const errorLoops: { turnIdx: number; toolName: string; count: number }[] = [];

    for (const record of allRecords) {
      if (!record.type || record.type === "file-history-snapshot" || record.type === "last-prompt") continue;

      if (record.type === "user" && !isToolResultOnlyContent(record.message?.content)) {
        // Flush previous error streak
        if (errToolName && errCount >= 3 && currentTurnIdx >= 0) {
          errorLoops.push({ turnIdx: currentTurnIdx, toolName: errToolName, count: errCount });
        }
        currentTurnIdx++;
        errToolName = null;
        errCount = 0;
      } else if (record.type === "user" && isToolResultOnlyContent(record.message?.content)) {
        // Check tool results for errors
        if (Array.isArray(record.message?.content)) {
          for (const block of record.message!.content as { type: string; is_error?: boolean }[]) {
            if (block.type === "tool_result" && block.is_error) {
              errCount++;
            }
          }
        }
      } else if (record.type === "assistant" && Array.isArray(record.message?.content)) {
        for (const block of record.message!.content as { type: string; name?: string }[]) {
          if (block.type === "tool_use" && block.name) {
            if (block.name !== errToolName) {
              // Different tool — flush streak
              if (errToolName && errCount >= 3 && currentTurnIdx >= 0) {
                errorLoops.push({ turnIdx: currentTurnIdx, toolName: errToolName, count: errCount });
              }
              errToolName = block.name;
              errCount = 0;
            }
          }
        }
      }
    }
    // Flush final
    if (errToolName && errCount >= 3 && currentTurnIdx >= 0) {
      errorLoops.push({ turnIdx: currentTurnIdx, toolName: errToolName, count: errCount });
    }

    // Attach error loops to turns
    for (const loop of errorLoops) {
      if (loop.turnIdx < turns.length) {
        turns[loop.turnIdx].toolErrorSequences.push({ toolName: loop.toolName, count: loop.count });
      }
    }
  }

  // Build turn events
  const correctionPatterns = [
    { regex: /^no[,.\s]/i, rule: "pattern:no" },
    { regex: /^don't/i, rule: "pattern:don't" },
    { regex: /^stop/i, rule: "pattern:stop" },
    { regex: /^wrong/i, rule: "pattern:wrong" },
    { regex: /^that's not/i, rule: "pattern:that's not" },
    { regex: /^not what I/i, rule: "pattern:not what I" },
    { regex: /^actually[,.\s]/i, rule: "pattern:actually" },
    { regex: /^instead[,.\s]/i, rule: "pattern:instead" },
    { regex: /^try again/i, rule: "pattern:try again" },
    { regex: /^redo/i, rule: "pattern:redo" },
    { regex: /^revert/i, rule: "pattern:revert" },
    { regex: /^undo/i, rule: "pattern:undo" },
  ];

  const turnEvents: TurnEvent[] = [];

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];

    // Check for interruption
    if (turn.hasInterruption) {
      turnEvents.push({ turnNumber: i, eventType: "interruption", matchedRule: "interrupt", tokensWasted: turn.outputTokens });
      continue;
    }

    // Check if next turn is a correction of this one
    let isCorrection = false;
    if (i + 1 < turns.length) {
      const nextText = turns[i + 1].userText.trim();
      for (const pattern of correctionPatterns) {
        if (pattern.regex.test(nextText)) {
          isCorrection = true;
          turnEvents.push({ turnNumber: i, eventType: "correction", matchedRule: pattern.rule, tokensWasted: turn.outputTokens });
          break;
        }
      }
    }

    // Error loops
    for (const seq of turn.toolErrorSequences) {
      turnEvents.push({ turnNumber: i, eventType: "error_loop", matchedRule: `tool:${seq.toolName}:${seq.count}_retries`, tokensWasted: 0 });
    }

    // If no negative event, it's a success
    if (!isCorrection) {
      turnEvents.push({ turnNumber: i, eventType: "success", matchedRule: "", tokensWasted: 0 });
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
    db.prepare("DELETE FROM turn_events WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM session_turns WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM session_metrics WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM sessions_fts WHERE session_id = ?").run(sessionId);
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

    // 3. Populate FTS index
    db.prepare(`
      INSERT INTO sessions_fts (session_id, first_prompt, summary)
      VALUES (?, ?, ?)
    `).run(sessionId, firstPrompt || "", indexEntry?.summary || "");

    // 4. Insert messages and tool calls
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

    // 5. Insert session turns
    const insertTurn = db.prepare(`
      INSERT INTO session_turns (session_id, turn_number, user_uuid, user_timestamp, user_text,
        assistant_count, tool_call_count, tool_error_count, has_thinking, output_tokens, context_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const turn of turns) {
      insertTurn.run(
        sessionId, turn.turnNumber, turn.userUuid, turn.userTimestamp, turn.userText,
        turn.assistantCount, turn.toolCallCount, turn.toolErrorCount,
        turn.hasThinking ? 1 : 0, turn.outputTokens, turn.contextTokens
      );
    }

    // 6. Insert turn events
    const insertEvent = db.prepare(`
      INSERT INTO turn_events (session_id, turn_number, event_type, matched_rule, tokens_wasted)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const event of turnEvents) {
      insertEvent.run(sessionId, event.turnNumber, event.eventType, event.matchedRule, event.tokensWasted);
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
