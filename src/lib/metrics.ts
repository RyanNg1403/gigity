import type Database from "better-sqlite3";

const METRICS_VERSION = 1;

interface TurnRow {
  turn_number: number;
  user_text: string;
  tool_call_count: number;
  tool_error_count: number;
  has_thinking: number;
  output_tokens: number;
}

interface EventRow {
  turn_number: number;
  event_type: string;
}

function scorePromptSpecificity(text: string): number {
  if (!text || text.trim().length === 0) return 0;
  const words = text.trim().split(/\s+/).length;
  // Word count score: 0-1 scale, 30+ words = 1.0
  let score = Math.min(words / 30, 1.0);
  // Bonus for code blocks
  if (/```/.test(text)) score += 0.15;
  // Bonus for file paths
  if (/[\/\\]\w+\.\w+/.test(text) || /src\//.test(text)) score += 0.1;
  // Bonus for bullet/numbered lists
  if (/^[\s]*[-*]\s/m.test(text) || /^[\s]*\d+[.)]\s/m.test(text)) score += 0.1;
  return Math.min(score, 1.0);
}

export function computeMetrics(db: Database.Database, sessionId: string): void {
  const turns = db.prepare(
    "SELECT turn_number, user_text, tool_call_count, tool_error_count, has_thinking, output_tokens FROM session_turns WHERE session_id = ? ORDER BY turn_number"
  ).all(sessionId) as TurnRow[];

  const events = db.prepare(
    "SELECT turn_number, event_type FROM turn_events WHERE session_id = ? ORDER BY turn_number"
  ).all(sessionId) as EventRow[];

  const turnCount = turns.length;
  if (turnCount === 0) return;

  // Build event map: turn_number -> primary event type (first non-error_loop event)
  const turnPrimaryEvent = new Map<number, string>();
  for (const e of events) {
    if (e.event_type !== "error_loop" && !turnPrimaryEvent.has(e.turn_number)) {
      turnPrimaryEvent.set(e.turn_number, e.event_type);
    }
  }

  let successCount = 0;
  let interruptionCount = 0;
  let correctionCount = 0;
  for (const [, eventType] of turnPrimaryEvent) {
    if (eventType === "success") successCount++;
    else if (eventType === "interruption") interruptionCount++;
    else if (eventType === "correction") correctionCount++;
  }

  const firstAttemptSuccessRate = successCount / turnCount;
  const interruptionRate = interruptionCount / turnCount;
  const correctionRate = correctionCount / turnCount;

  // Tool error rate
  const totalToolCalls = turns.reduce((s, t) => s + t.tool_call_count, 0);
  const totalToolErrors = turns.reduce((s, t) => s + t.tool_error_count, 0);
  const toolErrorRate = totalToolCalls > 0 ? totalToolErrors / totalToolCalls : 0;

  // Token efficiency
  const totalOutputTokens = turns.reduce((s, t) => s + t.output_tokens, 0);
  const tokenEfficiency = totalOutputTokens / turnCount;

  // Prompt specificity (first turn)
  const promptSpecificity = scorePromptSpecificity(turns[0]?.user_text || "");

  // Error loop count
  const errorLoopCount = events.filter((e) => e.event_type === "error_loop").length;

  // Thinking effectiveness
  const thinkingTurns = turns.filter((t) => t.has_thinking === 1);
  const nonThinkingTurns = turns.filter((t) => t.has_thinking === 0);
  let thinkingEffectiveness = 0;
  if (thinkingTurns.length > 0 && nonThinkingTurns.length > 0) {
    const thinkingSuccess = thinkingTurns.filter((t) => turnPrimaryEvent.get(t.turn_number) === "success").length / thinkingTurns.length;
    const nonThinkingSuccess = nonThinkingTurns.filter((t) => turnPrimaryEvent.get(t.turn_number) === "success").length / nonThinkingTurns.length;
    thinkingEffectiveness = thinkingSuccess - nonThinkingSuccess;
  }

  // Momentum: compare first quartile vs last quartile success rates
  let momentum: "accelerating" | "decelerating" | "stable" = "stable";
  if (turnCount >= 4) {
    const q = Math.ceil(turnCount / 4);
    const firstQ = turns.slice(0, q);
    const lastQ = turns.slice(-q);
    const firstQSuccess = firstQ.filter((t) => turnPrimaryEvent.get(t.turn_number) === "success").length / firstQ.length;
    const lastQSuccess = lastQ.filter((t) => turnPrimaryEvent.get(t.turn_number) === "success").length / lastQ.length;
    const delta = lastQSuccess - firstQSuccess;
    if (delta > 0.1) momentum = "accelerating";
    else if (delta < -0.1) momentum = "decelerating";
  }

  // Overall score
  const overallScore = Math.min(100, Math.max(0,
    firstAttemptSuccessRate * 35 +
    (1 - interruptionRate) * 15 +
    (1 - correctionRate) * 15 +
    (1 - toolErrorRate) * 15 +
    promptSpecificity * 10 +
    (errorLoopCount === 0 ? 10 : Math.max(0, 10 - errorLoopCount * 3))
  ));

  // Get jsonl_mtime from sessions table
  const session = db.prepare("SELECT jsonl_mtime FROM sessions WHERE id = ?").get(sessionId) as { jsonl_mtime: number } | undefined;

  db.prepare(`
    INSERT OR REPLACE INTO session_metrics (
      session_id, metrics_version, jsonl_mtime, turn_count,
      first_attempt_success_rate, interruption_rate, correction_rate,
      tool_error_rate, token_efficiency, prompt_specificity,
      error_loop_count, thinking_effectiveness, momentum,
      overall_score, computed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId, METRICS_VERSION, session?.jsonl_mtime || 0, turnCount,
    firstAttemptSuccessRate, interruptionRate, correctionRate,
    toolErrorRate, tokenEfficiency, promptSpecificity,
    errorLoopCount, thinkingEffectiveness, momentum,
    overallScore, new Date().toISOString()
  );
}

export function computeAllStaleMetrics(db: Database.Database): number {
  // Find sessions needing metrics computation
  const staleSessions = db.prepare(`
    SELECT s.id FROM sessions s
    LEFT JOIN session_metrics m ON s.id = m.session_id
    WHERE m.session_id IS NULL
      OR m.jsonl_mtime != s.jsonl_mtime
      OR m.metrics_version < ?
  `).all(METRICS_VERSION) as { id: string }[];

  for (const { id } of staleSessions) {
    computeMetrics(db, id);
  }

  return staleSessions.length;
}
