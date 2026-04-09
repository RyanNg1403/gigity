# ggt CLI Reference

`ggt` is git for AI coding sessions. It indexes `~/.claude/` into a local SQLite database (`~/.claude/gigity.db`) and provides `diff`, `blame`, `undo`, search, and session transfer commands. Auto-syncs when the DB is older than 60 seconds.

## Installation

```bash
cd gigity
pnpm install && pnpm build && npm link
```

## Commands

### `ggt log <file>`

Show history of a file across all sessions — every change, chronologically.

```bash
ggt log src/lib/db.ts                              # Compact timeline
ggt log src/lib/db.ts --patch                      # With unified diffs
ggt log src/lib/db.ts --explain                    # Motivations (last session)
ggt log src/lib/db.ts --explain --session=dab1f061 # Motivations (specific session)
```

`--explain` traces each edit back through the `parentUuid` chain to show the **user prompt** that triggered it and **Claude's intent** (the assistant text just before the edit).

| Flag | Description |
|------|-------------|
| `--patch` | Show net unified diff for each session |
| `--grep` | Only show sessions where the diff contains this pattern (auto-shows diff) |
| `--explain` | Show edit-by-edit motivations (default: last session) |
| `--session` | Session ID or prefix for `--explain` |
| `--limit` | Max sessions (default: 20) |
| `--json` | Output as JSON (works with `--explain` too) |

### `ggt diff <session-id>`

Show file changes made in a session. Defaults to the last session in the current project if no ID is given.

```bash
ggt diff                         # Last session in current project
ggt diff abc123 --stat           # Summary: files changed, lines +/-
ggt diff --file=db.ts            # Filter to one file
ggt diff abc123 --json           # Machine-readable output
```

| Flag | Description |
|------|-------------|
| `--stat` | Show summary only (files changed, lines added/removed) |
| `--file` | Filter to a specific file path (substring match) |
| `--grep` | Only show diff hunks matching this pattern |
| `--json` | Output as JSON |

### `ggt blame <file>`

Show which sessions modified a file. Supports absolute paths, relative paths, and substring matching.

```bash
ggt blame src/lib/db.ts          # Relative path (resolved from cwd)
ggt blame src/lib/db.ts -L 40,50 # Which session wrote lines 40-50?
ggt blame auth                   # Substring match across all files
ggt blame db.ts --limit=5 --json
```

`-L` reads the current file, extracts those lines, then walks sessions reverse-chronologically to find which one introduced that content — with user prompt and Claude's reasoning.

| Flag | Description |
|------|-------------|
| `-L` | Line range (e.g. `40,50` or `42`). Traces who wrote those lines |
| `--limit` | Max results (default: 20) |
| `--json` | Output as JSON |

### `ggt undo <session-id>`

Restore files to their pre-session state using `~/.claude/file-history/` snapshots. Defaults to the last session in the current project if no ID is given.

```bash
ggt undo --dry-run                   # Preview (last session)
ggt undo                             # Restore all files to pre-session state
ggt undo abc123 --file=src/lib/db.ts # Restore a single file
ggt undo --file=db.ts --dry-run      # Single file preview
```

Files created during the session are deleted. Files that no longer exist are recreated. Use `--dry-run` to preview before applying.

| Flag | Description |
|------|-------------|
| `--dry-run` | Show what would be restored without writing |
| `--file` | Restore a specific file only (substring match) |
| `--json` | Output as JSON |

### `ggt find <query>`

Find session IDs by searching message content. Scopes to the current project by default. Returns session ID, last active timestamp, and project — designed for piping.

```bash
ggt find "fix the auth bug"             # Best match in current project
ggt find "database migration" --limit=5 # Top 5 matches
ggt find "refactor" --all               # Search all projects
ggt diff $(ggt find "auth bug" | awk '{print $1}')  # Pipe into diff
```

| Flag | Description |
|------|-------------|
| `--all` | Search all projects (default: current project only) |
| `--project` | Filter by a specific project (substring match) |
| `--limit` | Max sessions to return (default: 1) |
| `--json` | Output as JSON |

### `ggt cost`

Show token spend and estimated cost. Defaults to current project.

```bash
ggt cost                            # Current project total
ggt cost --all                      # All projects
ggt cost --by=model                 # Breakdown by model
ggt cost --by=day --after=2026-04-01 # Daily spend
ggt cost --by=project --all         # Per-project breakdown
```

Pricing is based on the official Anthropic API rates (per million tokens). Cache write uses 1-hour extended pricing.

