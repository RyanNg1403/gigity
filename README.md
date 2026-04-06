# ggt — Claude Code Session Toolkit

<p align="center">
  <img src="logo.png" alt="Gigity" width="180" />
</p>

<p align="center">
  Transfer <a href="https://claude.com/claude-code">Claude Code</a> sessions between machines so a teammate can <code>claude --resume</code> exactly where you left off.
</p>

---

## Install

```bash
git clone https://github.com/RyanNg1403/gigity.git
cd gigity && pnpm install && pnpm build
```

No manual sync needed — the database is built automatically on first use.

## Oneshot: search, export, import

Find a session by what you said in it, export it, and import it into another project — one command:

```bash
ggt oneshot "accept the first three - reject the remaining 3" -p ../byterover-cli
```

| Flag | Description |
|---|---|
| `-p, --project` | **(required)** Destination project directory for import |
| `-f, --from` | Project to search in (default: cwd) |
| `-n, --name` | Archive filename without `.tar.gz` (default: `imported-session`) |
| `-y, --yes` | Accept all bundled env artifacts without prompting |
| `--note` | Note to include in the handoff message |

## Export / Import

```bash
# You: export the session
ggt sessions export abc123 -o handoff

# Teammate: import it
ggt sessions import handoff.tar.gz --project-dir /path/to/project
```

The `.tar.gz` extension is added automatically. The bundle includes the full conversation transcript, subagents, tool results, file history, project memories, and the session's **environment dependencies**:

| Artifact | Bundled how |
|---|---|
| MCP server configs | From `.mcp.json` / `~/.claude/config.json`, **credentials redacted** |
| Skills | `.md` files from `.claude/skills/` or `~/.claude/skills/` |
| Agent definitions | `.md` files from `.claude/agents/` or `~/.claude/agents/` |
| Project hooks | `hooks` key from `.claude/settings.json` |
| Plugins | Listed as requirements (recipient installs separately) |

Only artifacts **actually used in the session** are detected and bundled — nothing extra.

### Interactive setup on import

The recipient chooses what to install:

```
Bundled MCP server configs (2):
  linear-server (stdio: npx)
    ⚠ 1 env var(s) redacted — you'll need to set: LINEAR_API_KEY
  slack (stdio: npx)
Install these MCP server configs? [Y/n]
```

Use `--yes` to accept everything. The handoff message appended to the session tells Claude what was installed and what was declined.

After import, the session appears first in `claude --resume` and you're prompted to launch it immediately.

See [docs/session-export-import.md](docs/session-export-import.md) for the full guide.

## Other commands

```bash
ggt sessions list --project=.          # Sessions in current project
ggt sessions show f81f                 # Session details
ggt messages search "auth bug" --project=. # Search in current project
ggt sync                               # Force a full re-sync
ggt sql "SELECT COUNT(*) FROM sessions" # Raw SQL
```

All path flags (`--project`, `--from`) resolve `.` to the current directory.

The database auto-syncs when stale (>60s). Use `ggt sync` to force it.

See [docs/ggt-cli.md](docs/ggt-cli.md) for the full CLI reference. There's also a [local web UI](docs/web-ui.md) for visual exploration (`pnpm web:dev`).

## Privacy

Everything runs locally. No telemetry, no external requests.

## License

MIT
