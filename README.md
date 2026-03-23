# Gigity — Claude Code Session Observatory

<p align="center">
  <img src="logo.png" alt="Gigity" width="180" />
</p>

<p align="center">
  A local web UI for observing, analyzing, and managing your <a href="https://claude.com/claude-code">Claude Code</a> session data.
</p>

---

Gigity reads the raw data stored in `~/.claude/` — session transcripts, usage stats, project memories, and settings — and presents it through an interactive dashboard. Everything runs locally. Your data never leaves your machine.

## Usage

### Dashboard
Overview stats, daily activity chart, model usage breakdown, top tools, project leaderboard with estimated costs, and a global sync button in the sidebar accessible from any page.

![Dashboard](public/screenshots/dashboard.png)

### Session Browser
Search and filter sessions by project, with metadata badges for model, git branch, message count, and duration.

![Sessions](public/screenshots/sessions.png)

### Session Replay
Full conversation replay with markdown rendering, collapsible thinking blocks, tool call details linked to their results, and a timeline view. In-session search filters to matching messages with keyword highlighting. Text-only mode by default. Session insights (prompt effectiveness, context pressure, git activity) below the transcript.

![Session Detail](public/screenshots/session-detail.png)

### Analytics
Daily token usage trends, daily cost trend, sessions by hour, tool distribution, cost-by-model breakdown, git branch activity, prompt effectiveness score distribution, and daily effectiveness trend.

![Analytics](public/screenshots/analytics.png)

### Settings
Form-based editor for `~/.claude/settings.json` with Common/Advanced grouping, sticky section navigation, dropdowns, toggles, and text inputs. Raw JSON mode with guidance banner.

![Settings](public/screenshots/settings.png)

## Features

| Feature | Description |
|---|---|
| **Session Browser** | Search (FTS5-backed), filter by project, paginated session list with per-session cost |
| **Session Replay** | Full conversation with markdown, thinking blocks, tool calls, tool results linked by ID |
| **In-Session Search** | Filter messages by keyword with highlighting, fixed search bar, auto-scroll to matches |
| **Prompt Effectiveness** | Per-session scoring (0-100) measuring success rate, corrections, interruptions, error loops |
| **Text-Only Mode** | Strip tool calls to see just the human/Claude conversation (default view) |
| **Cost Tracker** | Estimated costs per session, project, model, and day using official Anthropic pricing |
| **Git-Diff Mapping** | Collapsible git activity section in session detail showing commits made during the session |
| **Context Pressure** | Area chart visualizing context window usage per turn with compression event markers |
| **Usage Analytics** | Daily tokens, daily cost trend, peak hours, tool distribution, cost-by-model breakdown, effectiveness trend |
| **Memory Manager** | Browse, edit, and delete project memories with atomic file writes |
| **Settings Editor** | Form UI with Common/Advanced grouping, sticky section nav, raw JSON fallback |
| **Auto-Sync** | 10-second polling with visibility-aware pause, plus manual sync button |
| **Incremental Sync** | SQLite indexing with mtime-based incremental updates (~1s for 100 sessions) |
| **Session Export/Import** | Transfer sessions between machines with full path rewriting and handoff messages |
| **ggt CLI** | Query session history from the terminal — search messages, list sessions, export/import, run raw SQL |

## Quick Start

**Prerequisites:** Node.js 20+, pnpm

```bash
git clone https://github.com/RyanNg1403/gigity.git
cd gigity
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and click **Sync Data** in the sidebar to index your `~/.claude/` sessions.

### CLI (`ggt`)

```bash
pnpm cli:build && pnpm cli:link
```

Query and manage session data from the terminal:

```bash
ggt projects list                                    # List all projects
ggt sessions list --project=my-app --limit=10        # List sessions with filters
ggt sessions show f81f                               # Session details (prefix match)
ggt sessions export abc123 -o handoff.tar.gz         # Export session for handoff
ggt sessions import handoff.tar.gz --project-dir .   # Import on another machine
ggt messages list f81f --type=user --full             # Read messages from a session
ggt messages search "authentication" --project=my-app # Search across sessions
ggt sql "SELECT COUNT(*) FROM sessions"               # Raw SQL escape hatch
```

All commands support `--json` for piping. See [docs/ggt-cli.md](docs/ggt-cli.md) for full reference and [docs/session-export-import.md](docs/session-export-import.md) for the export/import guide.

## Tech Stack

- **Framework:** Next.js 16 (App Router) + TypeScript
- **Database:** SQLite via better-sqlite3 (`~/.claude/gigity.db`)
- **UI:** Tailwind CSS v4 + Lucide icons
- **Charts:** Recharts
- **Markdown:** react-markdown + remark-gfm
- **CLI:** oclif (ggt command)

## Data Sources

All data is read from `~/.claude/`:

| Source | Path | What it provides |
|---|---|---|
| Session transcripts | `projects/{project}/{sessionId}.jsonl` | Full conversations, tool calls, token usage |
| Session index | `projects/{project}/sessions-index.json` | Session summaries, timestamps, message counts |
| Stats cache | `stats-cache.json` | Aggregated daily activity, model usage |
| Project memories | `projects/{project}/memory/` | MEMORY.md index + individual memory files |
| Settings | `settings.json` | User configuration |

## Architecture

- **`POST /api/sync`** — Scans `~/.claude/projects/`, parses JSONL files, populates SQLite + FTS5 index. Atomic per-session transactions. Incremental by file mtime.
- **`GET /api/sessions/[id]`** — Reads JSONL on demand for full conversation replay with compression metadata.
- **`GET /api/sessions/[id]/git`** — Returns git commits made during the session by matching timestamps against the project repo.
- **`GET /api/analytics`** — Aggregated queries from SQLite with cost estimation per model and day.
- **`GET/PUT/DELETE /api/memories`** — Server-side path resolution with traversal protection and atomic writes.
- **`GET/PUT /api/settings`** — Read/write with atomic temp-file swap and backup before overwrite.

## Privacy

Gigity runs entirely on your local machine. No telemetry, no external requests, no data leaves your computer.

## License

MIT
