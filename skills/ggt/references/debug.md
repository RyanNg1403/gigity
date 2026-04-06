# Debug Commands — Full Reference

## `ggt diff [session-id]`

Show net file changes in a session. Defaults to last session in current project.

```bash
ggt diff                         # last session
ggt diff abc123                  # specific session
ggt diff --stat                  # summary: files changed, lines +/-
ggt diff --file=db.ts            # filter to one file
ggt diff --grep=initSchema       # only hunks matching pattern
ggt diff --json                  # machine-readable
```

| Flag | Description |
|------|-------------|
| `--stat` | Summary only (files changed, insertions/deletions) |
| `--file` | Filter to a specific file path (substring match) |
| `--grep` | Only show diff hunks where changed lines match this pattern |
| `--json` | JSON output |

Uses `~/.claude/file-history/` snapshots to compute true net diffs (first state → final state). Falls back to per-edit extraction for sessions without file-history.

---

## `ggt blame <file>`

Show which sessions modified a file. Exact path match first, substring fallback scoped to current project.

```bash
ggt blame src/lib/db.ts          # exact file
ggt blame db.ts                  # substring match
ggt blame src/lib/db.ts -L 40,50 # who wrote lines 40-50?
ggt blame src/lib/db.ts -L 42    # single line
ggt blame db.ts --json
```

| Flag | Description |
|------|-------------|
| `-L` | Line range (e.g. `40,50` or `42`). Traces who wrote those lines |
| `--limit` | Max results (default: 20) |
| `--json` | JSON output |

`-L` reads the current file, extracts those lines, walks sessions reverse-chronologically via file-history snapshots, and finds which session introduced that content. Shows user prompt and Claude's reasoning when traceable.

---

## `ggt log <file>`

File change history across all sessions.

```bash
ggt log src/lib/db.ts                              # compact timeline
ggt log src/lib/db.ts --net                        # with net unified diffs
ggt log src/lib/db.ts --grep=CREATE                # only sessions where diff matches
ggt log src/lib/db.ts --explain                    # motivations (last session)
ggt log src/lib/db.ts --explain --session=abc123   # motivations (specific session)
```

| Flag | Description |
|------|-------------|
| `--net` | Show net unified diff for each session |
| `--grep` | Only show sessions where the diff contains this pattern (auto-shows diff) |
| `--explain` | Edit-by-edit breakdown with user prompt + Claude intent (default: last session) |
| `--session` | Session ID or prefix for `--explain` |
| `--limit` | Max sessions (default: 20) |
| `--json` | JSON output |

### `--explain` output structure

For each edit in the session:
1. **User** — the user prompt that triggered the edit chain
2. **Claude** — Claude's reasoning text just before making the edit
3. **Diff** — the old_string → new_string change

Net diff is shown at the top, followed by the edit-by-edit breakdown.

---

## `ggt undo [session-id]`

Restore files to their pre-session state. Defaults to last session in current project.

```bash
ggt undo --dry-run               # preview what would be restored
ggt undo                         # restore all files
ggt undo abc123                  # specific session
ggt undo --file=db.ts            # one file only
ggt undo --file=db.ts --dry-run  # preview one file
```

| Flag | Description |
|------|-------------|
| `--dry-run` | Show what would be restored without writing |
| `--file` | Restore a specific file only (substring match) |
| `--json` | JSON output |

Actions:
- Files modified during the session → restored to pre-session state
- Files created during the session → deleted
- Files that no longer exist → recreated from snapshot

Uses `~/.claude/file-history/` snapshots. Works without git.
