# ggt — git for AI coding sessions

<p align="center">
  <img src="logo.png" alt="Gigity" width="180" />
</p>

<p align="center">
  Track, search, diff, and transfer <a href="https://claude.com/claude-code">Claude Code</a> sessions.<br>
  Like <code>git log</code>, <code>git diff</code>, and <code>git blame</code> — but for what the AI did.
</p>

---

## Install

```bash
git clone https://github.com/RyanNg1403/gigity.git
cd gigity && pnpm install && pnpm build && npm link
```

No manual sync needed — the database is built automatically on first use.

## What did that session change?

```bash
ggt diff abc123              # Unified diff of all file changes
ggt diff abc123 --stat       # Summary: files changed, lines added/removed
ggt diff abc123 --file=db.ts # Filter to one file
```

Every `Edit` and `Write` tool call is extracted from the session transcript, matched with its result (rejected changes are excluded), and presented as a diff.

## Who changed this file?

```bash
ggt blame src/lib/db.ts         # Which sessions modified this file
ggt blame auth                  # Substring match across all file paths
ggt blame ./src/lib/db.ts --json
```

Traces file modifications back to the sessions that made them — with timestamps, models, and the prompt that started each session.

## Transfer sessions between machines

```bash
# Oneshot: search → export → import in one command
ggt oneshot "fix the auth bug" -p ../my-app

# Or step by step
ggt sessions export abc123 -o handoff
ggt sessions import handoff.tar.gz --project-dir /path/to/project
```

The `.tar.gz` bundle includes the full conversation, subagents, tool results, file history, project memories, and **environment dependencies** (MCP configs with redacted credentials, skills, agents, hooks). Only artifacts actually used in the session are bundled.

The recipient chooses what to install interactively, or uses `--yes` to accept all. After import, `claude --resume` picks up exactly where you left off.

See [docs/session-export-import.md](docs/session-export-import.md) for the full guide.

## Browse and search

```bash
ggt sessions list --project=.          # Sessions in current project
ggt sessions show f81f                 # Session details + cost
ggt messages search "auth bug" --project=.
ggt sql "SELECT COUNT(*) FROM sessions"
```

All path flags resolve `.` to the current directory. The database auto-syncs when stale (>60s).

See [docs/ggt-cli.md](docs/ggt-cli.md) for the full CLI reference.

## Privacy

Everything runs locally. No telemetry, no external requests.

## License

MIT
