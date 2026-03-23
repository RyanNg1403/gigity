# ggt CLI Reference

`ggt` is Gigity's command-line interface for querying Claude Code session data from the terminal. It reads from the same SQLite database (`~/.claude/gigity.db`) as the web UI.

## Installation

```bash
cd gigity
pnpm cli:build && pnpm cli:link
```

## Commands

### `ggt sessions list`

List sessions with optional filters.

```bash
ggt sessions list                                # Recent 20 sessions
ggt sessions list --project=gigity --limit=10    # Filter by project
ggt sessions list --model=opus --after=2026-03-01
ggt sessions list --branch=main --json           # JSON output for piping
```

| Flag | Description |
|------|-------------|
| `--project` | Filter by project path or name (substring match) |
| `--model` | Filter by model name (substring match) |
| `--after` | Sessions created after this date (YYYY-MM-DD) |
| `--before` | Sessions created before this date (YYYY-MM-DD) |
| `--branch` | Filter by git branch |
| `--limit` | Max results (default: 20) |
| `--json` | Output as JSON |

### `ggt sessions show <session-id>`

Show details for a specific session. Supports prefix matching.

```bash
ggt sessions show f81f7a58         # Prefix match
ggt sessions show f81f --json      # JSON output
```

### `ggt sessions export <session-id>`

Export a session as a portable `.tar.gz` bundle for another machine.

```bash
ggt sessions export abc123
ggt sessions export abc123 -o ~/Desktop/handoff.tar.gz
ggt sessions export abc123 --no-file-history    # Smaller bundle
```

The bundle includes:
- Session JSONL (full conversation transcript)
- Subagent transcripts and metadata
- Tool result cache
- File history snapshots
- Project memories (MEMORY.md + files)
- Sessions index entry
- Task files (if any)
- Manifest with export metadata

| Flag | Description |
|------|-------------|
| `-o, --output` | Output file path (default: `session-<id>.tar.gz`) |
| `--no-file-history` | Skip file history snapshots |
| `--no-tool-results` | Skip tool result cache |

### `ggt sessions import <archive>`

Import a session bundle exported from another machine.

```bash
ggt sessions import bundle.tar.gz --project-dir /Users/Team/workspace/gigity
ggt sessions import bundle.tar.gz --project-dir . --note "Focus on the auth refactor"
ggt sessions import bundle.tar.gz --project-dir /path --dry-run
```

On import:
1. All absolute paths in JSONL, subagent transcripts, tool results, and index are rewritten from the source machine's paths to the target machine's paths
2. The project folder under `~/.claude/projects/` is re-encoded for the target path
3. A synthetic handoff message is appended to the JSONL, telling Claude the environment changed
4. Memories are merged (existing files are not overwritten)
5. Sessions index is merged (no duplicate entries)

After import, resume with:
```bash
cd /path/to/project && claude --resume <session-id>
```

| Flag | Description |
|------|-------------|
| `--project-dir` | **(required)** Absolute path to the project on this machine |
| `--note` | Optional note included in the handoff message |
| `--dry-run` | Show what would be done without writing files |

### `ggt messages list <session-id>`

List messages from a session.

```bash
ggt messages list f81f                           # All messages
ggt messages list f81f --type=user               # User messages only
ggt messages list f81f --type=assistant --full    # Full content
ggt messages list f81f --json
```

| Flag | Description |
|------|-------------|
| `--type` | Filter by message type (`user`, `assistant`, `system`) |
| `--full` | Show full message content |
| `--limit` | Max results (default: 50) |
| `--json` | Output as JSON |

### `ggt messages search <query>`

Search across all session messages.

```bash
ggt messages search "authentication"
ggt messages search "bug fix" --project=my-app
ggt messages search "API endpoint" --json
```

| Flag | Description |
|------|-------------|
| `--project` | Filter by project |
| `--limit` | Max results (default: 20) |
| `--json` | Output as JSON |

### `ggt projects list`

List all indexed projects.

```bash
ggt projects list
ggt projects list --json
```

### `ggt sql <query>`

Run a raw SQL query against the Gigity database (read-only).

```bash
ggt sql "SELECT COUNT(*) FROM sessions"
ggt sql "SELECT model_used, COUNT(*) as c FROM sessions GROUP BY model_used ORDER BY c DESC"
ggt sql "SELECT * FROM session_metrics ORDER BY overall_score DESC LIMIT 10"
```

All commands support `--json` for piping to `jq` or other tools.

## Database Schema

The SQLite database at `~/.claude/gigity.db` contains:

| Table | Description |
|-------|-------------|
| `projects` | Indexed projects with names and paths |
| `sessions` | Session metadata, token counts, model, git branch |
| `messages` | Individual messages with token usage |
| `tool_calls` | Tool call records linked to messages |
| `sessions_fts` | FTS5 full-text search index |
| `session_turns` | Turn-by-turn breakdown for effectiveness scoring |
| `session_metrics` | Computed effectiveness scores per session |
| `turn_events` | Turn-level events (success, correction, interruption, error loop) |
| `daily_stats` | Aggregated daily activity from stats-cache |
