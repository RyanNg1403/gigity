import { Command, Args, Flags } from "@oclif/core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

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

function buildHandoffMessage(
  sessionId: string,
  oldProjectPath: string,
  newProjectPath: string,
  oldUser: string,
  newUser: string,
  oldHost: string,
  note?: string
): string {
  const lines = [
    `This session was transferred from another machine. Key changes:`,
    `- Project directory: ${oldProjectPath} → ${newProjectPath}`,
    `- Previous machine: ${oldUser}@${oldHost} → ${newUser}@${os.hostname()}`,
    `- All absolute paths in the conversation history have been updated to reflect the new location.`,
    `- Project memories and CLAUDE.md have been preserved.`,
    ``,
    `Continue from where the previous developer left off.`,
  ];
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
    } = manifest;

    this.log(`Importing session ${sessionId}`);
    this.log(`  From: ${exportedBy}@${exportedFrom} — ${oldProjectPath}`);
    this.log(`  To:   ${os.userInfo().username}@${os.hostname()} — ${newProjectPath}`);
    this.log(`  Project: ${projectName}`);

    // Compute path mappings
    const oldProjectFolder = encodeProjectPath(oldProjectPath);
    const newProjectFolder = encodeProjectPath(newProjectPath);
    // Derive old ~/.claude from old project path
    const oldHome = oldProjectPath.split("/").slice(0, 3).join("/");
    const oldClaudeDir = `${oldHome}/.claude`;
    const newClaudeDir = CLAUDE_DIR;

    this.log(`\n  Path rewrite: ${oldProjectPath} → ${newProjectPath}`);
    this.log(`  Folder rewrite: ${oldProjectFolder} → ${newProjectFolder}`);

    if (flags["dry-run"]) {
      this.log("\n[dry-run] Would create:");
    }

    // Target directories
    const targetProjectDir = path.join(CLAUDE_DIR, "projects", newProjectFolder);
    const targetSessionSubdir = path.join(targetProjectDir, sessionId);

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

      // Append handoff message
      const handoffText = buildHandoffMessage(
        sessionId,
        oldProjectPath,
        newProjectPath,
        exportedBy,
        os.userInfo().username,
        exportedFrom,
        flags.note
      );

      const handoffRecord = {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: handoffText }],
        },
        uuid: `handoff-${Date.now()}`,
        timestamp: new Date().toISOString(),
        cwd: newProjectPath,
        sessionId,
        userType: "external",
      };

      fs.appendFileSync(jsonlFile, "\n" + JSON.stringify(handoffRecord) + "\n");

      const destJsonl = path.join(targetProjectDir, `${sessionId}.jsonl`);
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
      // Rewrite paths in subagent JSONL files
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
      // Rewrite paths in tool result text files
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
      const destToolResults = path.join(targetSessionSubdir, "tool-results");
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
      const destHistory = path.join(CLAUDE_DIR, "file-history", sessionId);
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
        // Don't overwrite existing memories — merge
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

      const destIndex = path.join(targetProjectDir, "sessions-index.json");
      if (flags["dry-run"]) {
        this.log(`  ${destIndex}`);
      } else {
        // Merge into existing index if it exists
        if (fs.existsSync(destIndex)) {
          try {
            const existing = JSON.parse(fs.readFileSync(destIndex, "utf-8"));
            const incoming = JSON.parse(fs.readFileSync(indexFile, "utf-8"));
            const existingIds = new Set(
              (existing.entries || []).map((e: { sessionId: string }) => e.sessionId)
            );
            for (const entry of incoming.entries || []) {
              if (!existingIds.has(entry.sessionId)) {
                existing.entries.push(entry);
              }
            }
            fs.writeFileSync(destIndex, JSON.stringify(existing, null, 2));
            this.log(`  Sessions index: merged`);
          } catch {
            // If merge fails, write the new one
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

    this.log(`\nImport complete. Resume with:`);
    this.log(`  cd ${newProjectPath} && claude --resume ${sessionId}`);
  }
}
