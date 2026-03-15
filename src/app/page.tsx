"use client";

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
} from "recharts";
import { MessageSquare, Wrench, FolderOpen, Zap, BarChart3, DollarSign } from "lucide-react";
import { estimateCost } from "@/lib/cost";

interface Analytics {
  dailyStats: { date: string; message_count: number; session_count: number; tool_call_count: number }[];
  modelUsage: { model_used: string; session_count: number; output_tokens: number; input_tokens: number; cache_read_tokens: number; cache_creation_tokens: number; estimated_cost: number }[];
  topTools: { tool_name: string; count: number }[];
  hourlyActivity: { hour: number; count: number }[];
  totals: {
    total_sessions: number;
    total_messages: number;
    total_tool_calls: number;
    total_output_tokens: number;
    total_input_tokens: number;
    total_cache_read_tokens: number;
    total_cache_creation_tokens: number;
    total_cost: number;
  };
  projectStats: { name: string; original_path: string; session_count: number; total_messages: number; total_tool_calls: number; total_input_tokens: number; total_output_tokens: number; total_cache_read_tokens: number; total_cache_creation_tokens: number }[];
}

const MODEL_COLORS: Record<string, string> = {
  "claude-sonnet-4-5-20250929": "#6366f1",
  "claude-sonnet-4-6": "#818cf8",
  "claude-opus-4-5-20251101": "#f59e0b",
  "claude-opus-4-6": "#fbbf24",
  "claude-haiku-4-5-20251001": "#10b981",
};

function shortModelName(model: string) {
  if (model.includes("opus-4-6")) return "Opus 4.6";
  if (model.includes("opus-4-5")) return "Opus 4.5";
  if (model.includes("sonnet-4-6")) return "Sonnet 4.6";
  if (model.includes("sonnet-4-5")) return "Sonnet 4.5";
  if (model.includes("haiku")) return "Haiku 4.5";
  return model;
}

function formatNumber(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatCost(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(3)}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs text-zinc-400 mb-1">{label}</p>
      {payload.map((p: { name: string; value: number; color: string }, i: number) => (
        <p key={i} className="text-xs font-medium" style={{ color: p.color }}>
          {p.name}: {p.value.toLocaleString()}
        </p>
      ))}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl p-5 bg-zinc-900/50 border border-zinc-800/40">
      <div className="skeleton h-3 w-16 mb-3" />
      <div className="skeleton h-7 w-24" />
    </div>
  );
}

function SkeletonChart() {
  return (
    <div className="rounded-xl p-6 bg-zinc-900/50 border border-zinc-800/40">
      <div className="skeleton h-3 w-40 mb-6" />
      <div className="skeleton h-[250px] w-full" />
    </div>
  );
}

const STAT_CONFIGS = [
  { key: "projects" as const, label: "Projects", icon: FolderOpen, color: "text-indigo-400", borderColor: "border-l-indigo-500" },
  { key: "sessions" as const, label: "Sessions", icon: MessageSquare, color: "text-emerald-400", borderColor: "border-l-emerald-500" },
  { key: "messages" as const, label: "Messages", icon: Zap, color: "text-amber-400", borderColor: "border-l-amber-500" },
  { key: "tools" as const, label: "Tool Calls", icon: Wrench, color: "text-rose-400", borderColor: "border-l-rose-500" },
  { key: "cost" as const, label: "Est. Cost", icon: DollarSign, color: "text-green-400", borderColor: "border-l-green-500" },
];

