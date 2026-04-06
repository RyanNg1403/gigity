import { Command, Args, Flags } from "@oclif/core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { ensureSynced } from "../../lib/auto-sync.js";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");

interface SessionRequirements {
  mcpServers: string[];
  skills: { name: string; path: string }[];
  customAgents: string[];
  subagentTypes: string[];
  models: string[];
  plugins: string[];
  hasProjectHooks: boolean;
}

// Patterns that indicate sensitive values in env vars
const SENSITIVE_PATTERNS =
  /token|key|secret|password|auth|credential|apikey|api_key/i;

/**
 * Sanitize MCP server config by redacting env vars that look like credentials.
 * Keeps the structure intact so recipients know what env vars to set.
 */
function sanitizeMcpConfig(
  config: Record<string, unknown>
): Record<string, unknown> {
  const sanitized = { ...config };
  if (
    sanitized.env &&
    typeof sanitized.env === "object" &&
    !Array.isArray(sanitized.env)
  ) {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(
      sanitized.env as Record<string, string>
    )) {
      if (SENSITIVE_PATTERNS.test(k) || SENSITIVE_PATTERNS.test(String(v))) {
        env[k] = "<REDACTED — set your own value>";
      } else {
        env[k] = v;
      }
    }
    sanitized.env = env;
  }
  return sanitized;
}

/**
 * Collect MCP server configs that were used in the session.
 * Reads from .mcp.json (project-level) and ~/.claude/config.json (user-level).
 */
function collectMcpConfigs(
  projectPath: string,
  serverNames: string[]
): Record<string, Record<string, unknown>> {
  if (serverNames.length === 0) return {};

  const configs: Record<string, Record<string, unknown>> = {};
  const needed = new Set(serverNames);

  // 1. Check project-level .mcp.json
  const projectMcpPath = path.join(projectPath, ".mcp.json");
  if (fs.existsSync(projectMcpPath)) {
    try {
      const mcpJson = JSON.parse(fs.readFileSync(projectMcpPath, "utf-8"));
      const servers = mcpJson.mcpServers || {};
      for (const [name, config] of Object.entries(servers)) {
        if (needed.has(name)) {
          configs[name] = sanitizeMcpConfig(
            config as Record<string, unknown>
          );
          needed.delete(name);
        }
      }
    } catch {
      // skip
    }
  }

  // 2. Check user-level ~/.claude/config.json
  if (needed.size > 0) {
    const userConfigPath = path.join(CLAUDE_DIR, "config.json");
    if (fs.existsSync(userConfigPath)) {
      try {
        const userConfig = JSON.parse(
          fs.readFileSync(userConfigPath, "utf-8")
        );
        const servers = userConfig.mcpServers || {};
        for (const [name, config] of Object.entries(servers)) {
          if (needed.has(name)) {
            configs[name] = sanitizeMcpConfig(
              config as Record<string, unknown>
            );
            needed.delete(name);
          }
        }
      } catch {
        // skip
      }
    }
  }

  return configs;
}

/**
 * Collect skill files that were invoked in the session.
 * Reads from .claude/skills/ (project) and ~/.claude/skills/ (user).
 */
function collectSkillFiles(
  projectPath: string,
  skillNames: string[]
): { name: string; filename: string; content: string }[] {
  if (skillNames.length === 0) return [];

  const skills: { name: string; filename: string; content: string }[] = [];
  const found = new Set<string>();

  const skillDirs = [
    path.join(projectPath, ".claude", "skills"),
    path.join(CLAUDE_DIR, "skills"),
  ];

  for (const dir of skillDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      try {
        const content = fs.readFileSync(path.join(dir, f), "utf-8");
        // Check if this file matches any of the skill names
        // Match by filename (without extension) or by frontmatter name field
        const basename = f.replace(/\.md$/, "");
        const nameMatch = content.match(/^name:\s*(.+)$/m);
        const skillName = nameMatch?.[1]?.trim() || basename;

        for (const needed of skillNames) {
          if (
            !found.has(needed) &&
            (basename === needed ||
              skillName === needed ||
              basename.includes(needed) ||
              needed.includes(basename))
          ) {
            skills.push({ name: skillName, filename: f, content });
            found.add(needed);
          }
        }
      } catch {
        // skip
      }
    }
  }

  return skills;
}

