"use client";

import { useEffect, useState, useCallback } from "react";
import { Save, ChevronDown, ChevronRight, Code, Cpu, Shield, Palette, GitBranch, Box, RefreshCw, Plug, Cog, type LucideIcon } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Schema: every setting users can edit from ~/.claude/settings.json */
/* ------------------------------------------------------------------ */

type FieldType = "select" | "boolean" | "text" | "number" | "textarea";

interface SettingField {
  key: string;           // dot-path, e.g. "permissions.defaultMode"
  label: string;
  description: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  placeholder?: string;
}

interface SettingSection {
  title: string;
  icon: LucideIcon;
  fields: SettingField[];
}

interface SettingGroup {
  label: string;
  sections: SettingSection[];
}

const SETTINGS_GROUPS: SettingGroup[] = [
  {
    label: "Common",
    sections: [
  {
    title: "Model & Behavior",
    icon: Cpu,
    fields: [
      {
        key: "model",
        label: "Default Model",
        description: "Default model to use for Claude Code",
        type: "select",
        options: [
          { value: "", label: "Default" },
          { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
          { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
          { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
        ],
      },
      {
        key: "effortLevel",
        label: "Effort Level",
        description: "Reasoning effort level (Opus 4.6, Sonnet 4.6)",
        type: "select",
        options: [
          { value: "", label: "Default" },
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
        ],
      },
      {
        key: "alwaysThinkingEnabled",
        label: "Always Enable Extended Thinking",
        description: "Enable extended thinking by default",
        type: "boolean",
      },
      {
        key: "language",
        label: "Response Language",
        description: "Claude's preferred response language",
        type: "text",
        placeholder: "e.g. japanese, spanish, vietnamese",
      },
    ],
  },
  {
    title: "Permissions",
    icon: Shield,
    fields: [
      {
        key: "permissions.defaultMode",
        label: "Default Permission Mode",
        description: "Default permission mode when opening Claude Code",
        type: "select",
        options: [
          { value: "", label: "Default (prompt on first use)" },
          { value: "default", label: "Default" },
          { value: "acceptEdits", label: "Accept Edits" },
          { value: "plan", label: "Plan Mode (read-only)" },
          { value: "dontAsk", label: "Don't Ask (deny unless pre-approved)" },
          { value: "bypassPermissions", label: "Bypass Permissions" },
        ],
      },
      {
        key: "permissions.disableBypassPermissionsMode",
        label: "Disable Bypass Permissions Mode",
        description: "Prevent activation of bypassPermissions mode",
        type: "select",
        options: [
          { value: "", label: "Default (allowed)" },
          { value: "disable", label: "Disable" },
        ],
      },
    ],
  },
  {
    title: "Output & Display",
    icon: Palette,
    fields: [
      {
        key: "outputStyle",
        label: "Output Style",
        description: "Configure output style to adjust system prompt",
        type: "text",
        placeholder: "e.g. Explanatory",
      },
      {
        key: "showTurnDuration",
        label: "Show Turn Duration",
        description: "Show turn duration messages after responses",
        type: "boolean",
      },
      {
        key: "spinnerTipsEnabled",
        label: "Spinner Tips",
        description: "Show tips in spinner while waiting",
        type: "boolean",
      },
      {
        key: "terminalProgressBarEnabled",
        label: "Terminal Progress Bar",
        description: "Enable terminal progress bar",
        type: "boolean",
      },
      {
        key: "prefersReducedMotion",
        label: "Reduced Motion",
        description: "Reduce/disable UI animations for accessibility",
        type: "boolean",
      },
    ],
  },
    ],
  },
  {
    label: "Advanced",
    sections: [
  {
    title: "Git & Attribution",
    icon: GitBranch,
    fields: [
      {
        key: "includeGitInstructions",
        label: "Include Git Instructions",
        description: "Include built-in commit/PR instructions in system prompt",
        type: "boolean",
      },
      {
        key: "attribution.commit",
        label: "Commit Attribution",
        description: "Attribution text for git commits (empty to hide)",
        type: "text",
        placeholder: "Co-Authored-By: Claude ...",
      },
      {
        key: "attribution.pr",
        label: "PR Attribution",
        description: "Attribution text for pull requests (empty to hide)",
        type: "text",
        placeholder: "Generated with Claude Code",
      },
    ],
  },
  {
    title: "Sandbox",
    icon: Box,
    fields: [
      {
        key: "sandbox.enabled",
        label: "Enable Sandbox",
        description: "Enable bash sandboxing (macOS, Linux, WSL2)",
        type: "boolean",
      },
      {
        key: "sandbox.autoAllowBashIfSandboxed",
        label: "Auto-Allow Bash When Sandboxed",
        description: "Auto-approve bash commands when sandbox is enabled",
        type: "boolean",
      },
      {
        key: "sandbox.allowUnsandboxedCommands",
        label: "Allow Unsandboxed Escape Hatch",
        description: "Allow dangerouslyDisableSandbox flag",
        type: "boolean",
      },
    ],
  },
  {
    title: "Sessions & Updates",
    icon: RefreshCw,
    fields: [
      {
        key: "cleanupPeriodDays",
        label: "Session Cleanup Period (days)",
        description: "Sessions inactive longer than this are deleted at startup (default: 30)",
        type: "number",
        placeholder: "30",
      },
      {
        key: "autoUpdatesChannel",
        label: "Auto-Updates Channel",
        description: "Release channel for updates",
        type: "select",
        options: [
          { value: "", label: "Default (latest)" },
          { value: "stable", label: "Stable" },
          { value: "latest", label: "Latest" },
        ],
      },
      {
        key: "fastModePerSessionOptIn",
        label: "Fast Mode Per-Session Opt-In",
        description: "Require per-session opt-in for fast mode",
        type: "boolean",
      },
    ],
  },
  {
    title: "MCP & Plugins",
    icon: Plug,
    fields: [
      {
        key: "enableAllProjectMcpServers",
        label: "Auto-Approve All MCP Servers",
        description: "Auto-approve all MCP servers in project .mcp.json",
        type: "boolean",
      },
      {
        key: "disableAllHooks",
        label: "Disable All Hooks",
        description: "Disable all hooks and custom status line",
        type: "boolean",
      },
    ],
  },
  {
    title: "Advanced",
    icon: Cog,
    fields: [
      {
        key: "respectGitignore",
        label: "Respect .gitignore",
        description: "Whether @ file picker respects .gitignore",
        type: "boolean",
      },
      {
        key: "teammateMode",
        label: "Teammate Display Mode",
        description: "How agent team teammates display",
        type: "select",
        options: [
          { value: "", label: "Default (auto)" },
          { value: "auto", label: "Auto" },
          { value: "in-process", label: "In-Process" },
          { value: "tmux", label: "Tmux" },
        ],
      },
      {
        key: "forceLoginMethod",
        label: "Force Login Method",
        description: "Restrict login method",
        type: "select",
        options: [
          { value: "", label: "Default (any)" },
          { value: "claudeai", label: "Claude.ai" },
          { value: "console", label: "Console" },
        ],
      },
    ],
  },
    ],
  },
];


/* ------------------------------------------------------------------ */
/*  Helpers for nested dot-path access                                */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getNestedValue(obj: any, path: string): unknown {
  return path.split(".").reduce((o, k) => o?.[k], obj);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setNestedValue(obj: any, path: string, value: unknown): any {
  const clone = JSON.parse(JSON.stringify(obj));
  const keys = path.split(".");
  let cur = clone;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] === undefined || cur[keys[i]] === null) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  if (value === "" || value === undefined) {
    delete cur[keys[keys.length - 1]];
    // Clean up empty parent objects
    if (keys.length > 1 && Object.keys(cur).length === 0) {
      let parent = clone;
      for (let i = 0; i < keys.length - 2; i++) parent = parent[keys[i]];
      delete parent[keys[keys.length - 2]];
    }
  } else {
    cur[keys[keys.length - 1]] = value;
  }
  return clone;
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export default function SettingsPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [settings, setSettings] = useState<any>({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [original, setOriginal] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const [rawJson, setRawJson] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setSettings(data);
        setOriginal(data);
        setRawJson(JSON.stringify(data, null, 2));
      });
  }, []);

  const hasChanges = JSON.stringify(settings) !== JSON.stringify(original);

  const handleSave = useCallback(async () => {
    setError(null);
    setSaving(true);

    const toSave = showRawJson ? JSON.parse(rawJson) : settings;
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toSave),
    });

    if (res.ok) {
      setOriginal(toSave);
      setSettings(toSave);
      setRawJson(JSON.stringify(toSave, null, 2));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } else {
      setError("Failed to save settings");
    }
    setSaving(false);
  }, [settings, rawJson, showRawJson]);

  const updateField = (key: string, value: unknown) => {
    setSettings(setNestedValue(settings, key, value));
  };

  const toggleSection = (title: string) => {
    setCollapsed((c) => ({ ...c, [title]: !c[title] }));
  };

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto relative z-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
          <p className="text-zinc-500 text-sm mt-1">~/.claude/settings.json</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setShowRawJson(!showRawJson);
              if (!showRawJson) setRawJson(JSON.stringify(settings, null, 2));
            }}
            className="flex items-center gap-1.5 px-3 py-2.5 bg-zinc-800/50 border border-zinc-700/50 hover:bg-zinc-800 rounded-lg text-xs font-medium transition-colors"
          >
            <Code size={13} />
            {showRawJson ? "Form View" : "Raw JSON"}
          </button>
          <button
            onClick={handleSave}
            disabled={(!hasChanges && !showRawJson) || saving}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 rounded-lg text-sm font-medium transition-all duration-200 shadow-lg shadow-indigo-600/20"
          >
            <Save size={16} />
            {saving ? "Saving..." : saved ? "Saved!" : "Save"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300">
          {error}
        </div>
      )}

      {showRawJson ? (
        <div>
          <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-lg px-4 py-3 mb-4 text-[12px] text-zinc-400">
            Edit the raw JSON below. Changes are validated on save. Use Form View for guided editing.
          </div>
          <textarea
            value={rawJson}
            onChange={(e) => setRawJson(e.target.value)}
            className="w-full bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-6 text-sm font-mono min-h-[500px] focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 resize-y transition-all"
            spellCheck={false}
          />
        </div>
      ) : (
        <div className="flex gap-6">
          {/* Sticky section nav */}
          <nav className="hidden lg:block w-40 shrink-0">
            <div className="sticky top-4 space-y-1">
              {SETTINGS_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider px-2 pt-3 pb-1">{group.label}</p>
                  {group.sections.map((section) => (
                    <button
                      key={section.title}
                      onClick={() => {
                        const el = document.getElementById(`settings-${section.title.replace(/\s+/g, "-").toLowerCase()}`);
                        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                      className="block w-full text-left px-2 py-1.5 text-[12px] text-zinc-500 hover:text-zinc-300 rounded transition-colors truncate"
                    >
                      {section.title}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </nav>

          {/* Sections */}
          <div className="flex-1 space-y-6">
            {SETTINGS_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-2">{group.label}</p>
                <div className="space-y-2">
                  {group.sections.map((section) => {
                    const isCollapsed = collapsed[section.title];
                    const SectionIcon = section.icon;
                    return (
                      <div key={section.title} id={`settings-${section.title.replace(/\s+/g, "-").toLowerCase()}`} className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl overflow-hidden scroll-mt-4">
                        <button
                          onClick={() => toggleSection(section.title)}
                          className="w-full flex items-center gap-3 px-5 py-4 text-[13px] font-semibold text-zinc-300 hover:bg-zinc-800/30 transition-colors"
                        >
                          <SectionIcon size={15} className="text-zinc-500" />
                          <span className="flex-1 text-left">{section.title}</span>
                          {isCollapsed ? <ChevronRight size={14} className="text-zinc-600" /> : <ChevronDown size={14} className="text-zinc-600" />}
                        </button>
                        {!isCollapsed && (
                          <div className="px-5 pb-5 space-y-5 border-t border-zinc-800/40 pt-5">
                            {section.fields.map((field) => (
                              <FieldRow
                                key={field.key}
                                field={field}
                                value={getNestedValue(settings, field.key)}
                                onChange={(val) => updateField(field.key, val)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FieldRow({
  field,
  value,
  onChange,
}: {
  field: SettingField;
  value: unknown;
  onChange: (val: unknown) => void;
}) {
  const inputClass =
    "bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-500 transition-colors";

  return (
    <div className="flex items-start justify-between gap-6">
      <div className="flex-1 min-w-0">
        <label className="text-sm text-zinc-200">{field.label}</label>
        <p className="text-xs text-zinc-500 mt-0.5">{field.description}</p>
      </div>
      <div className="shrink-0 w-52">
        {field.type === "select" && (
          <select
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value || undefined)}
            className={`${inputClass} w-full appearance-none`}
          >
            {field.options!.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        )}
        {field.type === "boolean" && (
          <button
            onClick={() => {
              const current = value === true;
              onChange(current ? undefined : true);
            }}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              value === true ? "bg-indigo-600" : "bg-zinc-700"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                value === true ? "translate-x-5" : ""
              }`}
            />
          </button>
        )}
        {field.type === "text" && (
          <input
            type="text"
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value || undefined)}
            placeholder={field.placeholder}
            className={`${inputClass} w-full`}
          />
        )}
        {field.type === "number" && (
          <input
            type="number"
            value={value !== undefined && value !== null ? String(value) : ""}
            onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
            placeholder={field.placeholder}
            className={`${inputClass} w-full`}
          />
        )}
      </div>
    </div>
  );
}