export default function Dashboard() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const res = await fetch("/api/analytics");
      if (!cancelled && res.ok) setData(await res.json());
      if (!cancelled) setLoading(false);
    };
    load();

    // Reload when sync completes from the sidebar
    const handler = () => { load(); };
    window.addEventListener("gigity:sync-complete", handler);
    return () => {
      cancelled = true;
      window.removeEventListener("gigity:sync-complete", handler);
    };
  }, []);

  const statValues = data ? {
    projects: data.projectStats.length,
    sessions: data.totals.total_sessions,
    messages: data.totals.total_messages,
    tools: data.totals.total_tool_calls,
    cost: data.totals.total_cost,
  } : null;

  return (
    <div className="p-8 max-w-7xl mx-auto relative z-10">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-zinc-500 text-sm mt-1">Your Claude Code usage at a glance</p>
      </div>

      {/* Loading skeleton */}
      {loading ? (
        <>
          <div className="grid grid-cols-5 gap-4 mb-8">
            {[1,2,3,4,5].map(i => <SkeletonCard key={i} />)}
          </div>
          <SkeletonChart />
        </>
      ) : !data ? (
        <div className="text-center py-24">
          <div className="w-16 h-16 rounded-2xl bg-zinc-800/50 flex items-center justify-center mx-auto mb-4">
            <BarChart3 size={28} className="text-zinc-600" />
          </div>
          <h3 className="text-lg font-medium text-zinc-300 mb-2">No data yet</h3>
          <p className="text-zinc-500 text-sm">Click &quot;Sync Data&quot; in the sidebar to index your Claude Code sessions</p>
        </div>
      ) : (
        <>
          {/* Stat cards with left border accent */}
          <div className="grid grid-cols-5 gap-4 mb-8">
            {STAT_CONFIGS.map((cfg) => (
              <div
                key={cfg.key}
                className={`rounded-xl p-5 bg-zinc-900/50 border border-zinc-800/40 border-l-[3px] ${cfg.borderColor}`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-zinc-500 uppercase tracking-wide">{cfg.label}</span>
                  <cfg.icon size={15} className={cfg.color} />
                </div>
                <p className="text-2xl font-bold tracking-tight">
                  {cfg.key === "cost" ? formatCost(statValues![cfg.key]) : formatNumber(statValues![cfg.key])}
                </p>
              </div>
            ))}
          </div>

          {/* Daily activity chart — hero section, no border */}
          <div className="rounded-2xl p-6 mb-8 bg-gradient-to-b from-zinc-900/80 to-zinc-900/30">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-5">Daily Activity</h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.dailyStats} barCategoryGap="15%">
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "#52525b" }}
                  tickFormatter={(d: string) => {
                    const date = new Date(d + "T00:00:00");
                    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis tick={{ fontSize: 11, fill: "#52525b" }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.02)" }} />
                <Bar dataKey="message_count" fill="#6366f1" radius={[3, 3, 0, 0]} name="Messages" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-2 gap-6 mb-8">
            {/* Model usage pie */}
            <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-6">
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-5">Model Usage</h2>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={data.modelUsage.map((m) => ({
                      name: shortModelName(m.model_used),
                      value: m.session_count,
                    }))}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    dataKey="value"
                    strokeWidth={0}
                    label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  >
                    {data.modelUsage.map((m, i) => (
                      <Cell
                        key={m.model_used}
                        fill={MODEL_COLORS[m.model_used] || `hsl(${i * 60}, 70%, 60%)`}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Top tools */}
            <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-6">
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-5">Top Tools</h2>
              <div className="space-y-3">
                {data.topTools.slice(0, 10).map((t, i) => {
                  const pct = (t.count / data.topTools[0].count) * 100;
                  return (
                    <div key={t.tool_name}>
                      <div className="flex items-baseline justify-between mb-1">
                        <span className="text-[13px] text-zinc-300 font-medium font-mono">
                          <span className="text-zinc-600 mr-2 text-[10px]">{i + 1}</span>
                          {t.tool_name}
                        </span>
                        <span className="text-xs text-zinc-600 font-mono ml-3 shrink-0">{formatNumber(t.count)}</span>
                      </div>
                      <div className="bg-zinc-800/60 rounded-full h-1.5">
                        <div
                          className="bg-indigo-500/80 h-1.5 rounded-full transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Projects leaderboard */}
          <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-6">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-5">Projects</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-600 border-b border-zinc-800/60">
                  <th className="text-left pb-3 text-xs font-medium uppercase tracking-wider">Project</th>
                  <th className="text-right pb-3 text-xs font-medium uppercase tracking-wider">Sessions</th>
                  <th className="text-right pb-3 text-xs font-medium uppercase tracking-wider">Messages</th>
                  <th className="text-right pb-3 text-xs font-medium uppercase tracking-wider">Tools</th>
                  <th className="text-right pb-3 text-xs font-medium uppercase tracking-wider">Input Tok</th>
                  <th className="text-right pb-3 text-xs font-medium uppercase tracking-wider">Output Tok</th>
                  <th className="text-right pb-3 text-xs font-medium uppercase tracking-wider">Est. Cost</th>
                </tr>
              </thead>
              <tbody>
                {data.projectStats
                  .filter((p) => p.session_count > 0)
                  .map((p) => {
                    const projectCost = estimateCost(
                      "", // use default pricing for project-level aggregation
                      p.total_input_tokens || 0,
                      p.total_output_tokens || 0,
                      p.total_cache_read_tokens || 0,
                      p.total_cache_creation_tokens || 0
                    );
                    return (
                      <tr key={p.name} className="border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors">
                        <td className="py-3 text-zinc-200 font-medium">{p.original_path}</td>
                        <td className="py-3 text-right text-zinc-500 font-mono text-xs">{p.session_count}</td>
                        <td className="py-3 text-right text-zinc-500 font-mono text-xs">{p.total_messages.toLocaleString()}</td>
                        <td className="py-3 text-right text-zinc-500 font-mono text-xs">{p.total_tool_calls.toLocaleString()}</td>
                        <td className="py-3 text-right text-zinc-500 font-mono text-xs">{formatNumber(p.total_input_tokens || 0)}</td>
                        <td className="py-3 text-right text-zinc-500 font-mono text-xs">{formatNumber(p.total_output_tokens || 0)}</td>
                        <td className="py-3 text-right text-green-400/80 font-mono text-xs">{formatCost(projectCost)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            <p className="text-[10px] text-zinc-600 mt-3">* Cost estimates use 1-hour cache write pricing. Actual costs may vary.</p>
          </div>
        </>
      )}
    </div>
  );
}
