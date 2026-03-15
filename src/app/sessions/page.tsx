"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search, Clock, MessageSquare, Wrench, GitBranch, ChevronRight } from "lucide-react";

interface Session {
  id: string;
  project_id: string;
  project_name: string;
  first_prompt: string | null;
  summary: string | null;
  message_count: number;
  created_at: string;
  modified_at: string;
  git_branch: string | null;
  duration_ms: number | null;
  model_used: string | null;
  tool_call_count: number;
  total_output_tokens: number;
}

interface Project {
  id: string;
  name: string;
  session_count: number;
}

function formatDuration(ms: number | null) {
  if (!ms) return null;
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

function shortModel(model: string | null) {
  if (!model) return "";
  if (model.includes("opus-4-6")) return "Opus 4.6";
  if (model.includes("opus-4-5")) return "Opus 4.5";
  if (model.includes("sonnet-4-6")) return "Sonnet 4.6";
  if (model.includes("sonnet-4-5")) return "Sonnet 4.5";
  if (model.includes("haiku")) return "Haiku";
  return model;
}

function modelBadgeClass(model: string | null) {
  if (!model) return "badge-zinc";
  if (model.includes("opus")) return "badge-amber";
  if (model.includes("sonnet")) return "badge-indigo";
  if (model.includes("haiku")) return "badge-emerald";
  return "badge-zinc";
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) return "Today " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 30;

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then(setProjects);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (projectFilter) params.set("project", projectFilter);
    params.set("limit", String(limit));
    params.set("offset", String(offset));

    fetch(`/api/sessions?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setSessions(data.sessions);
        setTotal(data.total);
      });
    return () => { cancelled = true; };
  }, [search, projectFilter, offset, limit]);

  return (
    <div className="p-8 max-w-7xl mx-auto relative z-10">
      <h1 className="text-3xl font-semibold tracking-tight mb-8">Sessions</h1>

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
          <input
            type="text"
            placeholder="Search sessions..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
            className="w-full bg-zinc-900/50 border border-zinc-800/60 rounded-lg pl-9 pr-4 py-2.5 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all"
          />
        </div>
        <select
          value={projectFilter}
          onChange={(e) => {
            setProjectFilter(e.target.value);
            setOffset(0);
          }}
          className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500/50 transition-all"
        >
          <option value="">All Projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.session_count})
            </option>
          ))}
        </select>
      </div>

      {/* Results count */}
      {total > 0 && (
        <p className="text-xs text-zinc-600 mb-4">
          Showing {offset + 1}–{Math.min(offset + limit, total)} of {total} sessions
        </p>
      )}

      {/* Session list */}
      <div className="space-y-2">
        {sessions.map((s) => (
          <Link
            key={s.id}
            href={`/sessions/${s.id}`}
            className="group block bg-zinc-900/40 border border-zinc-800/40 rounded-xl p-4 hover:bg-zinc-900/60 hover:border-zinc-700/50 transition-all duration-200"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                {/* First prompt */}
                <p className="text-sm text-zinc-200 font-medium truncate mb-2">
                  {s.first_prompt || s.summary || s.id}
                </p>

                {/* Badges row */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="badge badge-indigo">{s.project_name}</span>
                  {s.model_used && (
                    <span className={`badge ${modelBadgeClass(s.model_used)}`}>{shortModel(s.model_used)}</span>
                  )}
                  {s.git_branch && s.git_branch !== "HEAD" && (
                    <span className="badge badge-purple flex items-center gap-1">
                      <GitBranch size={10} />{s.git_branch}
                    </span>
                  )}
                </div>

                {/* Meta row */}
                <div className="flex items-center gap-4 mt-2.5 text-xs text-zinc-600">
                  <span className="flex items-center gap-1">
                    <Clock size={11} />
                    {formatDate(s.created_at)}
                  </span>
                  <span className="flex items-center gap-1">
                    <MessageSquare size={11} />
                    {s.message_count}
                  </span>
                  <span className="flex items-center gap-1">
                    <Wrench size={11} />
                    {s.tool_call_count}
                  </span>
                  {formatDuration(s.duration_ms) && (
                    <span>{formatDuration(s.duration_ms)}</span>
                  )}
                </div>
              </div>
              <ChevronRight size={16} className="text-zinc-700 group-hover:text-zinc-500 mt-1 transition-colors shrink-0" />
            </div>
          </Link>
        ))}
      </div>

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-center gap-2 mt-8">
          <button
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0}
            className="px-4 py-2 bg-zinc-800/50 border border-zinc-700/50 rounded-lg text-sm disabled:opacity-30 hover:bg-zinc-800 transition-colors"
          >
            Previous
          </button>
          <button
            onClick={() => setOffset(offset + limit)}
            disabled={offset + limit >= total}
            className="px-4 py-2 bg-zinc-800/50 border border-zinc-700/50 rounded-lg text-sm disabled:opacity-30 hover:bg-zinc-800 transition-colors"
          >
            Next
          </button>
        </div>
      )}

      {sessions.length === 0 && (
        <div className="text-center py-20">
          <MessageSquare size={28} className="text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-500 text-sm">No sessions found. Sync data from the Dashboard first.</p>
        </div>
      )}
    </div>
  );
}
