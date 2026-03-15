"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Clock, MessageSquare, Wrench, Brain, Cpu, TerminalSquare, ArrowUp, Layers, ChevronLeft, ChevronRight } from "lucide-react";

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
  };
  role?: string;
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
    git_branch: string;
    compression_count: number;
  };
  conversation: ConversationMessage[];
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

function MarkdownContent({ text }: { text: string }) {
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

function renderContent(content: string | ContentBlock[] | undefined, isUser: boolean, toolUseMap?: Map<string, string>, hideTools?: boolean) {
  if (!content) return null;
  if (typeof content === "string") {
    return isUser ? <p className="whitespace-pre-wrap">{content}</p> : <MarkdownContent text={content} />;
  }

  const blocks = hideTools ? content.filter((b) => b.type === "text" || b.type === "thinking") : content;

  return blocks.map((block, i) => {
    if (block.type === "text" && block.text) {
      return isUser ? (
        <div key={i} className="whitespace-pre-wrap">{block.text}</div>
      ) : (
        <MarkdownContent key={i} text={block.text} />
      );
    }
    if (block.type === "thinking" && block.thinking) {
      return (
        <details key={i} className="mt-2 mb-2 group">
          <summary className="text-xs text-amber-500/80 cursor-pointer flex items-center gap-1.5 hover:text-amber-400 transition-colors">
            <Brain size={12} /> Thinking
          </summary>
          <div className="mt-2 pl-4 border-l-2 border-amber-900/50 text-xs text-zinc-500 whitespace-pre-wrap max-h-60 overflow-auto leading-relaxed">
            {block.thinking}
          </div>
        </details>
      );
    }
    if (block.type === "tool_use") {
      return (
        <details key={i} className="mt-2 mb-2 bg-zinc-800/30 rounded-lg p-2.5 border border-zinc-700/20">
          <summary className="text-xs text-indigo-400/80 cursor-pointer flex items-center gap-1.5 hover:text-indigo-300 transition-colors">
            <Wrench size={12} /> {block.name}
          </summary>
          <pre className="mt-2 text-xs text-zinc-500 overflow-auto max-h-40 leading-relaxed">
            {JSON.stringify(block.input, null, 2)}
          </pre>
        </details>
      );
    }
    if (block.type === "tool_result") {
      const resultText = getToolResultText(block.content);
      if (!resultText) return null;
      const linkedTool = block.tool_use_id && toolUseMap ? toolUseMap.get(block.tool_use_id) : undefined;
      return (
        <details key={i} className="mt-2 mb-2 bg-zinc-800/30 rounded-lg p-2.5 border border-zinc-700/20">
          <summary className={`text-xs cursor-pointer flex items-center gap-1.5 transition-colors ${block.is_error ? "text-red-400" : "text-zinc-500 hover:text-zinc-400"}`}>
            <TerminalSquare size={12} />
            {linkedTool ? <><span className="text-indigo-400/70">{linkedTool}</span> result</> : "Tool result"}
            {block.is_error ? " (error)" : ""}
          </summary>
          <pre className="mt-2 text-xs text-zinc-500 overflow-auto max-h-40 whitespace-pre-wrap leading-relaxed">
            {resultText}
          </pre>
        </details>
      );
    }
    return null;
  });
}

export default function SessionDetailPage() {
  const params = useParams();
  const [data, setData] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [page, setPage] = useState(0);
  const [hideTools, setHideTools] = useState(false);
  const PAGE_SIZE = 50;

  useEffect(() => {
    fetch(`/api/sessions/${params.id}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      });
  }, [params.id]);

  useEffect(() => {
    const handleScroll = () => setShowScrollTop(window.scrollY > 400);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  if (loading) {
    return (
      <div className="p-8 max-w-4xl mx-auto relative z-10">
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

  if (!data?.session) {
    return <div className="p-8 text-zinc-500 relative z-10">Session not found</div>;
  }

  const { session, conversation } = data;

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

  // Filter conversation based on view mode
  const filteredConversation = hideTools
    ? conversation.filter((m) => {
        if (m.type === "system") return false;
        if (m.type === "user" && isToolResultOnly(m.content)) return false;
        // For assistant messages, check if there's any text content (not just tool_use)
        if (m.type === "assistant" && Array.isArray(m.content)) {
          return m.content.some((b) => b.type === "text" && b.text?.trim());
        }
        return true;
      })
    : conversation;

  return (
    <div className="p-8 max-w-4xl mx-auto relative z-10">
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
            <span className="text-zinc-600">Cache</span>
            <span className="ml-2 font-mono text-zinc-400">{formatTokens(session.total_cache_read_tokens || 0)}</span>
          </div>
        </div>
      </div>

      {/* View mode toggle + Pagination header */}
      {(() => {
        const totalPages = Math.ceil(filteredConversation.length / PAGE_SIZE);
        const start = page * PAGE_SIZE;
        const end = Math.min(start + PAGE_SIZE, filteredConversation.length);
        return (
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <p className="text-[11px] text-zinc-600">
                Messages {start + 1}–{end} of {filteredConversation.length}
              </p>
              <button
                onClick={() => { setHideTools(!hideTools); setPage(0); }}
                className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${
                  hideTools
                    ? "bg-indigo-600/15 border-indigo-500/30 text-indigo-400"
                    : "bg-zinc-800/50 border-zinc-700/50 text-zinc-500 hover:text-zinc-400"
                }`}
              >
                {hideTools ? "Text only" : "All messages"}
              </button>
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
          {filteredConversation.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((msg, i) => {
            if (msg.type === "system") {
              return (
                <div key={msg.uuid || i} className="relative flex items-center gap-3 py-2 pl-10">
                  <div className="absolute left-[17px] w-2 h-2 rounded-full bg-zinc-700 border-2 border-zinc-900" />
                  <span className="text-[11px] text-zinc-600 flex items-center gap-1">
                    <Layers size={10} /> Context compressed
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
                <div key={msg.uuid || i} className="relative pl-10 space-y-1">
                  <div className="absolute left-[17px] w-2 h-2 rounded-full bg-zinc-700 border-2 border-zinc-900" />
                  {blocks.map((block, j) => {
                    const resultText = getToolResultText(block.content);
                    if (!resultText) return null;
                    const linkedTool = block.tool_use_id ? toolUseMap.get(block.tool_use_id) : undefined;
                    return (
                      <details key={j} className="bg-zinc-800/20 border border-zinc-800/30 rounded-lg p-2">
                        <summary className={`text-xs cursor-pointer flex items-center gap-1 ${block.is_error ? "text-red-400" : "text-zinc-600"}`}>
                          <TerminalSquare size={11} />
                          {linkedTool ? <><span className="text-indigo-400/70">{linkedTool}</span> result</> : "Tool result"}
                          {block.is_error ? " (error)" : ""}
                        </summary>
                        <pre className="mt-1 text-xs text-zinc-600 overflow-auto max-h-40 whitespace-pre-wrap">{resultText}</pre>
                      </details>
                    );
                  })}
                </div>
              );
            }

            const dotColor = isUser ? "bg-indigo-500" : "bg-emerald-500";

            return (
              <div key={msg.uuid || i} className="relative pl-10">
                {/* Timeline dot */}
                <div className={`absolute left-[15px] top-4 w-3 h-3 rounded-full ${dotColor} border-2 border-zinc-950 shadow-sm`} />

                <div
                  className={`rounded-xl p-4 ${
                    isUser
                      ? "bg-indigo-950/20 border border-indigo-900/30"
                      : "bg-zinc-900/40 border border-zinc-800/40"
                  }`}
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
                    {renderContent(msg.content, isUser, toolUseMap, hideTools)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom pagination */}
      {(() => {
        const totalPages = Math.ceil(filteredConversation.length / PAGE_SIZE);
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