| Flag | Description |
|------|-------------|
| `--all` | All projects (default: current project only) |
| `--project` | Filter by project (substring match) |
| `--by` | Group by: `model`, `day`, or `project` |
| `--after` | Sessions after this date (YYYY-MM-DD) |
| `--before` | Sessions before this date (YYYY-MM-DD) |
| `--limit` | Max sessions in top-sessions view (default: 10) |
| `--json` | Output as JSON |

### `ggt sync`

Force a full re-sync of `~/.claude/` into the database. Normally not needed — all commands auto-sync when stale.

```bash
ggt sync
```

### `ggt sessions list`

List sessions with optional filters.

```bash
ggt sessions list                                # Recent 20 sessions
ggt sessions list --project=.                    # Current project only
ggt sessions list --project=gigity --limit=10    # Filter by project
ggt sessions list --model=opus --after=2026-03-01
ggt sessions list --branch=main --json           # JSON output for piping
```

| Flag | Description |
|------|-------------|
| `--project` | Filter by project path or name (substring match, `.` = cwd) |
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

Export a session as a portable `.tar.gz` bundle for another machine. The `.tar.gz` extension is added automatically if missing.

```bash
ggt sessions export abc123
ggt sessions export abc123 -o handoff            # → handoff.tar.gz
ggt sessions export abc123 --no-file-history     # Smaller bundle
```

See [session-export-import.md](session-export-import.md) for full details on what's bundled.

| Flag | Description |
|------|-------------|
| `-o, --output` | Output file path (default: `session-<id>.tar.gz`) |
| `--no-file-history` | Skip file history snapshots |
| `--no-tool-results` | Skip tool result cache |

### `ggt sessions import <archive>`

Import a session bundle exported from another machine.

```bash
ggt sessions import bundle.tar.gz --dest /path/to/project
ggt sessions import bundle.tar.gz --dest . --note "Focus on auth"
ggt sessions import bundle.tar.gz --dest . --yes    # Accept all
```

See [session-export-import.md](session-export-import.md) for full details on the import process.

| Flag | Description |
|------|-------------|
| `--dest` | **(required)** Path to the project on this machine |
| `--note` | Optional note included in the handoff message |
| `--dry-run` | Show what would be done without writing files |
| `-y, --yes` | Accept all bundled environment artifacts without prompting |

### `ggt oneshot <query>`

Search for a message, export its session, and import it into a project — all in one command.

```bash
ggt oneshot "fix the auth bug" -p ../my-app
ggt oneshot "database migration" -p . -f other-project -n migration-handoff
```

| Flag | Description |
|------|-------------|
| `-p, --project` | **(required)** Destination project directory for import |
| `-f, --from` | Project to search in (default: cwd) |
| `-n, --name` | Archive filename without `.tar.gz` (default: `imported-session`) |
| `-y, --yes` | Accept all bundled env artifacts without prompting |
| `--note` | Note to include in the handoff message |

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

Search across all session messages. Exact phrase matches rank first; terms under 3 characters are skipped.

```bash
ggt messages search "authentication"
ggt messages search "bug fix" --project=.        # Current project
ggt messages search "API endpoint" --type=user   # User messages only
```

| Flag | Description |
|------|-------------|
| `--project` | Filter by project (`.` = cwd) |
| `--session` | Search within one session (prefix) |
| `--type` | Filter by message type (`user`, `assistant`) |
| `--limit` | Max results (default: 10) |
| `--json` | Output as JSON |

### `ggt projects list`

List all indexed projects.

```bash
ggt projects list
ggt projects list --json
```

### `ggt sql <query>`

Run a raw SQL query against the database (read-only).

```bash
ggt sql "SELECT COUNT(*) FROM sessions"
ggt sql "SELECT model_used, COUNT(*) as c FROM sessions GROUP BY model_used ORDER BY c DESC"
```

All commands support `--json` for piping to `jq` or other tools.

## Notes

- All path flags (`--project`, `--from`, `--dest`) resolve `.` to the current directory
- Session IDs support prefix matching — use first 4-8 chars instead of the full UUID
- The database auto-syncs when stale (>60s); use `ggt sync` to force it

## Database Schema

The SQLite database at `~/.claude/gigity.db` contains:

| Table | Description |
|-------|-------------|
| `projects` | Indexed projects with names and paths |
| `sessions` | Session metadata, token counts, model, git branch |
| `messages` | Individual messages with token usage |
| `tool_calls` | Tool call records with file paths for Edit/Write |
| `sessions_fts` | FTS5 full-text search index |
| `session_turns` | Turn-by-turn breakdown |
| `session_metrics` | Computed effectiveness scores per session |
| `turn_events` | Turn-level events (success, correction, interruption, error loop) |
| `daily_stats` | Aggregated daily activity from stats-cache |
