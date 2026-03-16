"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
} from "recharts";
import {
  BarChart, Bar, Cell as RechartsCell, Tooltip as RechartsTooltip,
} from "recharts";
import { ArrowLeft, Clock, MessageSquare, Wrench, Brain, Cpu, TerminalSquare, ArrowUp, Layers, ChevronLeft, ChevronRight, DollarSign, GitCommit, GitBranch, ChevronDown, Plus, Minus, Search, X, Target, TrendingUp, TrendingDown } from "lucide-react";
import { estimateCost, getContextWindow } from "@/lib/cost";
import { InfoPopover } from "@/components/info-popover";

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: Record<string, unknown>;
  id?: string;
  tool_use_id?: string;
  content?: string | { type: string; text?: string }[];
  is_error?: boolean;
}

interface ConversationMessage {
  type: string;
  uuid: string;
  timestamp: string;
  model?: string;
  content?: string | ContentBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  role?: string;
  subtype?: string;
  compactMetadata?: { preTokens?: number; postTokens?: number };
}

interface SessionDetail {
  session: {
    id: string;
    project_name: string;
    original_path: string;
    first_prompt: string;
    model_used: string;
    message_count: number;
    tool_call_count: number;
    created_at: string;
    duration_ms: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_cache_read_tokens: number;
    total_cache_creation_tokens: number;
    git_branch: string;
    compression_count: number;
  };
  conversation: ConversationMessage[];
}

interface GitCommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

function isToolResultOnly(content: string | ContentBlock[] | undefined): boolean {
  if (!content) return true;
  if (typeof content === "string") return content.trim() === "";
  return content.every((b) => b.type === "tool_result");
}

