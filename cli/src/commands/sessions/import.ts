import { Command, Args, Flags } from "@oclif/core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { execSync, spawnSync } from "node:child_process";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");

/**
 * Encode a project path to the folder name Claude Code uses.
 * /Users/Team/workspace/gigity → -Users-Team-workspace-gigity
 */
function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/\//g, "-");
}

/**
 * Replace all occurrences of oldPath with newPath in a string.
 * Also replaces the encoded folder name variant.
 */
function rewritePaths(
  content: string,
  oldProjectPath: string,
  newProjectPath: string,
  oldClaudeDir: string,
  newClaudeDir: string,
  oldProjectFolder: string,
  newProjectFolder: string
): string {
  let result = content;

  // Replace project path (most common: cwd, file paths in tool calls)
  result = result.replaceAll(oldProjectPath, newProjectPath);

  // Replace Claude dir paths (fullPath in sessions-index, tool-result refs)
  result = result.replaceAll(oldClaudeDir, newClaudeDir);

  // Replace encoded project folder names
  result = result.replaceAll(oldProjectFolder, newProjectFolder);

  // Replace old user home path with new (catches any stray /Users/OldUser refs)
  const oldHome = oldProjectPath.split("/").slice(0, 3).join("/"); // /Users/PhatNguyen
  const newHome = os.homedir();
  if (oldHome !== newHome) {
    result = result.replaceAll(oldHome, newHome);
  }

  return result;
}

/**
 * Rewrite all paths in a file (JSONL, JSON, or plain text).
 */
function rewriteFile(
  filePath: string,
  oldProjectPath: string,
  newProjectPath: string,
  oldClaudeDir: string,
  newClaudeDir: string,
  oldProjectFolder: string,
  newProjectFolder: string
): void {
  const content = fs.readFileSync(filePath, "utf-8");
  const rewritten = rewritePaths(
    content,
    oldProjectPath,
    newProjectPath,
    oldClaudeDir,
    newClaudeDir,
    oldProjectFolder,
    newProjectFolder
  );
  if (rewritten !== content) {
    fs.writeFileSync(filePath, rewritten);
  }
}

interface SessionRequirements {
  mcpServers?: string[];
  skills?: { name: string; path: string }[];
  customAgents?: string[];
  subagentTypes?: string[];
  models?: string[];
  plugins?: string[];
  hasProjectHooks?: boolean;
}

interface BundledEnvironment {
  mcpServers?: string[];
  skills?: string[];
  agents?: string[];
  hooks?: boolean;
}

interface EnvDecisions {
  mcpServers: string[];
  skills: string[];
  agents: string[];
  hooks: boolean;
  skippedMcp: string[];
  skippedSkills: string[];
  skippedAgents: string[];
}

/**
 * Prompt the user with a yes/no question. Returns true for yes.
 */
function askYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === "" || a === "y" || a === "yes");
    });
  });
}

/**
 * Interactive environment setup — asks the user what to install.
 */
