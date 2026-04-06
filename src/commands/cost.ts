import { Command, Flags } from "@oclif/core";
import path from "node:path";
import { ensureSynced } from "../lib/auto-sync.js";
import { estimateCost } from "../lib/cost.js";

interface SessionRow {
  id: string;
  model_used: string;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_cache_creation_tokens: number;
  created_at: string;
  project_path: string;
  project_name: string;
}

export default class Cost extends Command {
  static override description = "Show token spend and estimated cost";

  static override examples = [
    "<%= config.bin %> cost",
    "<%= config.bin %> cost --all",
    "<%= config.bin %> cost --by=model",
    "<%= config.bin %> cost --by=day --after=2026-04-01",
    "<%= config.bin %> cost --by=project --all",
    "<%= config.bin %> cost --json",
  ];

  static override flags = {
    project: Flags.string({ description: "Filter by project (substring match)" }),
    all: Flags.boolean({ description: "All projects (default: current project only)" }),
    by: Flags.string({ description: "Group by: model, day, project", options: ["model", "day", "project"] }),
    after: Flags.string({ description: "Sessions after this date (YYYY-MM-DD)" }),
    before: Flags.string({ description: "Sessions before this date (YYYY-MM-DD)" }),
    limit: Flags.integer({ description: "Max sessions for top-sessions view", default: 10 }),
    json: Flags.boolean({ description: "Output as JSON" }),
  };

  async run() {
    const { flags } = await this.parse(Cost);
    const db = await ensureSynced((msg) => this.log(msg));

    // Build query
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (!flags.all) {
      const proj = flags.project
        ? (flags.project === "." || flags.project === "./" ? path.resolve(".") : flags.project)
        : path.resolve(".");
      conditions.push("(p.original_path LIKE ? OR p.name LIKE ?)");
      params.push(`%${proj}%`, `%${proj}%`);
    } else if (flags.project) {
      const proj = flags.project === "." || flags.project === "./"
        ? path.resolve(".")
        : flags.project;
      conditions.push("(p.original_path LIKE ? OR p.name LIKE ?)");
      params.push(`%${proj}%`, `%${proj}%`);
    }

    if (flags.after) {
      conditions.push("s.created_at >= ?");
      params.push(flags.after);
    }
    if (flags.before) {
      conditions.push("s.created_at <= ?");
      params.push(flags.before + "T23:59:59");
    }

    const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

    const rows = db.prepare(`
      SELECT s.id, s.model_used, s.total_input_tokens, s.total_output_tokens,
        s.total_cache_read_tokens, s.total_cache_creation_tokens,
        s.created_at, p.original_path as project_path, p.name as project_name
      FROM sessions s JOIN projects p ON s.project_id = p.id
      ${where}
      ORDER BY s.created_at DESC
    `).all(...params) as SessionRow[];

    if (rows.length === 0) {
      this.log("No sessions found.");
      return;
    }

    // Compute cost for each session
    const enriched = rows.map((r) => ({
      ...r,
      cost: estimateCost(r.model_used || "", r.total_input_tokens, r.total_output_tokens, r.total_cache_read_tokens, r.total_cache_creation_tokens),
    }));

    if (flags.by) {
      this.renderGrouped(enriched, flags.by, flags.json ?? false);
    } else {
      this.renderSummary(enriched, flags.limit, flags.json ?? false);
    }
  }