function getToolResultText(content: string | { type: string; text?: string }[] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("\n");
}

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n: number) {
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(3)}`;
}

/** Highlight search matches within a plain text string */
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-amber-500/30 text-amber-200 rounded-sm px-0.5">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function MarkdownContent({ text, searchQuery }: { text: string; searchQuery?: string }) {
  // If searching, render as plain text with highlights for reliable highlighting
  // (ReactMarkdown transforms the text structure, making regex highlighting unreliable)
  if (searchQuery?.trim()) {
    return (
      <div className="whitespace-pre-wrap leading-relaxed">
        <HighlightText text={text} query={searchQuery} />
      </div>
    );
  }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        pre: ({ children }) => (
          <pre className="bg-zinc-800/80 rounded-lg p-3 overflow-x-auto text-xs my-2 border border-zinc-700/30">{children}</pre>
        ),
        code: ({ children, className }) => {
          const isInline = !className;
          return isInline ? (
            <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-xs text-indigo-300">{children}</code>
          ) : (
            <code className={className}>{children}</code>
          );
        },
        a: ({ href, children }) => (
          <a href={href} className="text-indigo-400 underline underline-offset-2 decoration-indigo-400/30 hover:decoration-indigo-400" target="_blank" rel="noopener noreferrer">{children}</a>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto my-2">
            <table className="text-xs border-collapse w-full">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border border-zinc-700 px-2 py-1 bg-zinc-800 text-left">{children}</th>
        ),
        td: ({ children }) => (
          <td className="border border-zinc-700 px-2 py-1">{children}</td>
        ),
        ul: ({ children }) => <ul className="list-disc pl-5 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-5 space-y-0.5">{children}</ol>,
        h1: ({ children }) => <h1 className="text-lg font-bold mt-4 mb-1.5">{children}</h1>,
        h2: ({ children }) => <h2 className="text-base font-bold mt-3 mb-1">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-zinc-600 pl-3 text-zinc-400 my-2">{children}</blockquote>
        ),
        p: ({ children }) => <p className="mb-1.5 leading-relaxed">{children}</p>,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function renderContent(content: string | ContentBlock[] | undefined, _isUser: boolean, toolUseMap?: Map<string, string>, hideTools?: boolean, searchQuery?: string) {
  if (!content) return null;
  if (typeof content === "string") {
    return <MarkdownContent text={content} searchQuery={searchQuery} />;
  }

  const blocks = hideTools ? content.filter((b) => b.type === "text" || b.type === "thinking") : content;

  return blocks.map((block, i) => {
    if (block.type === "text" && block.text) {
      return (
        <MarkdownContent key={i} text={block.text} searchQuery={searchQuery} />
      );
    }
    if (block.type === "thinking" && block.thinking) {
      return (
        <details key={i} className="mt-2 mb-2 group" open={!!searchQuery}>
          <summary className="text-xs text-amber-500/80 cursor-pointer flex items-center gap-1.5 hover:text-amber-400 transition-colors">
            <Brain size={12} /> Thinking
          </summary>
          <div className="mt-2 pl-4 border-l-2 border-amber-900/50 text-xs text-zinc-500 whitespace-pre-wrap max-h-60 overflow-auto leading-relaxed">
            {searchQuery ? <HighlightText text={block.thinking} query={searchQuery} /> : block.thinking}
          </div>
        </details>
      );
    }
    if (block.type === "tool_use") {
      const inputStr = JSON.stringify(block.input, null, 2);
      return (
        <details key={i} className="mt-2 mb-2 bg-zinc-800/30 rounded-lg p-2.5 border border-zinc-700/20" open={!!searchQuery}>
          <summary className="text-xs text-indigo-400/80 cursor-pointer flex items-center gap-1.5 hover:text-indigo-300 transition-colors">
            <Wrench size={12} /> {block.name}
          </summary>
          <pre className="mt-2 text-xs text-zinc-500 overflow-auto max-h-40 leading-relaxed">
            {searchQuery ? <HighlightText text={inputStr} query={searchQuery} /> : inputStr}
          </pre>
        </details>
      );
    }
    if (block.type === "tool_result") {
      const resultText = getToolResultText(block.content);
      if (!resultText) return null;
      const linkedTool = block.tool_use_id && toolUseMap ? toolUseMap.get(block.tool_use_id) : undefined;
      return (
        <details key={i} className="mt-2 mb-2 bg-zinc-800/30 rounded-lg p-2.5 border border-zinc-700/20" open={!!searchQuery}>
          <summary className={`text-xs cursor-pointer flex items-center gap-1.5 transition-colors ${block.is_error ? "text-red-400" : "text-zinc-500 hover:text-zinc-400"}`}>
            <TerminalSquare size={12} />
            {linkedTool ? <><span className="text-indigo-400/70">{linkedTool}</span> result</> : "Tool result"}
            {block.is_error ? " (error)" : ""}
          </summary>
          <pre className="mt-2 text-xs text-zinc-500 overflow-auto max-h-40 whitespace-pre-wrap leading-relaxed">
            {searchQuery ? <HighlightText text={resultText} query={searchQuery} /> : resultText}
          </pre>
        </details>
      );
    }
    return null;
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ContextTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs text-zinc-400 mb-1">Turn {label}</p>
      <p className="text-xs text-indigo-400">{formatTokens(d?.context || 0)} tokens</p>
      {d?.isCompression && (
        <p className="text-xs text-amber-400">Compression event</p>
      )}
    </div>
  );
}

function ContextPressureChart({ conversation, model }: { conversation: ConversationMessage[]; model: string }) {
  const chartData = useMemo(() => {
    const data: { turn: number; context: number; isCompression: boolean; preTokens?: number }[] = [];
    let turnIndex = 0;

    for (const msg of conversation) {
      if (msg.type === "system" && msg.subtype === "compact_boundary" && msg.compactMetadata) {
        data.push({
          turn: turnIndex,
          context: msg.compactMetadata.preTokens || 0,
          isCompression: true,
          preTokens: msg.compactMetadata.preTokens,
        });
        turnIndex++;
      } else if (msg.type === "assistant" && msg.usage) {
        const context =
          (msg.usage.input_tokens || 0) +
          (msg.usage.cache_read_input_tokens || 0) +
          (msg.usage.cache_creation_input_tokens || 0);
        if (context > 0) {
          data.push({ turn: turnIndex, context, isCompression: false });
          turnIndex++;
        }
      }
    }
    return data;
  }, [conversation]);

  if (chartData.length < 2) return null;

  const contextLimit = getContextWindow(model);
  const maxContext = Math.max(...chartData.map((d) => d.context), contextLimit * 0.5);
  const compressionTurns = chartData.filter((d) => d.isCompression).map((d) => d.turn);

  return (
    <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-2xl p-6 mb-8">
      <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Context Window Pressure</h2>
      <p className="text-[10px] text-zinc-600 mb-5">
        Estimated context size per turn vs {formatTokens(contextLimit)} token limit
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="contextGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity={0.4} />
              <stop offset="50%" stopColor="#eab308" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#22c55e" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
          <XAxis dataKey="turn" tick={{ fontSize: 10, fill: "#52525b" }} axisLine={false} tickLine={false} label={{ value: "Turn", position: "insideBottom", offset: -5, fontSize: 10, fill: "#52525b" }} />
          <YAxis
            tick={{ fontSize: 10, fill: "#52525b" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => formatTokens(v)}
            domain={[0, maxContext * 1.1]}
          />
          <Tooltip content={<ContextTooltip />} />
          <ReferenceLine
            y={contextLimit}
            stroke="#ef4444"
            strokeDasharray="6 3"
            strokeWidth={1.5}
            label={{ value: `${formatTokens(contextLimit)} limit`, position: "right", fontSize: 10, fill: "#ef4444" }}
          />
          {compressionTurns.map((turn) => (
            <ReferenceLine
              key={`comp-${turn}`}
              x={turn}
              stroke="#f59e0b"
              strokeDasharray="4 2"
              strokeWidth={1}
            />
          ))}
          <Area
            type="monotone"
            dataKey="context"
            stroke="#6366f1"
            strokeWidth={2}
            fill="url(#contextGradient)"
            name="Context"
          />
        </AreaChart>
      </ResponsiveContainer>
      {compressionTurns.length > 0 && (
        <p className="text-[10px] text-amber-500/60 mt-2">
          Yellow dashed lines indicate context compression events ({compressionTurns.length} total)
        </p>
      )}
    </div>
  );
}

function GitActivitySection({ sessionId }: { sessionId: string }) {
  const [commits, setCommits] = useState<GitCommitInfo[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/sessions/${sessionId}/git`)
      .then((r) => r.json())
      .then((d) => setCommits(d.commits || []))
      .catch(() => setCommits([]));
  }, [sessionId]);

  if (!commits || commits.length === 0) return null;

  const totalInsertions = commits.reduce((s, c) => s + c.insertions, 0);
  const totalDeletions = commits.reduce((s, c) => s + c.deletions, 0);
  const totalFiles = new Set(commits.flatMap(() => [])).size || commits.reduce((s, c) => s + c.filesChanged, 0);

  return (
    <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-2xl mb-8 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-5 hover:bg-zinc-800/20 transition-colors"
      >
        <div className="flex items-center gap-3">
          <GitBranch size={16} className="text-emerald-400" />
          <span className="text-sm font-medium text-zinc-200">Git Activity</span>
          <span className="text-xs text-zinc-500">
            {commits.length} commit{commits.length !== 1 ? "s" : ""}
          </span>
          <span className="flex items-center gap-1 text-xs text-green-400/70">
            <Plus size={10} />{totalInsertions}
          </span>
          <span className="flex items-center gap-1 text-xs text-red-400/70">
            <Minus size={10} />{totalDeletions}
          </span>
          <span className="text-xs text-zinc-600">{totalFiles} files</span>
        </div>
        <ChevronDown size={16} className={`text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-zinc-800/40 p-4 space-y-2">
          {commits.map((c) => (
            <div key={c.hash} className="flex items-start gap-3 py-2">
              <GitCommit size={14} className="text-zinc-600 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-300 truncate">{c.message}</p>
                <div className="flex items-center gap-3 mt-1 text-[11px] text-zinc-600">
                  <span className="font-mono">{c.hash.slice(0, 7)}</span>
                  <span>{c.author}</span>
                  <span>{new Date(c.date).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="text-green-400/60">+{c.insertions}</span>
                  <span className="text-red-400/60">-{c.deletions}</span>
                  <span>{c.filesChanged} file{c.filesChanged !== 1 ? "s" : ""}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Extract plain text from a message for search matching */
function getMessageSearchText(msg: ConversationMessage, textOnly: boolean): string {
  if (msg.type === "system") return "";
  const content = msg.content;
  if (!content) return "";
  if (typeof content === "string") return content;

  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text" && block.text) {
      parts.push(block.text);
    }
    if (block.type === "thinking" && block.thinking) {
      parts.push(block.thinking);
    }
    if (!textOnly) {
      if (block.type === "tool_use" && block.name) {
        parts.push(block.name);
        if (block.input) parts.push(JSON.stringify(block.input));
      }
      if (block.type === "tool_result") {
        const text = getToolResultText(block.content);
        if (text) parts.push(text);
      }
    }
  }
  return parts.join(" ");
}

interface MetricsData {
  session_id: string;
  turn_count: number;
  first_attempt_success_rate: number;
  interruption_rate: number;
  correction_rate: number;
  tool_error_rate: number;
  token_efficiency: number;
  prompt_specificity: number;
  error_loop_count: number;
  thinking_effectiveness: number;
  momentum: string;
  overall_score: number;
}

interface TurnEventData {
  turn_number: number;
  event_type: string;
  matched_rule: string;
  tokens_wasted: number;
}

function ScoreRing({ score, size = 64 }: { score: number; size?: number }) {
  const r = (size - 8) / 2;
  const circumference = 2 * Math.PI * r;
  const progress = (score / 100) * circumference;
  const color = score >= 80 ? "#10b981" : score >= 50 ? "#f59e0b" : "#f43f5e";

  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#27272a" strokeWidth={4} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={4} strokeLinecap="round"
        strokeDasharray={`${progress} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x={size / 2} y={size / 2 - 2} textAnchor="middle" dominantBaseline="central"
        className="text-base font-bold" fill={color}>{Math.round(score)}</text>
      <text x={size / 2} y={size / 2 + 14} textAnchor="middle"
        className="text-[9px]" fill="#71717a">Score</text>
    </svg>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TurnTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs text-zinc-400">Turn {d?.turn}</p>
      <p className="text-xs capitalize" style={{ color: d?.color }}>{d?.event}</p>
      {d?.rule && <p className="text-[10px] text-zinc-500">{d.rule}</p>}
    </div>
  );
}

