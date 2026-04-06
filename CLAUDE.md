# Gigity — git for AI coding sessions

A CLI for diffing, blaming, searching, and transferring Claude Code sessions stored in `~/.claude`.

## Tech Stack

- **CLI**: oclif + TypeScript (`ggt` command)
- **Database**: SQLite via better-sqlite3 (`~/.claude/gigity.db`)
- **Package manager**: pnpm

## Data Sources

All data comes from `~/.claude/`:

| Source | Path | Format | Key Data |
|---|---|---|---|
| Session transcripts | `projects/{project}/{sessionId}.jsonl` | JSONL | Full conversations, tool calls, token usage |
| Session index | `projects/{project}/sessions-index.json` | JSON | Session summaries, timestamps, message counts |
| Global history | `history.jsonl` | JSONL | Prompt history across all sessions |
| Stats cache | `stats-cache.json` | JSON | Aggregated daily activity, model usage, hour counts |
| Project memories | `projects/{project}/memory/` | Markdown | MEMORY.md index + individual memory files |
| Settings | `settings.json` | JSON | User settings |
| File history | `file-history/{sessionId}/` | Versioned files | File snapshots per session |

## Session JSONL Record Types

- `user` — User prompts, tool results, with fields: message, cwd, gitBranch, timestamp, permissionMode
- `assistant` — Claude responses with: model, usage (input/output/cache tokens), content (text, thinking, tool_use)
- `progress` — Streaming tool execution progress
- `system` — Context compression events, with compactMetadata and durationMs
- `file-history-snapshot` — File state snapshots at message boundaries
- `last-prompt` — Session resume point

## Key Architecture

- **Auto-sync**: DB auto-syncs when stale (>60s) on any `ggt` command. Incremental by file mtime.
- **Diff/Blame**: Extracts Edit/Write tool calls from JSONL transcripts. `file_path` is indexed in `tool_calls` table for fast blame queries. Diff reads JSONL directly for full arguments (old_string/new_string/content).
- **Session export/import**: Bundles JSONL + subagents + tool results + file history + memories + env deps into a `.tar.gz`. Import rewrites paths and offers interactive env setup.
- **Oneshot**: Search → export → import pipeline in one command.

## CLI Commands

| Command | Purpose |
|---|---|
| `ggt diff <id>` | Show file changes (edits/writes) in a session |
| `ggt blame <file>` | Which sessions modified a file |
| `ggt undo <id>` | Restore files to pre-session state |
| `ggt find <query>` | Find session ID by message content |
| `ggt sessions list` | Browse sessions, filter by `--project` |
| `ggt sessions show <id>` | Session details and token usage |
| `ggt sessions export <id>` | Export session bundle |
| `ggt sessions import <archive>` | Import session bundle |
| `ggt messages list <id>` | Read messages from a session |
| `ggt messages search <query>` | Search across sessions |
| `ggt projects list` | List all indexed projects |
| `ggt sql <query>` | Raw SQL escape hatch |
| `ggt sync` | Force a full re-sync |
| `ggt oneshot <query>` | Search → export → import in one step |

All path flags (`--project`, `--from`) resolve `.` to the current directory.

## Rules

- **No co-author**: Never add a `Co-Authored-By` line to git commits.
