# Session Transfer Commands — Full Reference

## `ggt oneshot <query>`

Search → export → import in one command. Finds a session by message content, exports it, and imports into the target project.

```bash
ggt oneshot "fix the auth bug" -p ../my-app
ggt oneshot "database migration" -p . -f other-project -n handoff
ggt oneshot "refactor" -p ../target -y --note "Focus on the auth module"
```

| Flag | Description |
|------|-------------|
| `-p, --project` | **(required)** Destination project directory |
| `-f, --from` | Project to search in (default: cwd) |
| `-n, --name` | Archive filename without `.tar.gz` (default: `imported-session`) |
| `-y, --yes` | Accept all bundled env artifacts without prompting |
| `--note` | Note to include in the handoff message |

---

## `ggt sessions export <id>`

Export a session bundle as `.tar.gz`.

```bash
ggt sessions export abc123
ggt sessions export abc123 -o handoff              # → handoff.tar.gz
ggt sessions export abc123 --no-file-history       # smaller bundle
```

| Flag | Description |
|------|-------------|
| `-o, --output` | Output file path (`.tar.gz` auto-appended) |
| `--no-file-history` | Skip file history snapshots |
| `--no-tool-results` | Skip tool result cache |

### What's bundled

| Artifact | Source |
|----------|--------|
| Conversation transcript | JSONL + subagent JSONLs |
| File history | `~/.claude/file-history/{sessionId}/` |
| Tool results | `~/.claude/tool-results/{sessionId}/` |
| Project memories | MEMORY.md + individual memory files |
| MCP server configs | From `.mcp.json` / `~/.claude/config.json`, **credentials redacted** |
| Skills | `.md` files from `.claude/skills/` or `~/.claude/skills/` |
| Agent definitions | `.md` files from `.claude/agents/` |
| Project hooks | `hooks` key from `.claude/settings.json` |

Only artifacts **actually used in the session** are detected and bundled.

---

## `ggt sessions import <archive>`

Import a session bundle. Rewrites paths, offers interactive env setup.

```bash
ggt sessions import bundle.tar.gz --project-dir /path/to/project
ggt sessions import bundle.tar.gz --project-dir . --yes
ggt sessions import bundle.tar.gz --project-dir . --note "Focus on auth"
ggt sessions import bundle.tar.gz --project-dir . --dry-run
```

| Flag | Description |
|------|-------------|
| `--project-dir` | **(required)** Path to the project on this machine |
| `--note` | Optional note in the handoff message |
| `--dry-run` | Show what would be done without writing |
| `-y, --yes` | Accept all bundled env artifacts without prompting |

After import, the session appears first in `claude --resume`.
