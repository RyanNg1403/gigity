import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { estimateCost } from "@/lib/cost";

export async function GET() {
  const db = getDb();

  // Daily stats
  const dailyStats = db
    .prepare("SELECT * FROM daily_stats ORDER BY date DESC LIMIT 90")
    .all();

  // Model usage breakdown
  const modelUsage = db
    .prepare(`
      SELECT model_used, COUNT(*) as session_count,
        SUM(total_input_tokens) as input_tokens,
        SUM(total_output_tokens) as output_tokens,
        SUM(total_cache_read_tokens) as cache_read_tokens,
        SUM(total_cache_creation_tokens) as cache_creation_tokens,
        SUM(tool_call_count) as tool_calls
      FROM sessions WHERE model_used IS NOT NULL
      GROUP BY model_used
    `)
    .all() as { model_used: string; session_count: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_creation_tokens: number; tool_calls: number }[];

  // Top tools
  const topTools = db
    .prepare(`
      SELECT tool_name, COUNT(*) as count
      FROM tool_calls
      GROUP BY tool_name
      ORDER BY count DESC
      LIMIT 20
    `)
    .all();

  // Sessions by hour (from session created_at)
  const hourlyActivity = db
    .prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count
      FROM sessions WHERE created_at IS NOT NULL
      GROUP BY hour ORDER BY hour
    `)
    .all();

  // Sessions by git branch
  const branchActivity = db
    .prepare(`
      SELECT git_branch, COUNT(*) as session_count, SUM(message_count) as total_messages
      FROM sessions WHERE git_branch IS NOT NULL AND git_branch != ''
      GROUP BY git_branch ORDER BY session_count DESC LIMIT 15
    `)
    .all();

  // Summary totals
  const totals = db
    .prepare(`
      SELECT COUNT(*) as total_sessions,
        SUM(message_count) as total_messages,
        SUM(tool_call_count) as total_tool_calls,
        SUM(total_output_tokens) as total_output_tokens,
        SUM(total_input_tokens) as total_input_tokens,
        SUM(total_cache_read_tokens) as total_cache_read_tokens,
        SUM(total_cache_creation_tokens) as total_cache_creation_tokens,
        SUM(compression_count) as total_compressions
      FROM sessions
    `)
    .get() as Record<string, number>;

  // Project leaderboard (with cache_creation_tokens for cost calc)
  const projectStats = db
    .prepare(`
      SELECT p.name, p.id, p.original_path, COUNT(s.id) as session_count,
        SUM(s.message_count) as total_messages,
        SUM(s.tool_call_count) as total_tool_calls,
        SUM(s.total_input_tokens) as total_input_tokens,
        SUM(s.total_output_tokens) as total_output_tokens,
        SUM(s.total_cache_read_tokens) as total_cache_read_tokens,
        SUM(s.total_cache_creation_tokens) as total_cache_creation_tokens
      FROM projects p LEFT JOIN sessions s ON p.id = s.project_id
      GROUP BY p.id ORDER BY session_count DESC
    `)
    .all();

  // Compute model costs
  const modelCosts = modelUsage.map((m) => ({
    ...m,
    estimated_cost: estimateCost(
      m.model_used,
      m.input_tokens || 0,
      m.output_tokens || 0,
      m.cache_read_tokens || 0,
      m.cache_creation_tokens || 0
    ),
  }));

  // Total cost
  const totalCost = modelCosts.reduce((sum, m) => sum + m.estimated_cost, 0);

  // Daily token usage from sessions (authoritative, not stats-cache)
  const dailyTokens = db
    .prepare(`
      SELECT DATE(created_at) as date,
        SUM(total_input_tokens + total_output_tokens + total_cache_read_tokens + total_cache_creation_tokens) as tokens,
        SUM(message_count) as messages,
        SUM(tool_call_count) as tools
      FROM sessions WHERE created_at IS NOT NULL
      GROUP BY date ORDER BY date
    `)
    .all() as { date: string; tokens: number; messages: number; tools: number }[];

  // Daily cost trend
  const dailyCostRows = db
    .prepare(`
      SELECT DATE(created_at) as date, model_used,
        SUM(total_input_tokens) as input_tok,
        SUM(total_output_tokens) as output_tok,
        SUM(total_cache_read_tokens) as cache_read_tok,
        SUM(total_cache_creation_tokens) as cache_write_tok
      FROM sessions WHERE created_at IS NOT NULL
      GROUP BY date, model_used ORDER BY date
    `)
    .all() as { date: string; model_used: string; input_tok: number; output_tok: number; cache_read_tok: number; cache_write_tok: number }[];

  // Aggregate daily costs
  const dailyCostMap = new Map<string, number>();
  for (const row of dailyCostRows) {
    const cost = estimateCost(
      row.model_used || "",
      row.input_tok || 0,
      row.output_tok || 0,
      row.cache_read_tok || 0,
      row.cache_write_tok || 0
    );
    dailyCostMap.set(row.date, (dailyCostMap.get(row.date) || 0) + cost);
  }
  const dailyCosts = Array.from(dailyCostMap.entries())
    .map(([date, cost]) => ({ date, cost: Math.round(cost * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Prompt effectiveness aggregates
  const effectivenessAgg = db.prepare(`
    SELECT
      AVG(overall_score) as avg_score,
      AVG(first_attempt_success_rate) as avg_success_rate,
      SUM(error_loop_count) as total_error_loops,
      SUM(CASE WHEN momentum = 'stable' THEN 1 ELSE 0 END) as stable_count,
      SUM(CASE WHEN momentum = 'accelerating' THEN 1 ELSE 0 END) as accelerating_count,
      SUM(CASE WHEN momentum = 'decelerating' THEN 1 ELSE 0 END) as decelerating_count,
      COUNT(*) as total_scored
    FROM session_metrics
  `).get() as Record<string, number> | undefined;

  // Score distribution buckets
  const scoreDistribution = db.prepare(`
    SELECT
      CASE
        WHEN overall_score >= 90 THEN '90-100'
        WHEN overall_score >= 80 THEN '80-89'
        WHEN overall_score >= 70 THEN '70-79'
        WHEN overall_score >= 60 THEN '60-69'
        WHEN overall_score >= 50 THEN '50-59'
        ELSE '<50'
      END as bucket,
      COUNT(*) as count
    FROM session_metrics
    GROUP BY bucket
    ORDER BY bucket DESC
  `).all() as { bucket: string; count: number }[];

  // Daily effectiveness trend
  const dailyEffectiveness = db.prepare(`
    SELECT DATE(computed_at) as date, AVG(overall_score) as avg_score, COUNT(*) as session_count
    FROM session_metrics
    WHERE computed_at IS NOT NULL
    GROUP BY date
    ORDER BY date
  `).all() as { date: string; avg_score: number; session_count: number }[];

  return NextResponse.json({
    dailyStats: dailyStats.reverse(),
    dailyTokens,
    modelUsage: modelCosts,
    topTools,
    hourlyActivity,
    branchActivity,
    totals: { ...totals, total_cost: Math.round(totalCost * 100) / 100 },
    projectStats,
    dailyCosts,
    effectivenessAgg: effectivenessAgg || null,
    scoreDistribution,
    dailyEffectiveness,
  });
}
