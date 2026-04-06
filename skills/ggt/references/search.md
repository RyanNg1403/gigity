# Search & Browse Commands — Full Reference

## `ggt find <query>`

Find session IDs by searching message content. Designed for piping into other commands.

```bash
ggt find "fix the auth bug"                        # best match in current project
ggt find "database migration" --all --limit=5      # search all projects
ggt find "refactor" --project=my-app               # specific project
ggt diff $(ggt find "auth bug" | awk '{print $1}') # pipe into diff
```

| Flag | Description |
|------|-------------|
| `--all` | Search all projects (default: current project only) |
| `--project` | Filter by specific project (substring match) |
| `--limit` | Max sessions to return (default: 1) |
| `--json` | JSON output |

Output: `session-id  last-active-timestamp  project-path`

Auto-retries with a forced sync when no results found on first pass.

---

## `ggt messages search <query>`

Search message content across sessions. Exact phrase matches rank first; terms weighted by length.

```bash
ggt messages search "authentication bug" --project=.
ggt messages search "decided to use" --type=assistant --limit=5
ggt messages search "ENOENT" --project=my-app --limit=5
```

| Flag | Description |
|------|-------------|
| `--project` | Restrict to a project (substring, `.` = cwd) |
| `--session` | Search within one session (prefix) |
| `--type` | `user` or `assistant` only |
| `--limit` | Max results (default: 10) |
| `--context` | Lines of context around match (default: 0) |
| `--json` | JSON with score, session_id, msg_index |

Tips:
- Use distinctive terms: function names, error messages, library names
- Terms under 3 characters are skipped
- `--type=user` finds what was asked; `--type=assistant` finds what Claude answered

---

## `ggt sessions list`

Browse sessions with filters.

```bash
ggt sessions list --project=.                      # current project
ggt sessions list --model=opus --after=2026-04-01
ggt sessions list --branch=main --limit=50
```

| Flag | Description |
|------|-------------|
| `--project` | Substring match on project path or name |
| `--model` | Substring match on model ID |
| `--after` | Sessions on or after (YYYY-MM-DD) |
| `--before` | Sessions on or before (YYYY-MM-DD) |
| `--branch` | Exact match on git branch |
| `--limit` | Max results (default: 20) |
| `--json` | JSON output |

---

## `ggt sessions show <id>`

Session details. Prefix matching on ID.

```bash
ggt sessions show f81f
```

Output: project, timestamps, model, message/tool/compression counts, token breakdown, estimated cost, first prompt.

---

## `ggt messages list <session>`

Read messages from a session transcript.

```bash
ggt messages list f81f --type=user --limit=10 --full
ggt messages list f81f --offset=50 --limit=5
```

| Flag | Description |
|------|-------------|
| `--type` | `user`, `assistant`, or `system` |
| `--offset` | Skip first N messages |
| `--limit` | Max messages (default: 20) |
| `--full` | Full content (default: 200-char truncation) |
| `--json` | JSON output |

---

## Workflow: Recover compacted context

```bash
# 1. Search for the topic
ggt messages search "<distinctive-term>" --project=. --limit=5

# 2. Read surrounding messages
ggt messages list <session-prefix> --offset=<msg_index-3> --limit=10 --full
```

## Workflow: Resume previous work

```bash
# 1. Find recent sessions
ggt sessions list --project=. --limit=5

# 2. Read where they stopped
ggt messages list <session-prefix> --type=user --offset=<msg_count-10> --limit=10 --full
```
