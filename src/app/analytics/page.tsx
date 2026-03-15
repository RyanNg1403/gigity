"use client";

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
} from "recharts";

interface Analytics {
  dailyStats: { date: string; message_count: number; session_count: number; tool_call_count: number; tokens_by_model: string }[];
  modelUsage: { model_used: string; session_count: number; output_tokens: number; input_tokens: number; cache_read_tokens: number; cache_creation_tokens: number; tool_calls: number }[];
  topTools: { tool_name: string; count: number }[];
  hourlyActivity: { hour: number; count: number }[];
  branchActivity: { git_branch: string; session_count: number; total_messages: number }[];
  totals: Record<string, number>;
  projectStats: { name: string; id: string; session_count: number; total_messages: number; total_tool_calls: number }[];
}

const COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"];

function shortModel(m: string) {
  if (m.includes("opus-4-6")) return "Opus 4.6";
  if (m.includes("opus-4-5")) return "Opus 4.5";
  if (m.includes("sonnet-4-6")) return "Sonnet 4.6";
  if (m.includes("sonnet-4-5")) return "Sonnet 4.5";
  if (m.includes("haiku")) return "Haiku";
  return m;
}

function formatNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatDate(d: string) {
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);

  useEffect(() => {
    fetch("/api/analytics").then((r) => r.json()).then(setData);
  }, []);

  if (!data) {
    return (
      <div className="p-8 max-w-7xl mx-auto relative z-10">
        <div className="skeleton h-8 w-32 mb-8" />
        <div className="skeleton h-[300px] w-full rounded-xl mb-6" />
        <div className="grid grid-cols-2 gap-6">
          <div className="skeleton h-[260px] rounded-xl" />
          <div className="skeleton h-[260px] rounded-xl" />
        </div>
      </div>
    );
  }

  const dailyTokens = data.dailyStats.map((d) => {
    let totalTokens = 0;
    try {
      const parsed = JSON.parse(d.tokens_by_model || "{}");
      totalTokens = Object.values(parsed).reduce((a: number, b) => a + (b as number), 0);
    } catch { /* ignore */ }
    return { date: formatDate(d.date), messages: d.message_count, tools: d.tool_call_count, tokens: totalTokens };
  });

  const fullHours = Array.from({ length: 24 }, (_, h) => {
    const found = data.hourlyActivity.find((a) => a.hour === h);
    return { hour: `${h.toString().padStart(2, "0")}:00`, count: found?.count || 0 };
  });

  return (
    <div className="p-8 max-w-7xl mx-auto relative z-10">
      <h1 className="text-3xl font-semibold tracking-tight mb-8">Analytics</h1>

      {/* Token usage — area chart */}
      <div className="rounded-2xl p-6 mb-8 bg-gradient-to-b from-zinc-900/80 to-zinc-900/30">
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-5">Daily Token Usage</h2>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={dailyTokens}>
            <defs>
              <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#52525b" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#52525b" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => formatNum(v)} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="tokens" stroke="#6366f1" strokeWidth={2} fill="url(#tokenGradient)" name="Tokens" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-8">
        {/* Peak hours */}
        <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-6">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-5">Sessions by Hour</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={fullHours}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis dataKey="hour" tick={{ fontSize: 10, fill: "#52525b" }} interval={2} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#52525b" }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="count" fill="#10b981" radius={[3, 3, 0, 0]} name="Sessions" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Tool distribution */}
        <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-6">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-5">Tool Distribution</h2>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={data.topTools.slice(0, 8).map((t) => ({ name: t.tool_name, value: t.count }))}
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={80}
                dataKey="value"
                strokeWidth={0}
                label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
              >
                {data.topTools.slice(0, 8).map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Model token breakdown */}
        <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-6">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-5">Token Economics by Model</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-zinc-600 border-b border-zinc-800/60">
                <th className="text-left pb-3 text-xs font-medium uppercase tracking-wider">Model</th>
                <th className="text-right pb-3 text-xs font-medium uppercase tracking-wider">Input</th>
                <th className="text-right pb-3 text-xs font-medium uppercase tracking-wider">Output</th>
                <th className="text-right pb-3 text-xs font-medium uppercase tracking-wider">Cache</th>
              </tr>
            </thead>
            <tbody>
              {data.modelUsage.map((m) => (
                <tr key={m.model_used} className="border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors">
                  <td className="py-3 text-zinc-200 font-medium">{shortModel(m.model_used)}</td>
                  <td className="py-3 text-right text-zinc-500 font-mono text-xs">{formatNum(m.input_tokens || 0)}</td>
                  <td className="py-3 text-right text-zinc-500 font-mono text-xs">{formatNum(m.output_tokens || 0)}</td>
                  <td className="py-3 text-right text-zinc-500 font-mono text-xs">{formatNum(m.cache_read_tokens || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Branch activity */}
        <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-6">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-5">Git Branch Activity</h2>
          {data.branchActivity.length === 0 ? (
            <p className="text-zinc-600 text-sm">No branch data available</p>
          ) : (
            <div className="space-y-2.5">
              {data.branchActivity.map((b) => (
                <div key={b.git_branch} className="flex items-center gap-3">
                  <span className="text-[13px] text-zinc-300 w-40 truncate font-mono">{b.git_branch}</span>
                  <div className="flex-1 bg-zinc-800/60 rounded-full h-1.5">
                    <div
                      className="bg-emerald-500/70 h-1.5 rounded-full"
                      style={{ width: `${(b.session_count / data.branchActivity[0].session_count) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-zinc-600 w-16 text-right font-mono">{b.session_count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