async function promptEnvironmentSetup(
  bundleDir: string,
  bundledEnv: BundledEnvironment,
  requirements: SessionRequirements
): Promise<EnvDecisions> {
  const decisions: EnvDecisions = {
    mcpServers: [],
    skills: [],
    agents: [],
    hooks: false,
    skippedMcp: [],
    skippedSkills: [],
    skippedAgents: [],
  };

  const envDir = path.join(bundleDir, "environment");

  // MCP servers
  const mcpConfigPath = path.join(envDir, "mcp", "servers.json");
  if (
    fs.existsSync(mcpConfigPath) &&
    (bundledEnv.mcpServers?.length ?? 0) > 0
  ) {
    const mcpJson = JSON.parse(fs.readFileSync(mcpConfigPath, "utf-8"));
    const servers = mcpJson.mcpServers || {};

    console.log(
      `\n  Bundled MCP server configs (${Object.keys(servers).length}):`
    );
    for (const [name, config] of Object.entries(servers)) {
      const cfg = config as Record<string, unknown>;
      const type = cfg.type || "stdio";
      const cmd =
        cfg.command || cfg.url || "(inline config)";
      console.log(`    ${name} (${type}: ${cmd})`);

      // Check if env has redacted values
      if (cfg.env && typeof cfg.env === "object") {
        const redacted = Object.entries(
          cfg.env as Record<string, string>
        ).filter(([, v]) => v.includes("REDACTED"));
        if (redacted.length > 0) {
          console.log(
            `      ⚠ ${redacted.length} env var(s) redacted — you'll need to set: ${redacted.map(([k]) => k).join(", ")}`
          );
        }
      }
    }

    const accept = await askYesNo(
      "  Install these MCP server configs? [Y/n] "
    );
    if (accept) {
      // Ask per-server if there are multiple
      if (Object.keys(servers).length > 1) {
        for (const name of Object.keys(servers)) {
          const serverAccept = await askYesNo(
            `    Install "${name}"? [Y/n] `
          );
          if (serverAccept) {
            decisions.mcpServers.push(name);
          } else {
            decisions.skippedMcp.push(name);
          }
        }
      } else {
        decisions.mcpServers = Object.keys(servers);
      }
    } else {
      decisions.skippedMcp = Object.keys(servers);
    }
  }

  // Skills
  const skillsDir = path.join(envDir, "skills");
  if (fs.existsSync(skillsDir)) {
    const files = fs.readdirSync(skillsDir).filter((f) => f.endsWith(".md"));
    if (files.length > 0) {
      console.log(`\n  Bundled skill files (${files.length}):`);
      for (const f of files) {
        const content = fs.readFileSync(path.join(skillsDir, f), "utf-8");
        const nameMatch = content.match(/^name:\s*(.+)$/m);
        const descMatch = content.match(/^description:\s*(.+)$/m);
        const name = nameMatch?.[1]?.trim() || f;
        const desc = descMatch?.[1]?.trim() || "";
        console.log(`    ${name} (${f})${desc ? ` — ${desc}` : ""}`);
      }

      const accept = await askYesNo(
        "  Install these skills? [Y/n] "
      );
      if (accept) {
        if (files.length > 1) {
          for (const f of files) {
            const skillAccept = await askYesNo(
              `    Install "${f}"? [Y/n] `
            );
            if (skillAccept) {
              decisions.skills.push(f);
            } else {
              decisions.skippedSkills.push(f);
            }
          }
        } else {
          decisions.skills = [...files];
        }
      } else {
        decisions.skippedSkills = [...files];
      }
    }
  }

  // Agents
  const agentsDir = path.join(envDir, "agents");
  if (fs.existsSync(agentsDir)) {
    const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
    if (files.length > 0) {
      console.log(`\n  Bundled agent definitions (${files.length}):`);
      for (const f of files) {
        const content = fs.readFileSync(path.join(agentsDir, f), "utf-8");
        const nameMatch = content.match(/^name:\s*(.+)$/m);
        const descMatch = content.match(/^description:\s*(.+)$/m);
        const name = nameMatch?.[1]?.trim() || f;
        const desc = descMatch?.[1]?.trim() || "";
        console.log(`    ${name} (${f})${desc ? ` — ${desc}` : ""}`);
      }

      const accept = await askYesNo(
        "  Install these agent definitions? [Y/n] "
      );
      if (accept) {
        if (files.length > 1) {
          for (const f of files) {
            const agentAccept = await askYesNo(
              `    Install "${f}"? [Y/n] `
            );
            if (agentAccept) {
              decisions.agents.push(f);
            } else {
              decisions.skippedAgents.push(f);
            }
          }
        } else {
          decisions.agents = [...files];
        }
      } else {
        decisions.skippedAgents = [...files];
      }
    }
  }

  // Hooks
  const hooksFile = path.join(envDir, "hooks", "hooks.json");
  if (fs.existsSync(hooksFile) && bundledEnv.hooks) {
    try {
      const hooksJson = JSON.parse(fs.readFileSync(hooksFile, "utf-8"));
      const eventCount = Object.keys(hooksJson.hooks || {}).length;
      console.log(
        `\n  Bundled project hooks (${eventCount} event${eventCount > 1 ? "s" : ""}):`
      );
      for (const [event, handlers] of Object.entries(hooksJson.hooks || {})) {
        const count = Array.isArray(handlers) ? handlers.length : 0;
        console.log(`    ${event}: ${count} handler${count > 1 ? "s" : ""}`);
      }
      decisions.hooks = await askYesNo(
        "  Install these hooks to .claude/settings.json? [Y/n] "
      );
    } catch {
      decisions.hooks = false;
    }
  }

  // Plugins (informational only)
  if ((requirements.plugins?.length ?? 0) > 0) {
    console.log(
      `\n  Plugins used in the original session:`
    );
    console.log(
      `    ${requirements.plugins!.join(", ")}`
    );
    console.log(
      `    → Install with: /plugin install <name> (inside Claude Code)`
    );
  }

  // Unbundled requirements (detected but not in bundle)
  const unbundledMcp = (requirements.mcpServers || []).filter(
    (s) => !(bundledEnv.mcpServers || []).includes(s)
  );
  if (unbundledMcp.length > 0) {
    console.log(
      `\n  ⚠ MCP servers used but not bundled (not found on exporter's machine):`
    );
    console.log(`    ${unbundledMcp.join(", ")}`);
    console.log(
      `    → You'll need to configure these manually in .mcp.json or ~/.claude/config.json`
    );
  }

  return decisions;
}

