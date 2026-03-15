import path from "path";
import os from "os";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");

export const claudePaths = {
  root: CLAUDE_DIR,
  projects: path.join(CLAUDE_DIR, "projects"),
  history: path.join(CLAUDE_DIR, "history.jsonl"),
  statsCache: path.join(CLAUDE_DIR, "stats-cache.json"),
  settings: path.join(CLAUDE_DIR, "settings.json"),
  plans: path.join(CLAUDE_DIR, "plans"),
  tasks: path.join(CLAUDE_DIR, "tasks"),
  debug: path.join(CLAUDE_DIR, "debug"),
  fileHistory: path.join(CLAUDE_DIR, "file-history"),

  projectDir(encodedName: string) {
    return path.join(CLAUDE_DIR, "projects", encodedName);
  },

  sessionsIndex(encodedName: string) {
    return path.join(CLAUDE_DIR, "projects", encodedName, "sessions-index.json");
  },

  sessionJsonl(encodedName: string, sessionId: string) {
    return path.join(CLAUDE_DIR, "projects", encodedName, `${sessionId}.jsonl`);
  },

  memoryDir(encodedName: string) {
    return path.join(CLAUDE_DIR, "projects", encodedName, "memory");
  },

  /** Decode folder name like "-Users-PhatNguyen-Desktop-gigity" → "/Users/PhatNguyen/Desktop/gigity" */
  decodeFolderName(encoded: string): string {
    // Replace leading dash then convert remaining dashes to slashes
    // But we need to be careful: multi-word folder names use dashes too
    // The encoding replaces "/" with "-", so "-Users-Foo-Bar" → "/Users/Foo/Bar"
    return encoded.replace(/^-/, "/").replace(/-/g, "/");
  },

  /** Extract short project name from encoded folder name */
  shortName(encoded: string): string {
    const parts = encoded.split("-").filter(Boolean);
    return parts[parts.length - 1] || encoded;
  },
};