  private renderSummary(
    rows: (SessionRow & { cost: number })[],
    limit: number,
    json: boolean,
  ) {
    const totalCost = rows.reduce((s, r) => s + r.cost, 0);
    const totalInput = rows.reduce((s, r) => s + r.total_input_tokens, 0);
    const totalOutput = rows.reduce((s, r) => s + r.total_output_tokens, 0);
    const totalCacheRead = rows.reduce((s, r) => s + r.total_cache_read_tokens, 0);
    const totalCacheWrite = rows.reduce((s, r) => s + r.total_cache_creation_tokens, 0);

    // Model breakdown
    const byModel = new Map<string, { count: number; cost: number }>();
    for (const r of rows) {
      const model = r.model_used || "unknown";
      const existing = byModel.get(model) || { count: 0, cost: 0 };
      existing.count++;
      existing.cost += r.cost;
      byModel.set(model, existing);
    }

    // Top sessions by cost
    const topSessions = [...rows].sort((a, b) => b.cost - a.cost).slice(0, limit);

    if (json) {
      this.log(JSON.stringify({
        sessions: rows.length,
        totalCost: round(totalCost),
        tokens: { input: totalInput, output: totalOutput, cacheRead: totalCacheRead, cacheWrite: totalCacheWrite },
        byModel: Object.fromEntries([...byModel.entries()].map(([m, v]) => [m, { sessions: v.count, cost: round(v.cost) }])),
        topSessions: topSessions.map((r) => ({
          id: r.id, cost: round(r.cost), model: r.model_used, project: r.project_name, date: r.created_at?.slice(0, 10),
        })),
      }, null, 2));
      return;
    }

    // Header
    this.log(`\x1b[1mCost Summary\x1b[0m  ${rows.length} session${rows.length !== 1 ? "s" : ""}\n`);

    // Total
    this.log(`  Total: \x1b[1m$${totalCost.toFixed(2)}\x1b[0m`);
    this.log(`  Tokens: ${fmtTokens(totalInput)} in, ${fmtTokens(totalOutput)} out, ${fmtTokens(totalCacheRead)} cache-read, ${fmtTokens(totalCacheWrite)} cache-write`);
    this.log("");

    // By model
    this.log(`\x1b[2mBy model:\x1b[0m`);
    const sortedModels = [...byModel.entries()].sort((a, b) => b[1].cost - a[1].cost);
    for (const [model, info] of sortedModels) {
      const pct = totalCost > 0 ? Math.round((info.cost / totalCost) * 100) : 0;
      const shortModel = model.replace("claude-", "");
      this.log(`  ${shortModel.padEnd(28)} ${String(info.count).padStart(4)} sessions  \x1b[1m$${info.cost.toFixed(2).padStart(8)}\x1b[0m  ${pct}%`);
    }
    this.log("");

    // Top sessions
    this.log(`\x1b[2mMost expensive sessions:\x1b[0m`);
    for (const r of topSessions) {
      const date = (r.created_at || "").slice(0, 10);
      const shortModel = (r.model_used || "").replace("claude-", "");
      this.log(`  ${r.id.slice(0, 8)}  ${date}  ${(r.project_name || "").padEnd(20)}  ${shortModel.padEnd(16)}  \x1b[1m$${r.cost.toFixed(2)}\x1b[0m`);
    }
  }

  private renderGrouped(
    rows: (SessionRow & { cost: number })[],
    groupBy: string,
    json: boolean,
  ) {
    const groups = new Map<string, { sessions: number; cost: number; input: number; output: number }>();

    for (const r of rows) {
      let key: string;
      if (groupBy === "model") {
        key = r.model_used || "unknown";
      } else if (groupBy === "day") {
        key = (r.created_at || "").slice(0, 10);
      } else {
        key = r.project_path || r.project_name || "unknown";
      }

      const existing = groups.get(key) || { sessions: 0, cost: 0, input: 0, output: 0 };
      existing.sessions++;
      existing.cost += r.cost;
      existing.input += r.total_input_tokens;
      existing.output += r.total_output_tokens;
      groups.set(key, existing);
    }

    const sorted = [...groups.entries()].sort((a, b) => b[1].cost - a[1].cost);
    const totalCost = rows.reduce((s, r) => s + r.cost, 0);

    if (json) {
      this.log(JSON.stringify(sorted.map(([key, v]) => ({
        [groupBy]: key, sessions: v.sessions, cost: round(v.cost), inputTokens: v.input, outputTokens: v.output,
      })), null, 2));
      return;
    }

    this.log(`\x1b[1mCost by ${groupBy}\x1b[0m  ${rows.length} session${rows.length !== 1 ? "s" : ""}  \x1b[1m$${totalCost.toFixed(2)}\x1b[0m total\n`);

    const maxKey = Math.min(50, Math.max(...sorted.map(([k]) => k.length)));

    for (const [key, info] of sorted) {
      const displayKey = groupBy === "model" ? key.replace("claude-", "") : key;
      const truncKey = displayKey.length > 50 ? "..." + displayKey.slice(displayKey.length - 47) : displayKey;
      const pct = totalCost > 0 ? Math.round((info.cost / totalCost) * 100) : 0;
      const bar = "\x1b[36m" + "█".repeat(Math.max(1, Math.round(pct / 3))) + "\x1b[0m";
      this.log(`  ${truncKey.padEnd(maxKey + 2)} ${String(info.sessions).padStart(4)} sessions  \x1b[1m$${info.cost.toFixed(2).padStart(8)}\x1b[0m  ${String(pct).padStart(3)}%  ${bar}`);
    }
  }
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "K";
  return String(n);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