/**
 * Install accepted environment artifacts.
 */
function installEnvironment(
  bundleDir: string,
  newProjectPath: string,
  decisions: EnvDecisions,
  log: (msg: string) => void
): void {
  const envDir = path.join(bundleDir, "environment");

  // Install MCP server configs into project .mcp.json
  if (decisions.mcpServers.length > 0) {
    const mcpConfigPath = path.join(envDir, "mcp", "servers.json");
    const mcpJson = JSON.parse(fs.readFileSync(mcpConfigPath, "utf-8"));
    const allServers = mcpJson.mcpServers || {};

    const projectMcpPath = path.join(newProjectPath, ".mcp.json");
    let existingMcp: { mcpServers: Record<string, unknown> } = {
      mcpServers: {},
    };
    if (fs.existsSync(projectMcpPath)) {
      try {
        existingMcp = JSON.parse(fs.readFileSync(projectMcpPath, "utf-8"));
        if (!existingMcp.mcpServers) existingMcp.mcpServers = {};
      } catch {
        // start fresh
      }
    }

    let installed = 0;
    let skipped = 0;
    for (const name of decisions.mcpServers) {
      if (allServers[name]) {
        if (existingMcp.mcpServers[name]) {
          log(`  MCP: ${name} (skipped, already exists in .mcp.json)`);
          skipped++;
        } else {
          existingMcp.mcpServers[name] = allServers[name];
          installed++;
        }
      }
    }

    if (installed > 0) {
      fs.writeFileSync(projectMcpPath, JSON.stringify(existingMcp, null, 2));
      log(
        `  MCP: ${installed} server config(s) added to .mcp.json${skipped > 0 ? `, ${skipped} skipped` : ""}`
      );
    }
  }

  // Install skill files into project .claude/skills/
  if (decisions.skills.length > 0) {
    const skillsSrc = path.join(envDir, "skills");
    const skillsDest = path.join(newProjectPath, ".claude", "skills");
    fs.mkdirSync(skillsDest, { recursive: true });

    for (const f of decisions.skills) {
      const dest = path.join(skillsDest, f);
      if (fs.existsSync(dest)) {
        log(`  Skill: ${f} (skipped, already exists)`);
      } else {
        fs.cpSync(path.join(skillsSrc, f), dest);
        log(`  Skill: ${f} → ${path.relative(newProjectPath, dest)}`);
      }
    }
  }

  // Install agent definitions into project .claude/agents/
  if (decisions.agents.length > 0) {
    const agentsSrc = path.join(envDir, "agents");
    const agentsDest = path.join(newProjectPath, ".claude", "agents");
    fs.mkdirSync(agentsDest, { recursive: true });

    for (const f of decisions.agents) {
      const dest = path.join(agentsDest, f);
      if (fs.existsSync(dest)) {
        log(`  Agent: ${f} (skipped, already exists)`);
      } else {
        fs.cpSync(path.join(agentsSrc, f), dest);
        log(`  Agent: ${f} → ${path.relative(newProjectPath, dest)}`);
      }
    }
  }

  // Install hooks into project .claude/settings.json
  if (decisions.hooks) {
    const hooksSrc = path.join(envDir, "hooks", "hooks.json");
    if (fs.existsSync(hooksSrc)) {
      const destSettingsPath = path.join(
        newProjectPath,
        ".claude",
        "settings.json"
      );
      try {
        const importedHooks = JSON.parse(
          fs.readFileSync(hooksSrc, "utf-8")
        );

        let existingSettings: Record<string, unknown> = {};
        if (fs.existsSync(destSettingsPath)) {
          existingSettings = JSON.parse(
            fs.readFileSync(destSettingsPath, "utf-8")
          );
        }

        if (existingSettings.hooks) {
          log(`  Hooks: skipped (.claude/settings.json already has hooks)`);
        } else {
          existingSettings.hooks = importedHooks.hooks;
          fs.mkdirSync(path.dirname(destSettingsPath), { recursive: true });
          fs.writeFileSync(
            destSettingsPath,
            JSON.stringify(existingSettings, null, 2)
          );
          log(`  Hooks: installed to .claude/settings.json`);
        }
      } catch {
        log(`  Hooks: failed to install`);
      }
    }
  }
}

