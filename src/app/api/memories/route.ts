import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { claudePaths } from "@/lib/claude-paths";
import { getDb } from "@/lib/db";

interface MemoryFile {
  filename: string;
  name: string;
  description: string;
  type: string;
  content: string;
  path: string;
}

function parseMemoryFrontmatter(content: string) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { name: "", description: "", type: "", body: content };

  const frontmatter = match[1];
  const body = match[2];
  const fields: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const [key, ...rest] = line.split(":");
    if (key && rest.length) {
      fields[key.trim()] = rest.join(":").trim();
    }
  }
  return {
    name: fields.name || "",
    description: fields.description || "",
    type: fields.type || "",
    body,
  };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("project");

  if (!projectId) {
    // Return list of projects that have memories, using DB for correct names
    const projectsDir = claudePaths.projects;
    if (!fs.existsSync(projectsDir)) return NextResponse.json({ projects: [] });

    const db = getDb();
    const dirs = fs.readdirSync(projectsDir);
    const withMemories = dirs.filter((d) => {
      const memDir = path.join(projectsDir, d, "memory");
      return fs.existsSync(memDir) && fs.readdirSync(memDir).length > 0;
    }).map((d) => {
      const row = db.prepare("SELECT name, original_path FROM projects WHERE id = ?").get(d) as { name: string; original_path: string } | undefined;
      return {
        id: d,
        name: row?.name || d,
        originalPath: row?.original_path || d,
      };
    });

    return NextResponse.json({ projects: withMemories });
  }

  // Return memories for a specific project
  const memDir = claudePaths.memoryDir(projectId);
  if (!fs.existsSync(memDir)) {
    return NextResponse.json({ memories: [], memoryIndex: null });
  }

  const files = fs.readdirSync(memDir).filter((f) => f.endsWith(".md"));
  const memories: MemoryFile[] = [];
  let memoryIndex: { content: string; path: string } | null = null;

  for (const file of files) {
    const filePath = path.join(memDir, file);
    const content = fs.readFileSync(filePath, "utf-8");

    if (file === "MEMORY.md") {
      memoryIndex = { content, path: filePath };
      continue;
    }

    const parsed = parseMemoryFrontmatter(content);
    memories.push({
      filename: file,
      name: parsed.name || file.replace(".md", ""),
      description: parsed.description,
      type: parsed.type,
      content,
      path: filePath,
    });
  }

  return NextResponse.json({ memories, memoryIndex });
}

/** Resolve a memory file path server-side from projectId + filename, preventing path traversal */
function resolveMemoryPath(projectId: string, filename: string): string | null {
  if (!projectId || !filename || !filename.endsWith(".md")) return null;
  // Block path traversal
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) return null;
  const memDir = claudePaths.memoryDir(projectId);
  const resolved = path.resolve(memDir, filename);
  // Verify resolved path is inside the memory directory
  if (!resolved.startsWith(memDir)) return null;
  return resolved;
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { project, filename, content } = body;

  if (!project || !filename || content === undefined) {
    return NextResponse.json({ error: "project, filename, and content required" }, { status: 400 });
  }

  const filePath = resolveMemoryPath(project, filename);
  if (!filePath) {
    return NextResponse.json({ error: "Invalid project or filename" }, { status: 403 });
  }

  try {
    // Ensure memory directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Atomic write via temp file + rename
    const tmpPath = filePath + ".tmp";
    fs.writeFileSync(tmpPath, content, "utf-8");
    fs.renameSync(tmpPath, filePath);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const { project, filename } = body;

  const filePath = project && filename ? resolveMemoryPath(project, filename) : null;
  if (!filePath) {
    return NextResponse.json({ error: "Invalid project or filename" }, { status: 403 });
  }

  try {
    fs.unlinkSync(filePath);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
