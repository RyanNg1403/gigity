import { Command, Args, Flags } from "@oclif/core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { getDb } from "../../lib/db.js";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");

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
    const db = getDb();

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
    const outputPath =
      flags.output || `session-${sessionId.slice(0, 8)}.tar.gz`;
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
