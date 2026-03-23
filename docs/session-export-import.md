# Session Export/Import

Transfer Claude Code sessions between machines so a team member can resume where you left off.

## Quick Start

```bash
# On your machine: export the session
ggt sessions export abc123 -o handoff.tar.gz

# Transfer the archive (email, Slack, shared drive, etc.)

# On the team member's machine: import it
ggt sessions import handoff.tar.gz --project-dir /Users/Team/workspace/my-project

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
| `manifest.json` | Export metadata (source machine, paths, timestamp) |

## What happens on import

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

A synthetic user message is appended to the JSONL:

```
This session was transferred from another machine. Key changes:
- Project directory: /Users/Alice/code/my-app → /Users/Bob/workspace/my-app
- Previous machine: Alice@alices-mac → Bob@bobs-mac
- All absolute paths in the conversation history have been updated.
- Project memories and CLAUDE.md have been preserved.
Continue from where the previous developer left off.
```

When the recipient resumes the session, Claude sees this as the last message and immediately understands the context.

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
| `--project-dir` | **(required)** Path to the project on the target machine |
| `--note` | Optional note appended to the handoff message |
| `--dry-run` | Preview what would happen without writing anything |

## Prerequisites

- Both machines need Claude Code installed (`~/.claude/` exists)
- The recipient should have the project repository checked out (same branch ideally)
- The Gigity CLI (`ggt`) must be installed on both machines
- Run `ggt sessions list` to verify the session exists before exporting

## Limitations

- File history snapshots reference file content by hash, not by path. They are portable as-is.
- The `last-prompt` record in the JSONL is not modified — Claude Code uses the most recent `cwd` when resuming.
- Global history (`~/.claude/history.jsonl`) is not exported — it's user-specific.
- Settings (`~/.claude/settings.json`) are not exported — they're machine-specific.