/**
 * Collect custom agent definition files used in the session.
 * Reads from .claude/agents/ (project) and ~/.claude/agents/ (user).
 */
function collectAgentFiles(
  projectPath: string,
  agentNames: string[]
): { name: string; filename: string; content: string }[] {
  if (agentNames.length === 0) return [];

  const agents: { name: string; filename: string; content: string }[] = [];
  const found = new Set<string>();

  const agentDirs = [
    path.join(projectPath, ".claude", "agents"),
    path.join(CLAUDE_DIR, "agents"),
  ];

  for (const dir of agentDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      try {
        const content = fs.readFileSync(path.join(dir, f), "utf-8");
        const basename = f.replace(/\.md$/, "");
        const nameMatch = content.match(/^name:\s*(.+)$/m);
        const agentName = nameMatch?.[1]?.trim() || basename;

        for (const needed of agentNames) {
          if (
            !found.has(needed) &&
            (basename === needed ||
              agentName === needed ||
              basename.includes(needed) ||
              needed.includes(basename))
          ) {
            agents.push({ name: agentName, filename: f, content });
            found.add(needed);
          }
        }
      } catch {
        // skip
      }
    }
  }

  return agents;
}

/**
 * Scan a session JSONL + subagent meta files to detect environment requirements.
 * Detects: MCP servers, invoked skills, custom agent definitions, subagent types, models.
 */
