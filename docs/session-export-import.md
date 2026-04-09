# Session Export/Import

Transfer Claude Code sessions between machines so a team member can resume where you left off.

## Quick Start

```bash
# On your machine: export the session
ggt sessions export abc123 -o handoff.tar.gz

# Transfer the archive (email, Slack, shared drive, etc.)

# On the team member's machine: import it (interactive setup)
ggt sessions import handoff.tar.gz --dest /Users/Team/workspace/my-project

# Resume the session
cd /Users/Team/workspace/my-project
claude --resume abc123
```

## What's in the bundle

| File | Description |
|------|-------------|
| `{session-id}.jsonl` | Full conversation transcript |
| `subagents/*.jsonl` | Subagent (Explore, Plan, etc.) transcripts |
| `subagents/*.meta.json` | Subagent type metadata |
| `tool-results/*` | Cached tool outputs |
| `file-history/*@v{N}` | File snapshots at each edit |
| `memory/*.md` | Project memories (MEMORY.md + individual files) |
| `sessions-index.json` | Session metadata entry |
| `tasks/*.json` | Task tracking (if any) |
| `environment/mcp/servers.json` | MCP server configs (credentials redacted) |
| `environment/skills/*.md` | Skill definition files |
| `environment/agents/*.md` | Custom agent definition files |
| `manifest.json` | Export metadata, detected requirements, bundled environment list |

## Environment detection

During export, the JSONL transcript is scanned to detect what the session depends on:

| What | How it's detected |
|------|-------------------|
| **MCP servers** | Tool calls named `mcp__<server>__<tool>` |
| **Skills** | `invoked_skills` attachment records in the transcript |
| **Custom agents** | Agent tool calls with a custom `name` field |
| **Subagent types** | Agent tool calls with non-built-in `subagent_type` + `.meta.json` files |
| **Models** | `model` field on assistant message records |

Detected artifacts are collected from the exporter's machine:
- **MCP configs** from `.mcp.json` (project) and `~/.claude/config.json` (user) — credentials are **redacted** (env vars matching `token`, `key`, `secret`, `password`, `auth` are replaced with `<REDACTED>`)
- **Skill files** from `.claude/skills/` and `~/.claude/skills/`
- **Agent definitions** from `.claude/agents/` and `~/.claude/agents/`

## What happens on import

### Interactive environment setup

When the bundle contains environment artifacts, the import command prompts the recipient:

```
  Bundled MCP server configs (2):
    linear-server (stdio: npx)
      ⚠ 1 env var(s) redacted — you'll need to set: LINEAR_API_KEY
    slack (stdio: npx)
      ⚠ 1 env var(s) redacted — you'll need to set: SLACK_BOT_TOKEN
  Install these MCP server configs? [Y/n] y
    Install "linear-server"? [Y/n] y
    Install "slack"? [Y/n] n

  Bundled skill files (1):
    commit (commit.md) — Smart git commit with conventional format
  Install these skills? [Y/n] y

  Bundled agent definitions (1):
    code-reviewer (code-reviewer.md) — Reviews code for bugs and style issues
  Install these agent definitions? [Y/n] y
```

- MCP configs → installed to `.mcp.json` in the project directory
- Skills → installed to `.claude/skills/` in the project directory
- Agents → installed to `.claude/agents/` in the project directory
- Existing files are **never overwritten**

Use `--yes` to accept everything without prompting.

### Path rewriting

All absolute paths in the bundle are rewritten from the source machine to the target machine:

| What | Example |
|------|---------|
| Project directory | `/Users/Alice/code/my-app` → `/Users/Bob/workspace/my-app` |
| Claude data directory | `/Users/Alice/.claude` → `/Users/Bob/.claude` |
| Encoded folder name | `-Users-Alice-code-my-app` → `-Users-Bob-workspace-my-app` |
| Home directory | `/Users/Alice` → `/Users/Bob` |

This covers:
- `cwd` fields in every JSONL record
- File paths in tool call inputs (Read, Edit, Bash, etc.)
- File paths in tool results
- Subagent JSONL records
- Sessions index `fullPath` and `projectPath` fields

### Handoff message

A synthetic user message is appended to the JSONL that reflects what was actually installed:

```
This session was transferred from another machine. Key changes:
- Project directory: /Users/Alice/code/my-app → /Users/Bob/workspace/my-app
- Previous machine: Alice@alices-mac → Bob@bobs-mac
- All absolute paths in the conversation history have been updated.
- Project memories and CLAUDE.md have been preserved.

Environment setup completed by the recipient:
- MCP servers installed: linear-server (added to .mcp.json — credentials may need manual configuration)
- Skills installed: commit.md (placed in .claude/skills/)

The recipient chose NOT to install the following (functionality may be limited):
- MCP servers declined: slack

Continue from where the previous developer left off.
```

When the recipient resumes the session, Claude sees this context and knows exactly what's available and what's missing.

### Memory merging

Memories are copied to the target project's `memory/` directory. Existing files are **not** overwritten — if the recipient already has a memory file with the same name, the imported version is skipped.

### Sessions index merging

If a `sessions-index.json` already exists for the project, the imported session entry is appended without duplicating existing entries.

## Flags

### Export flags

| Flag | Description |
|------|-------------|
| `-o, --output` | Output path (default: `session-<prefix>.tar.gz`) |
| `--no-file-history` | Exclude file snapshots (reduces bundle size) |
| `--no-tool-results` | Exclude tool result cache (reduces bundle size) |

### Import flags

| Flag | Description |
|------|-------------|
| `--dest` | **(required)** Path to the project on the target machine |
| `--note` | Optional note appended to the handoff message |
| `--dry-run` | Preview what would happen without writing anything |
| `-y, --yes` | Accept all bundled environment artifacts without prompting |

## Git state

Claude Code records the git branch name in session records but **does not validate git state on resume**. It doesn't check:
- Whether the branch exists on the new machine
- Whether HEAD matches the original session
- Whether there are uncommitted changes

The recipient just needs the **same repository checked out** — any branch or HEAD works. Being on the same branch is ideal for context continuity but not required.

## Prerequisites

- Both machines need Claude Code installed (`~/.claude/` exists)
- The recipient should have the project repository checked out
- The Gigity CLI (`ggt`) must be installed on both machines
- Run `ggt sessions list` to verify the session exists before exporting

## Credential safety

MCP server credentials are **never** exported. Environment variables matching sensitive patterns (`token`, `key`, `secret`, `password`, `auth`, `credential`) are replaced with `<REDACTED — set your own value>`. The recipient must configure their own credentials after import.

## Limitations

- File history snapshots reference file content by hash, not by path. They are portable as-is.
- The `last-prompt` record in the JSONL is not modified — Claude Code uses the most recent `cwd` when resuming.
- Global history (`~/.claude/history.jsonl`) is not exported — it's user-specific.
- Settings (`~/.claude/settings.json`) are not exported — they're machine-specific.
- MCP servers that couldn't be found on the exporter's machine are listed as requirements but not bundled.