function buildHandoffMessage(
  _sessionId: string,
  oldProjectPath: string,
  newProjectPath: string,
  oldUser: string,
  newUser: string,
  oldHost: string,
  requirements: SessionRequirements | undefined,
  decisions: EnvDecisions | undefined,
  note?: string
): string {
  const lines = [
    `This session was transferred from another machine. Key changes:`,
    `- Project directory: ${oldProjectPath} → ${newProjectPath}`,
    `- Previous machine: ${oldUser}@${oldHost} → ${newUser}@${os.hostname()}`,
    `- All absolute paths in the conversation history have been updated to reflect the new location.`,
    `- Project memories and CLAUDE.md have been preserved.`,
  ];

  if (decisions) {
    // Report what was installed
    const installed: string[] = [];
    if (decisions.mcpServers.length > 0) {
      installed.push(
        `MCP servers installed: ${decisions.mcpServers.join(", ")} (added to .mcp.json — credentials may need manual configuration)`
      );
    }
    if (decisions.skills.length > 0) {
      installed.push(
        `Skills installed: ${decisions.skills.join(", ")} (placed in .claude/skills/)`
      );
    }
    if (decisions.agents.length > 0) {
      installed.push(
        `Agent definitions installed: ${decisions.agents.join(", ")} (placed in .claude/agents/)`
      );
    }
    if (decisions.hooks) {
      installed.push(
        `Project hooks installed (placed in .claude/settings.json)`
      );
    }

    if (installed.length > 0) {
      lines.push(``, `Environment setup completed by the recipient:`);
      for (const item of installed) {
        lines.push(`- ${item}`);
      }
    }

    // Report what was declined
    const skipped: string[] = [];
    if (decisions.skippedMcp.length > 0) {
      skipped.push(`MCP servers declined: ${decisions.skippedMcp.join(", ")}`);
    }
    if (decisions.skippedSkills.length > 0) {
      skipped.push(`Skills declined: ${decisions.skippedSkills.join(", ")}`);
    }
    if (decisions.skippedAgents.length > 0) {
      skipped.push(
        `Agent definitions declined: ${decisions.skippedAgents.join(", ")}`
      );
    }

    if (skipped.length > 0) {
      lines.push(
        ``,
        `The recipient chose NOT to install the following (functionality may be limited):`
      );
      for (const item of skipped) {
        lines.push(`- ${item}`);
      }
    }
  } else if (requirements) {
    // Legacy: no bundled environment, just list requirements
    const hasReqs =
      (requirements.mcpServers?.length ?? 0) > 0 ||
      (requirements.skills?.length ?? 0) > 0 ||
      (requirements.customAgents?.length ?? 0) > 0 ||
      (requirements.subagentTypes?.length ?? 0) > 0;

    if (hasReqs) {
      lines.push(``, `Environment requirements from the original session:`);
      if (requirements.mcpServers?.length) {
        lines.push(
          `- MCP servers used: ${requirements.mcpServers.join(", ")}. Ensure these are configured in .mcp.json or ~/.claude/config.json.`
        );
      }
      if (requirements.skills?.length) {
        lines.push(
          `- Skills invoked: ${requirements.skills.map((s) => s.name).join(", ")}. Check that matching skill files exist in .claude/skills/ or ~/.claude/skills/.`
        );
      }
      if (requirements.customAgents?.length) {
        lines.push(
          `- Custom agent definitions: ${requirements.customAgents.join(", ")}. Ensure these are defined in .claude/agents/ or ~/.claude/agents/.`
        );
      }
      if (requirements.subagentTypes?.length) {
        lines.push(
          `- Custom subagent types: ${requirements.subagentTypes.join(", ")}. These may require agent definition files.`
        );
      }
    }
  }

  // Add plugin requirements (never bundled, just informational)
  if (requirements?.plugins?.length) {
    lines.push(
      ``,
      `Plugins used in the original session: ${requirements.plugins.join(", ")}. These must be installed separately via /plugin install.`
    );
  }

  lines.push(``, `Continue from where the previous developer left off.`);

  if (note) {
    lines.push("", `Note from the exporter: ${note}`);
  }
  return lines.join("\n");
}

