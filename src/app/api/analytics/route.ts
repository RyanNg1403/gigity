import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

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
    .all();

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
    .get();

  // Project leaderboard
  const projectStats = db
    .prepare(`
      SELECT p.name, p.id, p.original_path, COUNT(s.id) as session_count,
        SUM(s.message_count) as total_messages,
        SUM(s.tool_call_count) as total_tool_calls,
        SUM(s.total_input_tokens) as total_input_tokens,
        SUM(s.total_output_tokens) as total_output_tokens,
        SUM(s.total_cache_read_tokens) as total_cache_read_tokens
      FROM projects p LEFT JOIN sessions s ON p.id = s.project_id
      GROUP BY p.id ORDER BY session_count DESC
    `)
    .all();

  return NextResponse.json({
    dailyStats: dailyStats.reverse(),
    modelUsage,
    topTools,
    hourlyActivity,
    branchActivity,
    totals,
    projectStats,
  });
}