function detectRequirements(
  jsonlPath: string,
  projectPath: string,
  subagentsDir: string | null
): SessionRequirements {
  const mcpServers = new Set<string>();
  const skills = new Map<string, string>(); // name → path
  const customAgents = new Set<string>();
  const subagentTypes = new Set<string>();
  const models = new Set<string>();
  const plugins = new Set<string>();

  // Scan JSONL line by line (avoid loading multi-MB files into a single JSON parse)
  const content = fs.readFileSync(jsonlPath, "utf-8");
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);

      // Detect MCP servers from tool_use blocks: name="mcp__<server>__<tool>"
      if (record.type === "assistant" && record.message?.content) {
        for (const block of record.message.content) {
          if (
            block.type === "tool_use" &&
            typeof block.name === "string"
          ) {
            if (block.name.startsWith("mcp__")) {
              const parts = block.name.split("__");
              if (parts.length >= 3) {
                mcpServers.add(parts[1]);
              }
            }
            // Detect Agent tool with subagent_type or custom name
            if (block.name === "Agent" && block.input) {
              if (block.input.subagent_type) {
                subagentTypes.add(block.input.subagent_type);
              }
              if (block.input.name) {
                customAgents.add(block.input.name);
              }
            }
            // Detect Skill tool invocations: Skill(plugin:name) or Skill(name)
            if (block.name === "Skill" && block.input?.skill) {
              const skillRef = block.input.skill as string;
              if (skillRef.includes(":")) {
                // Plugin-namespaced skill: "plugin-name:skill-name"
                plugins.add(skillRef.split(":")[0]);
              }
            }
          }
        }
        // Detect model
        if (record.message?.model) {
          models.add(record.message.model);
        }
      }

      // Detect invoked skills from attachment records
      if (
        record.type === "attachment" &&
        record.attachment?.type === "invoked_skills"
      ) {
        for (const skill of record.attachment.skills || []) {
          if (skill.name) {
            skills.set(skill.name, skill.path || "");
            // Check if skill name is plugin-namespaced
            if (skill.name.includes(":")) {
              plugins.add(skill.name.split(":")[0]);
            }
          }
        }
      }
    } catch {
      // skip malformed lines
    }
  }

  // Detect project-level hooks
  let hasProjectHooks = false;
  const projectSettingsPath = path.join(projectPath, ".claude", "settings.json");
  if (fs.existsSync(projectSettingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(projectSettingsPath, "utf-8"));
      if (settings.hooks && Object.keys(settings.hooks).length > 0) {
        hasProjectHooks = true;
      }
    } catch {
      // skip
    }
  }

  // Also read subagent .meta.json files for agent types
  if (subagentsDir && fs.existsSync(subagentsDir)) {
    for (const f of fs.readdirSync(subagentsDir)) {
      if (f.endsWith(".meta.json")) {
        try {
          const meta = JSON.parse(
            fs.readFileSync(path.join(subagentsDir, f), "utf-8")
          );
          if (meta.agentType) {
            subagentTypes.add(meta.agentType);
          }
        } catch {
          // skip
        }
      }
    }
  }

  // Filter out built-in subagent types (not something users need to install)
  const builtInTypes = new Set([
    "general-purpose",
    "Explore",
    "Plan",
    "worker",
    "claude-code-guide",
    "statusline-setup",
  ]);
  const customSubagentTypes = [...subagentTypes].filter(
    (t) => !builtInTypes.has(t)
  );

  return {
    mcpServers: [...mcpServers].sort(),
    skills: [...skills.entries()]
      .map(([name, p]) => ({ name, path: p }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    customAgents: [...customAgents].sort(),
    subagentTypes: customSubagentTypes.sort(),
    models: [...models].sort(),
    plugins: [...plugins].sort(),
    hasProjectHooks,
  };
}

export default class SessionsExport extends Command {
  static override description =
    "Export a session bundle for another machine. Packages the session JSONL, subagents, tool results, file history, project memories, and sessions-index into a portable .tar.gz archive.";

  static override examples = [
    "<%= config.bin %> sessions export abc123",
    "<%= config.bin %> sessions export abc123 -o ~/Desktop/handoff.tar.gz",
    "<%= config.bin %> sessions export abc123 --no-file-history",
  ];

  static override args = {
    sessionId: Args.string({
      description: "Session ID (or prefix) to export",
      required: true,
    }),
  };

  static override flags = {
    output: Flags.string({
      char: "o",
      description: "Output file path (default: session-<id>.tar.gz)",
    }),
    "no-file-history": Flags.boolean({
      description: "Skip file-history snapshots (smaller bundle)",
      default: false,
    }),
    "no-tool-results": Flags.boolean({
      description: "Skip tool-results cache (smaller bundle)",
      default: false,
    }),
  };

  async run() {
    const { args, flags } = await this.parse(SessionsExport);
    const db = await ensureSynced((msg) => this.log(msg));

    // Resolve session ID (prefix match)
    const session = db
      .prepare(
        "SELECT s.id, s.project_id, p.original_path, p.name FROM sessions s JOIN projects p ON s.project_id = p.id WHERE s.id LIKE ? LIMIT 2"
      )
      .all(`${args.sessionId}%`) as {
      id: string;
      project_id: string;
      original_path: string;
      name: string;
    }[];

    if (session.length === 0) {
      this.error(`No session found matching "${args.sessionId}"`);
    }
    if (session.length > 1) {
      this.error(
        `Ambiguous prefix "${args.sessionId}" — matches:\n${session.map((s) => `  ${s.id}`).join("\n")}`
      );
    }

    const { id: sessionId, project_id: projectId, original_path: projectPath, name: projectName } = session[0];
    const projectDir = path.join(CLAUDE_DIR, "projects", projectId);

    this.log(`Exporting session ${sessionId}`);
    this.log(`  Project: ${projectName} (${projectPath})`);

    // Create temp staging directory
    const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "ggt-export-"));
    const bundleDir = path.join(stagingDir, "session-bundle");
    fs.mkdirSync(bundleDir);

    // Write manifest
    const manifest = {
      version: 1,
      sessionId,
      projectId,
      projectPath,
      projectName,
      exportedAt: new Date().toISOString(),
      exportedBy: os.userInfo().username,
      exportedFrom: os.hostname(),
    };
    fs.writeFileSync(
      path.join(bundleDir, "manifest.json"),
      JSON.stringify(manifest, null, 2)
    );

    // 1. Session JSONL
    const jsonlPath = path.join(projectDir, `${sessionId}.jsonl`);
    if (!fs.existsSync(jsonlPath)) {
      this.error(`Session JSONL not found: ${jsonlPath}`);
    }
    fs.cpSync(jsonlPath, path.join(bundleDir, `${sessionId}.jsonl`));
    const jsonlSize = fs.statSync(jsonlPath).size;
    this.log(`  JSONL: ${(jsonlSize / 1024).toFixed(0)} KB`);

    // Detect environment requirements from JSONL content
    const subagentsDirForScan = fs.existsSync(
      path.join(projectDir, sessionId, "subagents")
    )
      ? path.join(projectDir, sessionId, "subagents")
      : null;
    const requirements = detectRequirements(jsonlPath, projectPath, subagentsDirForScan);

    // Collect environment artifacts to bundle
    const mcpConfigs = collectMcpConfigs(projectPath, requirements.mcpServers);
    const skillFiles = collectSkillFiles(
      projectPath,
      requirements.skills.map((s) => s.name)
    );
    const agentFiles = collectAgentFiles(projectPath, requirements.customAgents);

    // Bundle environment artifacts
    const envDir = path.join(bundleDir, "environment");
    let envBundled = false;

    if (Object.keys(mcpConfigs).length > 0) {
      fs.mkdirSync(path.join(envDir, "mcp"), { recursive: true });
      fs.writeFileSync(
        path.join(envDir, "mcp", "servers.json"),
        JSON.stringify({ mcpServers: mcpConfigs }, null, 2)
      );
      envBundled = true;
    }

    if (skillFiles.length > 0) {
      fs.mkdirSync(path.join(envDir, "skills"), { recursive: true });
      for (const skill of skillFiles) {
        fs.writeFileSync(path.join(envDir, "skills", skill.filename), skill.content);
      }
      envBundled = true;
    }

    if (agentFiles.length > 0) {
      fs.mkdirSync(path.join(envDir, "agents"), { recursive: true });
      for (const agent of agentFiles) {
        fs.writeFileSync(path.join(envDir, "agents", agent.filename), agent.content);
      }
      envBundled = true;
    }

    // Bundle project-level hooks from .claude/settings.json
    if (requirements.hasProjectHooks) {
      const projectSettingsPath = path.join(projectPath, ".claude", "settings.json");
      try {
        const settings = JSON.parse(fs.readFileSync(projectSettingsPath, "utf-8"));
        if (settings.hooks) {
          fs.mkdirSync(path.join(envDir, "hooks"), { recursive: true });
          fs.writeFileSync(
            path.join(envDir, "hooks", "hooks.json"),
            JSON.stringify({ hooks: settings.hooks }, null, 2)
          );
          envBundled = true;
        }
      } catch {
        // skip
      }
    }

    // Update manifest with requirements
    const fullManifest = {
      ...manifest,
      requirements,
      bundledEnvironment: {
        mcpServers: Object.keys(mcpConfigs),
        skills: skillFiles.map((s) => s.name),
        agents: agentFiles.map((a) => a.name),
        hooks: requirements.hasProjectHooks,
      },
    };
    fs.writeFileSync(
      path.join(bundleDir, "manifest.json"),
      JSON.stringify(fullManifest, null, 2)
    );

    // Log detected requirements and bundled artifacts
    if (requirements.mcpServers.length > 0) {
      const bundled = Object.keys(mcpConfigs);
      const missing = requirements.mcpServers.filter(
        (s) => !bundled.includes(s)
      );
      this.log(
        `  MCP servers: ${requirements.mcpServers.join(", ")}${bundled.length > 0 ? ` (${bundled.length} config${bundled.length > 1 ? "s" : ""} bundled, credentials redacted)` : ""}`
      );
      if (missing.length > 0) {
        this.log(`    Not found locally: ${missing.join(", ")}`);
      }
    }
    if (requirements.skills.length > 0) {
      this.log(
        `  Skills: ${requirements.skills.map((s) => s.name).join(", ")}${skillFiles.length > 0 ? ` (${skillFiles.length} bundled)` : ""}`
      );
    }
    if (requirements.customAgents.length > 0) {
      this.log(
        `  Custom agents: ${requirements.customAgents.join(", ")}${agentFiles.length > 0 ? ` (${agentFiles.length} bundled)` : ""}`
      );
    }
    if (requirements.subagentTypes.length > 0) {
      this.log(
        `  Custom subagent types: ${requirements.subagentTypes.join(", ")}`
      );
    }
    if (requirements.hasProjectHooks) {
      this.log(`  Project hooks: bundled from .claude/settings.json`);
    }
    if (requirements.plugins.length > 0) {
      this.log(
        `  Plugins used: ${requirements.plugins.join(", ")} (recipient must install separately)`
      );
    }
    if (requirements.models.length > 0) {
      this.log(`  Models used: ${requirements.models.join(", ")}`);
    }
    if (envBundled) {
      this.log(`  Environment artifacts bundled for recipient setup`);
    }

    // 2. Subagents + tool results (session subdirectory)
    const sessionSubdir = path.join(projectDir, sessionId);
    let subagentCount = 0;
    let toolResultCount = 0;
    if (fs.existsSync(sessionSubdir)) {
      const subagentsDir = path.join(sessionSubdir, "subagents");
      if (fs.existsSync(subagentsDir)) {
        const destSubagents = path.join(bundleDir, "subagents");
        fs.cpSync(subagentsDir, destSubagents, { recursive: true });
        subagentCount = fs.readdirSync(subagentsDir).filter((f) => f.endsWith(".jsonl")).length;
        this.log(`  Subagents: ${subagentCount}`);
      }

      if (!flags["no-tool-results"]) {
        const toolResultsDir = path.join(sessionSubdir, "tool-results");
        if (fs.existsSync(toolResultsDir)) {
          const destToolResults = path.join(bundleDir, "tool-results");
          fs.cpSync(toolResultsDir, destToolResults, { recursive: true });
          toolResultCount = fs.readdirSync(toolResultsDir).length;
          this.log(`  Tool results: ${toolResultCount}`);
        }
      }
    }

    // 3. File history
    if (!flags["no-file-history"]) {
      const fileHistoryDir = path.join(CLAUDE_DIR, "file-history", sessionId);
      if (fs.existsSync(fileHistoryDir)) {
        const destHistory = path.join(bundleDir, "file-history");
        fs.cpSync(fileHistoryDir, destHistory, { recursive: true });
        const historyCount = fs.readdirSync(fileHistoryDir).length;
        this.log(`  File history: ${historyCount} snapshots`);
      }
    }

    // 4. Project memories
    const memoryDir = path.join(projectDir, "memory");
    if (fs.existsSync(memoryDir)) {
      const destMemory = path.join(bundleDir, "memory");
      fs.cpSync(memoryDir, destMemory, { recursive: true });
      const memCount = fs.readdirSync(memoryDir).filter((f) => f.endsWith(".md")).length;
      this.log(`  Memories: ${memCount} files`);
    }

    // 5. Sessions index (if it exists)
    const indexPath = path.join(projectDir, "sessions-index.json");
    if (fs.existsSync(indexPath)) {
      // Only include the entry for this session
      try {
        const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
        const filteredIndex = {
          ...index,
          entries: (index.entries || []).filter(
            (e: { sessionId: string }) => e.sessionId === sessionId
          ),
        };
        fs.writeFileSync(
          path.join(bundleDir, "sessions-index.json"),
          JSON.stringify(filteredIndex, null, 2)
        );
      } catch {
        // ignore malformed index
      }
    }

    // 6. Tasks (if they exist)
    const tasksDir = path.join(CLAUDE_DIR, "tasks", sessionId);
    if (fs.existsSync(tasksDir)) {
      const destTasks = path.join(bundleDir, "tasks");
      fs.cpSync(tasksDir, destTasks, { recursive: true });
      this.log(`  Tasks: ${fs.readdirSync(tasksDir).length} files`);
    }

    // Create tar.gz
    let outputPath = flags.output || `session-${sessionId.slice(0, 8)}.tar.gz`;
    if (!outputPath.endsWith(".tar.gz")) outputPath += ".tar.gz";
    const absOutput = path.resolve(outputPath);

    execSync(`tar -czf "${absOutput}" -C "${stagingDir}" session-bundle`, {
      stdio: "pipe",
    });

    // Cleanup staging
    fs.rmSync(stagingDir, { recursive: true, force: true });

    const archiveSize = fs.statSync(absOutput).size;
    this.log(`\nExported to: ${absOutput} (${(archiveSize / 1024).toFixed(0)} KB)`);
    this.log(`\nTo import on another machine:`);
    this.log(`  ggt sessions import ${path.basename(absOutput)} --project-dir /path/to/project`);
  }
}