export default class SessionsImport extends Command {
  static override description =
    "Import a session bundle exported from another machine. Rewrites paths, appends a handoff message, and places files in the correct locations under ~/.claude.";

  static override examples = [
    "<%= config.bin %> sessions import session-abc123.tar.gz --project-dir /Users/Team/workspace/gigity",
    '<%= config.bin %> sessions import bundle.tar.gz --project-dir . --note "Focus on the auth refactor"',
    "<%= config.bin %> sessions import bundle.tar.gz --project-dir . --yes",
  ];

  static override args = {
    archive: Args.string({
      description: "Path to the .tar.gz session bundle",
      required: true,
    }),
  };

  static override flags = {
    "project-dir": Flags.string({
      description: "Absolute path to the project on this machine",
      required: true,
    }),
    note: Flags.string({
      description: "Optional note to include in the handoff message",
    }),
    "dry-run": Flags.boolean({
      description: "Show what would be done without writing files",
      default: false,
    }),
    yes: Flags.boolean({
      char: "y",
      description:
        "Accept all bundled environment artifacts without prompting",
      default: false,
    }),
  };

  async run() {
    const { args, flags } = await this.parse(SessionsImport);

    const archivePath = path.resolve(args.archive);
    if (!fs.existsSync(archivePath)) {
      this.error(`Archive not found: ${archivePath}`);
    }

    // Resolve project dir to absolute path
    const newProjectPath = path.resolve(flags["project-dir"]);
    if (!flags["dry-run"] && !fs.existsSync(newProjectPath)) {
      this.error(`Project directory not found: ${newProjectPath}`);
    }

    // Extract to temp dir
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ggt-import-"));
    execSync(`tar -xzf "${archivePath}" -C "${tmpDir}"`, { stdio: "pipe" });

    const bundleDir = path.join(tmpDir, "session-bundle");
    if (!fs.existsSync(bundleDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      this.error("Invalid bundle: missing session-bundle directory");
    }

    // Read manifest
    const manifestPath = path.join(bundleDir, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      this.error("Invalid bundle: missing manifest.json");
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const {
      sessionId,
      projectPath: oldProjectPath,
      projectName,
      exportedBy,
      exportedFrom,
      requirements,
      bundledEnvironment,
    } = manifest as {
      sessionId: string;
      projectPath: string;
      projectName: string;
      exportedBy: string;
      exportedFrom: string;
      requirements?: SessionRequirements;
      bundledEnvironment?: BundledEnvironment;
    };

    this.log(`Importing session ${sessionId}`);
    this.log(
      `  From: ${exportedBy}@${exportedFrom} — ${oldProjectPath}`
    );
    this.log(
      `  To:   ${os.userInfo().username}@${os.hostname()} — ${newProjectPath}`
    );
    this.log(`  Project: ${projectName}`);

    if (requirements?.models?.length) {
      this.log(`  Models used: ${requirements.models.join(", ")}`);
    }

    // Interactive environment setup
    let envDecisions: EnvDecisions | undefined;
    const hasEnvBundle =
      bundledEnvironment &&
      ((bundledEnvironment.mcpServers?.length ?? 0) > 0 ||
        (bundledEnvironment.skills?.length ?? 0) > 0 ||
        (bundledEnvironment.agents?.length ?? 0) > 0 ||
        bundledEnvironment.hooks === true);

    if (hasEnvBundle && !flags["dry-run"]) {
      if (flags.yes) {
        // Auto-accept all
        const envDir = path.join(bundleDir, "environment");
        envDecisions = {
          mcpServers: bundledEnvironment!.mcpServers || [],
          skills: fs.existsSync(path.join(envDir, "skills"))
            ? fs
                .readdirSync(path.join(envDir, "skills"))
                .filter((f) => f.endsWith(".md"))
            : [],
          agents: fs.existsSync(path.join(envDir, "agents"))
            ? fs
                .readdirSync(path.join(envDir, "agents"))
                .filter((f) => f.endsWith(".md"))
            : [],
          hooks: bundledEnvironment!.hooks === true,
          skippedMcp: [],
          skippedSkills: [],
          skippedAgents: [],
        };
      } else {
        envDecisions = await promptEnvironmentSetup(
          bundleDir,
          bundledEnvironment!,
          requirements || {}
        );
      }
    } else if (
      !hasEnvBundle &&
      requirements &&
      !flags["dry-run"]
    ) {
      // Legacy bundle without environment artifacts — just show warnings
      const hasAny =
        (requirements.mcpServers?.length ?? 0) > 0 ||
        (requirements.skills?.length ?? 0) > 0 ||
        (requirements.customAgents?.length ?? 0) > 0 ||
        (requirements.subagentTypes?.length ?? 0) > 0;

      if (hasAny) {
        this.log(`\n  Environment requirements (not bundled):`);
        if (requirements.mcpServers?.length) {
          this.log(
            `    MCP servers: ${requirements.mcpServers.join(", ")}`
          );
        }
        if (requirements.skills?.length) {
          this.log(
            `    Skills: ${requirements.skills.map((s: { name: string }) => s.name).join(", ")}`
          );
        }
        if (requirements.customAgents?.length) {
          this.log(
            `    Custom agents: ${requirements.customAgents.join(", ")}`
          );
        }
        this.log(
          `    → Configure these manually before resuming the session`
        );
      }
    }

    // Compute path mappings
    const oldProjectFolder = encodeProjectPath(oldProjectPath);
    const newProjectFolder = encodeProjectPath(newProjectPath);
    const oldHome = oldProjectPath.split("/").slice(0, 3).join("/");
    const oldClaudeDir = `${oldHome}/.claude`;
    const newClaudeDir = CLAUDE_DIR;

    this.log(`\n  Path rewrite: ${oldProjectPath} → ${newProjectPath}`);
    this.log(
      `  Folder rewrite: ${oldProjectFolder} → ${newProjectFolder}`
    );

    // Target directories
    const targetProjectDir = path.join(
      CLAUDE_DIR,
      "projects",
      newProjectFolder
    );
    const targetSessionSubdir = path.join(targetProjectDir, sessionId);

    // Check if session already exists at the destination
    const destJsonlCheck = path.join(
      targetProjectDir,
      `${sessionId}.jsonl`
    );
    if (!flags["dry-run"] && fs.existsSync(destJsonlCheck)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      this.error(
        `Session ${sessionId} already exists at ${targetProjectDir}.\n` +
          `  To re-import, first remove the existing session:\n` +
          `  rm ${destJsonlCheck}`
      );
    }

    if (flags["dry-run"]) {
      this.log("\n[dry-run] Would create:");
    }

    // Install accepted environment artifacts BEFORE writing JSONL
    // (so the handoff message reflects what was actually installed)
    if (envDecisions && !flags["dry-run"]) {
      this.log("");
      installEnvironment(bundleDir, newProjectPath, envDecisions, (msg) =>
        this.log(msg)
      );
    }

    // 1. Rewrite and place session JSONL
    const jsonlFile = path.join(bundleDir, `${sessionId}.jsonl`);
    if (fs.existsSync(jsonlFile)) {
      rewriteFile(
        jsonlFile,
        oldProjectPath,
        newProjectPath,
        oldClaudeDir,
        newClaudeDir,
        oldProjectFolder,
        newProjectFolder
      );

      // Find the last message's UUID to chain the handoff message
      let lastUuid: string | undefined;
      const jsonlContent = fs.readFileSync(jsonlFile, "utf-8");
      const lines = jsonlContent.split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].trim()) continue;
        try {
          const rec = JSON.parse(lines[i]);
          if (rec.uuid && !rec.isSidechain) {
            lastUuid = rec.uuid;
            break;
          }
        } catch {
          // skip
        }
      }

      // Append handoff message (reflects environment decisions)
      const handoffText = buildHandoffMessage(
        sessionId,
        oldProjectPath,
        newProjectPath,
        exportedBy,
        os.userInfo().username,
        exportedFrom,
        requirements,
        envDecisions,
        flags.note
      );

      const handoffRecord: Record<string, unknown> = {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: handoffText }],
        },
        parentUuid: lastUuid,
        uuid: `handoff-${Date.now()}`,
        timestamp: new Date().toISOString(),
        cwd: newProjectPath,
        sessionId,
        userType: "external",
      };

      fs.appendFileSync(
        jsonlFile,
        "\n" + JSON.stringify(handoffRecord) + "\n"
      );

      const destJsonl = path.join(
        targetProjectDir,
        `${sessionId}.jsonl`
      );
      if (flags["dry-run"]) {
        this.log(`  ${destJsonl}`);
      } else {
        fs.mkdirSync(targetProjectDir, { recursive: true });
        fs.cpSync(jsonlFile, destJsonl);
        this.log(`  JSONL → ${destJsonl}`);
      }
    }

    // 2. Subagents
    const subagentsDir = path.join(bundleDir, "subagents");
    if (fs.existsSync(subagentsDir)) {
      for (const f of fs.readdirSync(subagentsDir)) {
        if (f.endsWith(".jsonl")) {
          rewriteFile(
            path.join(subagentsDir, f),
            oldProjectPath,
            newProjectPath,
            oldClaudeDir,
            newClaudeDir,
            oldProjectFolder,
            newProjectFolder
          );
        }
      }
      const destSubagents = path.join(targetSessionSubdir, "subagents");
      if (flags["dry-run"]) {
        this.log(`  ${destSubagents}/`);
      } else {
        fs.mkdirSync(destSubagents, { recursive: true });
        fs.cpSync(subagentsDir, destSubagents, { recursive: true });
        this.log(`  Subagents → ${destSubagents}`);
      }
    }

    // 3. Tool results
    const toolResultsDir = path.join(bundleDir, "tool-results");
    if (fs.existsSync(toolResultsDir)) {
      for (const f of fs.readdirSync(toolResultsDir)) {
        rewriteFile(
          path.join(toolResultsDir, f),
          oldProjectPath,
          newProjectPath,
          oldClaudeDir,
          newClaudeDir,
          oldProjectFolder,
          newProjectFolder
        );
      }
      const destToolResults = path.join(
        targetSessionSubdir,
        "tool-results"
      );
      if (flags["dry-run"]) {
        this.log(`  ${destToolResults}/`);
      } else {
        fs.mkdirSync(destToolResults, { recursive: true });
        fs.cpSync(toolResultsDir, destToolResults, { recursive: true });
        this.log(`  Tool results → ${destToolResults}`);
      }
    }

    // 4. File history
    const fileHistoryDir = path.join(bundleDir, "file-history");
    if (fs.existsSync(fileHistoryDir)) {
      const destHistory = path.join(
        CLAUDE_DIR,
        "file-history",
        sessionId
      );
      if (flags["dry-run"]) {
        this.log(`  ${destHistory}/`);
      } else {
        fs.mkdirSync(destHistory, { recursive: true });
        fs.cpSync(fileHistoryDir, destHistory, { recursive: true });
        this.log(`  File history → ${destHistory}`);
      }
    }

    // 5. Memories
    const memoryDir = path.join(bundleDir, "memory");
    if (fs.existsSync(memoryDir)) {
      const destMemory = path.join(targetProjectDir, "memory");
      if (flags["dry-run"]) {
        this.log(`  ${destMemory}/`);
      } else {
        fs.mkdirSync(destMemory, { recursive: true });
        for (const f of fs.readdirSync(memoryDir)) {
          const dest = path.join(destMemory, f);
          if (!fs.existsSync(dest)) {
            fs.cpSync(path.join(memoryDir, f), dest);
            this.log(`  Memory: ${f} (new)`);
          } else {
            this.log(`  Memory: ${f} (skipped, already exists)`);
          }
        }
      }
    }

    // 6. Sessions index
    const indexFile = path.join(bundleDir, "sessions-index.json");
    if (fs.existsSync(indexFile)) {
      rewriteFile(
        indexFile,
        oldProjectPath,
        newProjectPath,
        oldClaudeDir,
        newClaudeDir,
        oldProjectFolder,
        newProjectFolder
      );

      const destIndex = path.join(
        targetProjectDir,
        "sessions-index.json"
      );
      if (flags["dry-run"]) {
        this.log(`  ${destIndex}`);
      } else {
        if (fs.existsSync(destIndex)) {
          try {
            const existing = JSON.parse(
              fs.readFileSync(destIndex, "utf-8")
            );
            const incoming = JSON.parse(
              fs.readFileSync(indexFile, "utf-8")
            );
            const existingIds = new Set(
              (existing.entries || []).map(
                (e: { sessionId: string }) => e.sessionId
              )
            );
            for (const entry of incoming.entries || []) {
              if (!existingIds.has(entry.sessionId)) {
                existing.entries.push(entry);
              }
            }
            fs.writeFileSync(
              destIndex,
              JSON.stringify(existing, null, 2)
            );
            this.log(`  Sessions index: merged`);
          } catch {
            fs.cpSync(indexFile, destIndex);
            this.log(`  Sessions index: replaced`);
          }
        } else {
          fs.cpSync(indexFile, destIndex);
          this.log(`  Sessions index: created`);
        }
      }
    }

    // 7. Tasks
    const tasksDir = path.join(bundleDir, "tasks");
    if (fs.existsSync(tasksDir)) {
      const destTasks = path.join(CLAUDE_DIR, "tasks", sessionId);
      if (flags["dry-run"]) {
        this.log(`  ${destTasks}/`);
      } else {
        fs.mkdirSync(destTasks, { recursive: true });
        fs.cpSync(tasksDir, destTasks, { recursive: true });
        this.log(`  Tasks → ${destTasks}`);
      }
    }

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });

    this.log(`\nImport complete.`);

    // Remind about redacted credentials
    if (envDecisions && envDecisions.mcpServers.length > 0) {
      this.log(
        `\n  Note: MCP server credentials were redacted for security.`
      );
      this.log(
        `  Check .mcp.json for "<REDACTED>" values and set your own tokens/keys.`
      );
    }

    if (flags["dry-run"]) {
      this.log(`\nResume with:`);
      this.log(
        `  cd ${newProjectPath} && claude --resume ${sessionId}`
      );
      return;
    }

    // Ask if user wants to resume now
    const resumeNow = flags.yes || await askYesNo(
      `\nResume this session now? [Y/n] `
    );

    if (resumeNow) {
      this.log(`\nLaunching: claude --resume ${sessionId}\n`);
      spawnSync("claude", ["--resume", sessionId], {
        cwd: newProjectPath,
        stdio: "inherit",
      });
    } else {
      this.log(`\nTo resume later:`);
      this.log(
        `  cd ${newProjectPath} && claude --resume ${sessionId}`
      );
    }
  }
}
