"use client";

import { useEffect, useState, useCallback } from "react";
import { Brain, Save, Trash2 } from "lucide-react";

interface MemoryProject {
  id: string;
  name: string;
  originalPath: string;
}

interface MemoryFile {
  filename: string;
  name: string;
  description: string;
  type: string;
  content: string;
  path: string;
}

export default function MemoriesPage() {
  const [projects, setProjects] = useState<MemoryProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [memories, setMemories] = useState<MemoryFile[]>([]);
  const [memoryIndex, setMemoryIndex] = useState<{ content: string; path: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/memories")
      .then((r) => r.json())
      .then((d) => setProjects(d.projects || []));
  }, []);

  const loadMemories = useCallback(async (projectId: string) => {
    const res = await fetch(`/api/memories?project=${encodeURIComponent(projectId)}`);
    if (res.ok) {
      const data = await res.json();
      setMemories(data.memories || []);
      setMemoryIndex(data.memoryIndex);
    }
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    let cancelled = false;
    fetch(`/api/memories?project=${encodeURIComponent(selectedProject)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setMemories(data.memories || []);
        setMemoryIndex(data.memoryIndex);
      });
    return () => { cancelled = true; };
  }, [selectedProject]);

  const saveMemory = async (filename: string) => {
    setSaving(true);
    const res = await fetch("/api/memories", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: selectedProject, filename, content: editContent }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(`Save failed: ${err.error || "Unknown error"}`);
    }
    setEditing(null);
    setSaving(false);
    loadMemories(selectedProject);
  };

  const deleteMemory = async (mem: MemoryFile) => {
    if (!confirm(`Delete memory "${mem.name}"?`)) return;
    const res = await fetch("/api/memories", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: selectedProject, filename: mem.filename }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(`Delete failed: ${err.error || "Unknown error"}`);
    }
    loadMemories(selectedProject);
  };

  const typeBadge: Record<string, string> = {
    user: "badge-indigo",
    feedback: "badge-amber",
    project: "badge-emerald",
    reference: "badge-purple",
  };

  return (
    <div className="p-8 max-w-5xl mx-auto relative z-10">
      <h1 className="text-3xl font-semibold tracking-tight mb-8">Memories</h1>

      {/* Project selector */}
      <div className="relative mb-8">
        <select
          value={selectedProject}
          onChange={(e) => {
            if (editing && !confirm("You have unsaved changes. Switch project?")) return;
            setSelectedProject(e.target.value);
            setEditing(null);
          }}
          className="w-full max-w-md bg-zinc-900/50 border border-zinc-800/40 rounded-lg px-4 py-2.5 text-sm appearance-none focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all"
        >
          <option value="">Select a project...</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.originalPath}
            </option>
          ))}
        </select>
      </div>

      {selectedProject && (
        <>
          {/* MEMORY.md index */}
          {memoryIndex && (
            <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-6 mb-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-zinc-400">MEMORY.md Index</h2>
                <div className="flex gap-2">
                  {editing === "MEMORY.md" ? (
                    <button
                      onClick={() => saveMemory("MEMORY.md")}
                      disabled={saving}
                      className="flex items-center gap-1 px-3 py-1 bg-emerald-700 hover:bg-emerald-600 rounded text-xs disabled:opacity-50"
                    >
                      <Save size={12} /> Save
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        if (editing && editing !== "MEMORY.md" && !confirm("Discard unsaved changes?")) return;
                        setEditing("MEMORY.md");
                        setEditContent(memoryIndex.content);
                      }}
                      className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-xs"
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>
              {editing === "MEMORY.md" ? (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-sm font-mono min-h-[200px] focus:outline-none focus:border-indigo-500"
                />
              ) : (
                <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-mono">{memoryIndex.content}</pre>
              )}
            </div>
          )}

          {/* Memory files */}
          {memories.length === 0 ? (
            <p className="text-zinc-500 text-sm">No memory files found for this project.</p>
          ) : (
            <div className="space-y-3">
              {memories.map((mem) => (
                <div key={mem.filename} className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <Brain size={16} className="text-indigo-400" />
                      <span className="font-medium text-sm">{mem.name}</span>
                      {mem.type && <span className={`badge ${typeBadge[mem.type] || "badge-zinc"}`}>{mem.type}</span>}
                    </div>
                    <div className="flex gap-2">
                      {editing === mem.filename ? (
                        <button
                          onClick={() => saveMemory(mem.filename)}
                          disabled={saving}
                          className="flex items-center gap-1 px-3 py-1 bg-emerald-700 hover:bg-emerald-600 rounded text-xs disabled:opacity-50"
                        >
                          <Save size={12} /> Save
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            if (editing && editing !== mem.filename && !confirm("Discard unsaved changes?")) return;
                            setEditing(mem.filename);
                            setEditContent(mem.content);
                          }}
                          className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-xs"
                        >
                          Edit
                        </button>
                      )}
                      <button
                        onClick={() => deleteMemory(mem)}
                        className="p-1 text-zinc-600 hover:text-red-400"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  {mem.description && (
                    <p className="text-xs text-zinc-500 mb-2">{mem.description}</p>
                  )}
                  {editing === mem.filename ? (
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-sm font-mono min-h-[200px] focus:outline-none focus:border-indigo-500"
                    />
                  ) : (
                    <pre className="text-sm text-zinc-400 whitespace-pre-wrap font-mono bg-zinc-800/50 rounded-lg p-3 max-h-48 overflow-auto">
                      {mem.content}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {!selectedProject && (
        <p className="text-zinc-500 text-center py-12">
          Select a project to view its memories.
        </p>
      )}
    </div>
  );
}