function PromptEffectivenessSection({ sessionId }: { sessionId: string }) {
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [events, setEvents] = useState<TurnEventData[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`/api/sessions/${sessionId}/metrics`)
      .then((r) => r.json())
      .then((d) => {
        setMetrics(d.metrics || null);
        setEvents(d.events || []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [sessionId]);

  if (!loaded || !metrics) return null;

  const scoreColor = metrics.overall_score >= 80 ? "badge-emerald" : metrics.overall_score >= 50 ? "badge-amber" : "badge-rose";
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  // Build turn chart data
  const eventColorMap: Record<string, string> = {
    success: "#10b981",
    correction: "#f59e0b",
    interruption: "#f43f5e",
    error_loop: "#ef4444",
  };

  // Group events by turn, pick primary event for chart
  const turnChartData: { turn: number; value: number; color: string; event: string; rule: string }[] = [];
  const turnEventMap = new Map<number, TurnEventData>();
  for (const e of events) {
    if (e.event_type !== "error_loop" && !turnEventMap.has(e.turn_number)) {
      turnEventMap.set(e.turn_number, e);
    }
  }
  for (let i = 0; i < metrics.turn_count; i++) {
    const e = turnEventMap.get(i);
    const eventType = e?.event_type || "success";
    turnChartData.push({
      turn: i + 1,
      value: 1,
      color: eventColorMap[eventType] || "#10b981",
      event: eventType,
      rule: e?.matched_rule || "",
    });
  }

  return (
    <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-2xl mb-8 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-5 hover:bg-zinc-800/20 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Target size={16} className="text-cyan-400" />
          <span className="text-sm font-medium text-zinc-200">Prompt Effectiveness</span>
          <InfoPopover title="Prompt Effectiveness Score">
            <p>Measures how efficiently your prompts drove Claude to the desired outcome. The <strong className="text-zinc-300">overall score (0-100)</strong> is a weighted composite:</p>
            <div className="mt-1.5 space-y-1">
              <p><strong className="text-zinc-300">Success Rate (35%)</strong> — Turns where Claude&apos;s first response was accepted without correction or interruption.</p>
              <p><strong className="text-zinc-300">Low Interruptions (15%)</strong> — Fewer manual interruptions means prompts were scoped well enough to let Claude finish.</p>
              <p><strong className="text-zinc-300">Low Corrections (15%)</strong> — Detected when your next message starts with &quot;no&quot;, &quot;actually&quot;, &quot;undo&quot;, etc. Fewer corrections = clearer initial prompts.</p>
              <p><strong className="text-zinc-300">Low Tool Errors (15%)</strong> — Ratio of failed tool calls to total. High error rates often indicate ambiguous file paths or missing context.</p>
              <p><strong className="text-zinc-300">Prompt Specificity (10%)</strong> — Scored from your first prompt: word count, presence of code blocks, file paths, and lists.</p>
              <p><strong className="text-zinc-300">No Error Loops (10%)</strong> — Penalizes sessions where the same tool failed 3+ times in a row (e.g., repeated Bash errors).</p>
            </div>
            <p className="mt-2 text-zinc-500">Color coding: <span className="text-emerald-400">green 80+</span> · <span className="text-amber-400">amber 50-79</span> · <span className="text-rose-400">red &lt;50</span></p>
          </InfoPopover>
          <span className={`badge ${scoreColor}`}>{Math.round(metrics.overall_score)}/100</span>
          <span className="text-xs text-emerald-400/70">{pct(metrics.first_attempt_success_rate)} success</span>
          {metrics.interruption_rate > 0 && (
            <span className="text-xs text-rose-400/70">{pct(metrics.interruption_rate)} interrupted</span>
          )}
          <span className="text-xs text-zinc-500">{metrics.momentum}</span>
        </div>
        <ChevronDown size={16} className={`text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-zinc-800/40 p-5 space-y-5">
          {/* Row 1: Score ring + stat cards */}
          <div className="flex items-center gap-5">
            <ScoreRing score={metrics.overall_score} />
            <div className="grid grid-cols-2 gap-3 flex-1">
              <div className="bg-zinc-800/30 rounded-lg p-3">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Success Rate</p>
                <p className="text-lg font-semibold text-emerald-400">{pct(metrics.first_attempt_success_rate)}</p>
              </div>
              <div className="bg-zinc-800/30 rounded-lg p-3">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Correction Rate</p>
                <p className={`text-lg font-semibold ${metrics.correction_rate > 0.15 ? "text-amber-400" : "text-zinc-300"}`}>
                  {pct(metrics.correction_rate)}
                </p>
              </div>
              <div className="bg-zinc-800/30 rounded-lg p-3">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Interruption Rate</p>
                <p className={`text-lg font-semibold ${metrics.interruption_rate > 0.1 ? "text-rose-400" : "text-zinc-300"}`}>
                  {pct(metrics.interruption_rate)}
                </p>
              </div>
              <div className="bg-zinc-800/30 rounded-lg p-3">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Tool Error Rate</p>
                <p className="text-lg font-semibold text-zinc-300">{pct(metrics.tool_error_rate)}</p>
              </div>
            </div>
          </div>

          {/* Row 2: Tier 2 insight chips */}
          <div className="flex flex-wrap items-center gap-2">
            <InfoPopover title="Tier 2 Metrics">
              <div className="space-y-1.5">
                <p><strong className="text-zinc-300">Specificity</strong> — How detailed your opening prompt was. Scores word count (30+ words = 100%), plus bonuses for code blocks (+15%), file paths (+10%), and bullet lists (+10%).</p>
                <p><strong className="text-zinc-300">Error Loops</strong> — Times the same tool failed 3+ times consecutively in a turn. Usually means Claude is stuck retrying a broken command. Red if any detected.</p>
                <p><strong className="text-zinc-300">Thinking Effectiveness</strong> — Difference in success rate between turns where Claude used extended thinking vs. turns without. Positive means thinking helped.</p>
                <p><strong className="text-zinc-300">Momentum</strong> — Compares success rate in the first quarter of turns vs. the last quarter. &quot;Accelerating&quot; means you/Claude improved over the session; &quot;decelerating&quot; means quality dropped.</p>
                <p><strong className="text-zinc-300">Token Efficiency</strong> — Average output tokens per turn. Lower is generally better for the same amount of work accomplished.</p>
              </div>
            </InfoPopover>
            <span className="inline-flex items-center gap-1.5 text-[11px] bg-zinc-800/40 rounded-md px-2.5 py-1 text-zinc-400">
              Specificity
              <span className="inline-block w-12 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                <span className="block h-full bg-cyan-400 rounded-full" style={{ width: `${metrics.prompt_specificity * 100}%` }} />
              </span>
              {Math.round(metrics.prompt_specificity * 100)}%
            </span>
            <span className={`inline-flex items-center gap-1 text-[11px] rounded-md px-2.5 py-1 ${metrics.error_loop_count > 0 ? "bg-rose-950/30 text-rose-400" : "bg-zinc-800/40 text-zinc-400"}`}>
              Error loops: {metrics.error_loop_count}
            </span>
            {metrics.thinking_effectiveness !== 0 && (
              <span className={`inline-flex items-center gap-1 text-[11px] rounded-md px-2.5 py-1 ${metrics.thinking_effectiveness > 0 ? "bg-emerald-950/30 text-emerald-400" : "bg-rose-950/30 text-rose-400"}`}>
                {metrics.thinking_effectiveness > 0 ? "+" : ""}{Math.round(metrics.thinking_effectiveness * 100)}% with thinking
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-[11px] bg-zinc-800/40 rounded-md px-2.5 py-1 text-zinc-400">
              {metrics.momentum === "accelerating" && <TrendingUp size={11} className="text-emerald-400" />}
              {metrics.momentum === "decelerating" && <TrendingDown size={11} className="text-rose-400" />}
              {metrics.momentum === "stable" && <Minus size={11} />}
              {metrics.momentum}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] bg-zinc-800/40 rounded-md px-2.5 py-1 text-zinc-400">
              {formatTokens(Math.round(metrics.token_efficiency))} tok/turn
            </span>
          </div>

          {/* Row 3: Turn timeline */}
          {turnChartData.length > 1 && (
            <details className="group">
              <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-400 transition-colors">
                Turn-by-turn breakdown ({metrics.turn_count} turns)
              </summary>
              <div className="mt-3">
                <ResponsiveContainer width="100%" height={60}>
                  <BarChart data={turnChartData} barCategoryGap={1}>
                    <RechartsTooltip content={<TurnTooltip />} />
                    <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                      {turnChartData.map((d, i) => (
                        <RechartsCell key={i} fill={d.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex gap-4 mt-2 text-[10px] text-zinc-600">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" />Success</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-500 inline-block" />Correction</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-rose-500 inline-block" />Interruption</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500 inline-block" />Error loop</span>
                </div>
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

export default function SessionDetailPage() {
  const params = useParams();
  const [data, setData] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [page, setPage] = useState(0);
  const [hideTools, setHideTools] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const PAGE_SIZE = 50;

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch(`/api/sessions/${params.id}`)
        .then((r) => r.json())
        .then((d) => { if (!cancelled) { setData(d); setLoading(false); } });
    };
    load();

    const onSync = () => load();
    window.addEventListener("gigity:sync-complete", onSync);
    return () => { cancelled = true; window.removeEventListener("gigity:sync-complete", onSync); };
  }, [params.id]);

  useEffect(() => {
    const handleScroll = () => setShowScrollTop(window.scrollY > 400);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Derived data — safe to compute even when data is null (returns empty/zero)
  const conversation = useMemo(() => data?.conversation || [], [data]);
  const session = data?.session;

  const filteredConversation = useMemo(() => {
    if (!hideTools) return conversation;
    return conversation.filter((m) => {
      if (m.type === "system") return false;
      if (m.type === "user" && isToolResultOnly(m.content)) return false;
      if (m.type === "assistant" && Array.isArray(m.content)) {
        return m.content.some((b) => b.type === "text" && b.text?.trim());
      }
      return true;
    });
  }, [conversation, hideTools]);

  // Search: filter to only matching messages, respecting text-only mode
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const query = searchQuery.toLowerCase();
    return filteredConversation.filter((m) => {
      const text = getMessageSearchText(m, hideTools);
      return text.toLowerCase().includes(query);
    });
  }, [filteredConversation, searchQuery, hideTools]);

  // The list to display: search results when searching, full conversation otherwise
  const displayConversation = searchResults ?? filteredConversation;

  // Reset page when search changes
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    setCurrentMatchIndex(0);
    setPage(0);
    if (value.trim()) {
      setSearchActive(true);
    }
  }, []);

  // Navigate between matches (pages through search results)
  const goToMatch = useCallback((matchIdx: number) => {
    if (!searchResults || searchResults.length === 0) return;
    const idx = ((matchIdx % searchResults.length) + searchResults.length) % searchResults.length;
    setCurrentMatchIndex(idx);
    const targetPage = Math.floor(idx / PAGE_SIZE);
    setPage(targetPage);
    setTimeout(() => {
      const el = document.querySelector(`[data-msg-index="${idx}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }, [searchResults, PAGE_SIZE]);

  // Keyboard shortcut: Ctrl/Cmd+F to open search, Escape to close, Enter for next match
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setSearchActive(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
      if (e.key === "Escape" && searchActive) {
        setSearchActive(false);
        setSearchQuery("");
        setPage(0);
      }
      if (e.key === "Enter" && searchActive && searchResults && searchResults.length > 0) {
        e.preventDefault();
        if (e.shiftKey) {
          goToMatch(currentMatchIndex - 1);
        } else {
          goToMatch(currentMatchIndex + 1);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [searchActive, searchResults, currentMatchIndex, goToMatch]);

  // After search results render: expand collapsed <details>, scroll inner containers to first <mark> per message
  useEffect(() => {
    if (!searchQuery) return;
    const timer = setTimeout(() => {
      // Process each message card individually
      const msgCards = document.querySelectorAll("[data-msg-index]");
      for (const card of msgCards) {
        const firstMark = card.querySelector("mark");
        if (!firstMark) continue;

        // Expand any ancestor <details> within this card
        let el: HTMLElement | null = firstMark.parentElement;
        while (el && el !== card) {
          if (el.tagName === "DETAILS" && !(el as HTMLDetailsElement).open) {
            (el as HTMLDetailsElement).open = true;
          }
          el = el.parentElement;
        }

        // Scroll any scrollable ancestor container (e.g. <pre> with overflow) to the mark
        let scrollParent: HTMLElement | null = firstMark.parentElement;
        while (scrollParent && scrollParent !== card) {
          const overflowsV = scrollParent.scrollHeight > scrollParent.clientHeight;
          const overflowsH = scrollParent.scrollWidth > scrollParent.clientWidth;
          if (overflowsV || overflowsH) {
            const parentRect = scrollParent.getBoundingClientRect();
            const markRect = firstMark.getBoundingClientRect();
            if (overflowsV) {
              scrollParent.scrollTop += markRect.top - parentRect.top - parentRect.height / 3;
            }
            if (overflowsH) {
              scrollParent.scrollLeft += markRect.left - parentRect.left - parentRect.width / 3;
            }
          }
          scrollParent = scrollParent.parentElement;
        }
      }
    }, 80);
    return () => clearTimeout(timer);
  }, [searchQuery, page]);

  // Early returns after all hooks
  if (loading) {
    return (
      <div className="px-6 py-8 max-w-6xl mx-auto relative z-10">
        <div className="skeleton h-4 w-32 mb-6" />
        <div className="skeleton h-40 w-full rounded-xl mb-6" />
        <div className="space-y-4">
          <div className="skeleton h-20 w-full rounded-xl" />
          <div className="skeleton h-32 w-full rounded-xl" />
          <div className="skeleton h-20 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (!session) {
    return <div className="p-8 text-zinc-500 relative z-10">Session not found</div>;
  }

  // Build tool_use id → tool name map for linking results to calls
  const toolUseMap = new Map<string, string>();
  for (const msg of conversation) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "tool_use" && block.id && block.name) {
          toolUseMap.set(block.id, block.name);
        }
      }
    }
  }

  const userTurnCount = conversation.filter(
    (m) => m.type === "user" && !isToolResultOnly(m.content)
  ).length;

  const sessionCost = estimateCost(
    session.model_used || "",
    session.total_input_tokens || 0,
    session.total_output_tokens || 0,
    session.total_cache_read_tokens || 0,
    session.total_cache_creation_tokens || 0
  );

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto relative z-10">
      <Link href="/sessions" className="inline-flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-300 mb-6 transition-colors">
        <ArrowLeft size={13} /> Back to sessions
      </Link>

      {/* Session header */}
      <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-2xl p-6 mb-8">
        <div className="flex items-center gap-2 mb-2">
          <span className="badge badge-indigo">{session.project_name}</span>
          {session.git_branch && session.git_branch !== "HEAD" && (
            <span className="badge badge-purple">{session.git_branch}</span>
          )}
        </div>
        <h1 className="text-lg font-semibold mb-4 line-clamp-2 leading-snug">{session.first_prompt || session.id}</h1>

        <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-zinc-500">
          <span className="flex items-center gap-1.5">
            <Clock size={12} className="text-zinc-600" />
            {new Date(session.created_at).toLocaleString()}
          </span>
          <span className="flex items-center gap-1.5">
            <MessageSquare size={12} className="text-zinc-600" />
            {session.message_count} messages ({userTurnCount} turns)
          </span>
          <span className="flex items-center gap-1.5">
            <Wrench size={12} className="text-zinc-600" />
            {session.tool_call_count} tool calls
          </span>
          <span className="flex items-center gap-1.5">
            <Cpu size={12} className="text-zinc-600" />
            {session.model_used}
          </span>
          {session.compression_count > 0 && (
            <span className="flex items-center gap-1.5 text-amber-500/70">
              <Layers size={12} />
              {session.compression_count} compressions
            </span>
          )}
          <span className="flex items-center gap-1.5 text-green-400/80">
            <DollarSign size={12} />
            {formatCost(sessionCost)} est.
          </span>
        </div>

        {/* Token summary bar */}
        <div className="flex gap-4 mt-4 pt-4 border-t border-zinc-800/40 text-xs">
          <div>
            <span className="text-zinc-600">Input</span>
            <span className="ml-2 font-mono text-zinc-400">{formatTokens(session.total_input_tokens || 0)}</span>
          </div>
          <div>
            <span className="text-zinc-600">Output</span>
            <span className="ml-2 font-mono text-zinc-400">{formatTokens(session.total_output_tokens || 0)}</span>
          </div>
          <div>
            <span className="text-zinc-600">Cache Read</span>
            <span className="ml-2 font-mono text-zinc-400">{formatTokens(session.total_cache_read_tokens || 0)}</span>
          </div>
          <div>
            <span className="text-zinc-600">Cache Write</span>
            <span className="ml-2 font-mono text-zinc-400">{formatTokens(session.total_cache_creation_tokens || 0)}</span>
          </div>
        </div>
      </div>

      {/* Search bar — fixed to top of main content area */}
      {searchActive && (
        <>
          <div className="flex items-center gap-2 bg-zinc-950/95 border border-zinc-700/50 rounded-lg px-3 py-2 fixed top-3 left-[calc(15rem+1.5rem)] right-6 z-30 backdrop-blur-sm shadow-xl">
            <Search size={14} className="text-zinc-500 shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder={hideTools ? "Search text messages..." : "Search all messages..."}
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="flex-1 bg-transparent text-sm placeholder:text-zinc-600 focus:outline-none"
              autoFocus
            />
            {searchQuery && (
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[11px] text-zinc-500">
                  {searchResults && searchResults.length > 0
                    ? `${currentMatchIndex + 1}/${searchResults.length}`
                    : "No matches"}
                </span>
                <button
                  onClick={() => goToMatch(currentMatchIndex - 1)}
                  disabled={!searchResults || searchResults.length === 0}
                  className="p-1 rounded hover:bg-zinc-800 disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft size={14} className="text-zinc-400" />
                </button>
                <button
                  onClick={() => goToMatch(currentMatchIndex + 1)}
                  disabled={!searchResults || searchResults.length === 0}
                  className="p-1 rounded hover:bg-zinc-800 disabled:opacity-30 transition-colors"
                >
                  <ChevronRight size={14} className="text-zinc-400" />
                </button>
              </div>
            )}
            <button
              onClick={() => { setSearchActive(false); setSearchQuery(""); setPage(0); }}
              className="p-1 rounded hover:bg-zinc-800 transition-colors shrink-0"
            >
              <X size={14} className="text-zinc-500" />
            </button>
          </div>
          {/* Spacer so content isn't hidden behind the fixed bar */}
          <div className="h-12" />
        </>
      )}

      {/* View mode toggle + Pagination header */}
      {(() => {
        const totalPages = Math.ceil(displayConversation.length / PAGE_SIZE);
        const start = page * PAGE_SIZE;
        const end = Math.min(start + PAGE_SIZE, displayConversation.length);
        return (
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <p className="text-[11px] text-zinc-600">
                {searchResults ? `${displayConversation.length} results` : `Messages ${start + 1}–${end} of ${displayConversation.length}`}
              </p>
              <button
                onClick={() => { setHideTools(!hideTools); setPage(0); setSearchQuery(""); setCurrentMatchIndex(0); }}
                className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${
                  hideTools
                    ? "bg-indigo-600/15 border-indigo-500/30 text-indigo-400"
                    : "bg-zinc-800/50 border-zinc-700/50 text-zinc-500 hover:text-zinc-400"
                }`}
              >
                {hideTools ? "Text only" : "All messages"}
              </button>
              {!searchActive && (
                <button
                  onClick={() => { setSearchActive(true); setTimeout(() => searchInputRef.current?.focus(), 50); }}
                  className="text-[11px] px-2.5 py-1 rounded-md border border-zinc-700/50 bg-zinc-800/50 text-zinc-500 hover:text-zinc-400 transition-colors flex items-center gap-1"
                >
                  <Search size={11} /> Search
                </button>
              )}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => { setPage(Math.max(0, page - 1)); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                  disabled={page === 0}
                  className="p-1.5 rounded-md bg-zinc-800/50 border border-zinc-700/50 disabled:opacity-30 hover:bg-zinc-800 transition-colors"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="text-xs text-zinc-500 px-2">
                  {page + 1} / {totalPages}
                </span>
                <button
                  onClick={() => { setPage(Math.min(totalPages - 1, page + 1)); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                  disabled={page >= totalPages - 1}
                  className="p-1.5 rounded-md bg-zinc-800/50 border border-zinc-700/50 disabled:opacity-30 hover:bg-zinc-800 transition-colors"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* Conversation with timeline */}
      <div className="relative">
        {/* Vertical timeline line */}
        <div className="absolute left-5 top-0 bottom-0 w-px bg-zinc-800/60" />

        <div className="space-y-3">
          {displayConversation.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((msg, i) => {
            const globalIndex = page * PAGE_SIZE + i;
            const isFocusedMatch = searchResults ? globalIndex === currentMatchIndex : false;

            if (msg.type === "system") {
              return (
                <div key={msg.uuid || i} className="relative flex items-center gap-3 py-2 pl-10">
                  <div className="absolute left-[17px] w-2 h-2 rounded-full bg-zinc-700 border-2 border-zinc-900" />
                  <span className="text-[11px] text-zinc-600 flex items-center gap-1">
                    <Layers size={10} /> Context compressed
                    {msg.compactMetadata?.preTokens && (
                      <span className="text-amber-500/50 ml-1">({formatTokens(msg.compactMetadata.preTokens)} tokens)</span>
                    )}
                  </span>
                </div>
              );
            }

            const isUser = msg.type === "user";
            const toolResultOnly = isUser && isToolResultOnly(msg.content);

            // Skip empty tool returns
            if (toolResultOnly) {
              const blocks = Array.isArray(msg.content) ? msg.content : [];
              const hasContent = blocks.some((b) => getToolResultText(b.content).length > 0);
              if (!hasContent) return null;

              return (
                <div key={msg.uuid || i} className="relative pl-10 space-y-1" data-msg-index={globalIndex}>
                  <div className="absolute left-[17px] w-2 h-2 rounded-full bg-zinc-700 border-2 border-zinc-900" />
                  {blocks.map((block, j) => {
                    const resultText = getToolResultText(block.content);
                    if (!resultText) return null;
                    const linkedTool = block.tool_use_id ? toolUseMap.get(block.tool_use_id) : undefined;
                    return (
                      <details key={j} className="bg-zinc-800/20 border border-zinc-800/30 rounded-lg p-2" open={!!searchQuery}>
                        <summary className={`text-xs cursor-pointer flex items-center gap-1 ${block.is_error ? "text-red-400" : "text-zinc-600"}`}>
                          <TerminalSquare size={11} />
                          {linkedTool ? <><span className="text-indigo-400/70">{linkedTool}</span> result</> : "Tool result"}
                          {block.is_error ? " (error)" : ""}
                        </summary>
                        <pre className="mt-1 text-xs text-zinc-600 overflow-auto max-h-40 whitespace-pre-wrap">
                          {searchQuery ? <HighlightText text={resultText} query={searchQuery} /> : resultText}
                        </pre>
                      </details>
                    );
                  })}
                </div>
              );
            }

            const dotColor = isUser ? "bg-indigo-500" : "bg-emerald-500";

            return (
              <div key={msg.uuid || i} className="relative pl-10" data-msg-index={globalIndex}>
                {/* Timeline dot */}
                <div className={`absolute left-[15px] top-4 w-3 h-3 rounded-full ${dotColor} border-2 border-zinc-950 shadow-sm`} />

                <div
                  className={`rounded-xl p-4 transition-all duration-300 ${
                    isUser
                      ? "bg-indigo-950/20 border border-indigo-900/30"
                      : "bg-zinc-900/40 border border-zinc-800/40"
                  } ${isFocusedMatch ? "ring-2 ring-amber-500/70 border-amber-500/40" : ""}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs font-semibold ${isUser ? "text-indigo-400" : "text-emerald-400"}`}>
                      {isUser ? "You" : "Claude"}
                    </span>
                    <div className="flex items-center gap-3 text-[11px] text-zinc-600">
                      {msg.model && <span className="font-mono">{msg.model}</span>}
                      {msg.usage?.output_tokens ? <span>{formatTokens(msg.usage.output_tokens)} tok</span> : null}
                      {msg.timestamp && (
                        <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-sm text-zinc-300 leading-relaxed">
                    {renderContent(msg.content, isUser, toolUseMap, hideTools, searchQuery || undefined)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom pagination */}
      {(() => {
        const totalPages = Math.ceil(displayConversation.length / PAGE_SIZE);
        if (totalPages <= 1) return null;
        return (
          <div className="flex items-center justify-center gap-1.5 mt-6">
            <button
              onClick={() => { setPage(Math.max(0, page - 1)); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              disabled={page === 0}
              className="px-4 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700/50 text-sm disabled:opacity-30 hover:bg-zinc-800 transition-colors"
            >
              Previous
            </button>
            <span className="text-xs text-zinc-500 px-3">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => { setPage(Math.min(totalPages - 1, page + 1)); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              disabled={page >= totalPages - 1}
              className="px-4 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700/50 text-sm disabled:opacity-30 hover:bg-zinc-800 transition-colors"
            >
              Next
            </button>
          </div>
        );
      })()}

      {/* Session insights — below transcript */}
      <div className="mt-10 space-y-6">
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Session Insights</h2>
        <PromptEffectivenessSection sessionId={session.id} />
        <ContextPressureChart conversation={conversation} model={session.model_used || ""} />
        <GitActivitySection sessionId={session.id} />
      </div>

      {/* Scroll to top button */}
      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-6 right-6 z-40 w-10 h-10 bg-zinc-800 border border-zinc-700 rounded-full flex items-center justify-center shadow-lg hover:bg-zinc-700 transition-colors"
        >
          <ArrowUp size={16} className="text-zinc-400" />
        </button>
      )}
    </div>
  );
}
