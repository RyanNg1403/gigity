import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";

const execFileAsync = promisify(execFile);

interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();

  const session = db.prepare(`
    SELECT s.created_at, s.modified_at, s.git_branch, p.original_path
    FROM sessions s JOIN projects p ON s.project_id = p.id
    WHERE s.id = ?
  `).get(id) as { created_at: string; modified_at: string; git_branch: string; original_path: string } | undefined;

  if (!session || !session.original_path) {
    return NextResponse.json({ commits: [] });
  }

  const repoPath = session.original_path;

  // Verify directory exists and is a git repo
  try {
    const stat = fs.statSync(repoPath);
    if (!stat.isDirectory()) {
      return NextResponse.json({ commits: [] });
    }
    fs.statSync(`${repoPath}/.git`);
  } catch {
    return NextResponse.json({ commits: [] });
  }

  try {
    // Add 1 minute buffer after session end
    const afterDate = session.created_at;
    const beforeDate = session.modified_at
      ? new Date(new Date(session.modified_at).getTime() + 60000).toISOString()
      : undefined;

    const args = [
      "-C", repoPath,
      "log",
      `--after=${afterDate}`,
      ...(beforeDate ? [`--before=${beforeDate}`] : []),
      "--format=%H|%s|%an|%aI",
      "--shortstat",
    ];

    // Filter by branch if available
    if (session.git_branch && session.git_branch !== "HEAD") {
      args.push(session.git_branch);
    } else {
      args.push("--all");
    }

    const { stdout } = await execFileAsync("git", args, { timeout: 10000 });

    const commits: GitCommit[] = [];
    const lines = stdout.trim().split("\n").filter(Boolean);

    let current: Partial<GitCommit> | null = null;
    for (const line of lines) {
      if (line.includes("|")) {
        // Commit line: hash|message|author|date
        if (current?.hash) {
          commits.push({
            hash: current.hash,
            message: current.message || "",
            author: current.author || "",
            date: current.date || "",
            filesChanged: current.filesChanged || 0,
            insertions: current.insertions || 0,
            deletions: current.deletions || 0,
          });
        }
        const [hash, message, author, date] = line.split("|");
        current = { hash, message, author, date, filesChanged: 0, insertions: 0, deletions: 0 };
      } else if (current && line.includes("file")) {
        // Stat line: " 3 files changed, 42 insertions(+), 10 deletions(-)"
        const filesMatch = line.match(/(\d+) files? changed/);
        const insertMatch = line.match(/(\d+) insertions?\(\+\)/);
        const deleteMatch = line.match(/(\d+) deletions?\(-\)/);
        current.filesChanged = filesMatch ? parseInt(filesMatch[1]) : 0;
        current.insertions = insertMatch ? parseInt(insertMatch[1]) : 0;
        current.deletions = deleteMatch ? parseInt(deleteMatch[1]) : 0;
      }
    }

    // Push last commit
    if (current?.hash) {
      commits.push({
        hash: current.hash,
        message: current.message || "",
        author: current.author || "",
        date: current.date || "",
        filesChanged: current.filesChanged || 0,
        insertions: current.insertions || 0,
        deletions: current.deletions || 0,
      });
    }

    return NextResponse.json({ commits });
  } catch {
    return NextResponse.json({ commits: [] });
  }
}
