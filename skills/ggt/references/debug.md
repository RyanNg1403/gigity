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
| `--json` | JSON output (includes `diff` text per file, ANSI-stripped) |

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
ggt log src/lib/db.ts --patch                        # with net unified diffs
ggt log src/lib/db.ts --grep=CREATE                # only sessions where diff matches
ggt log src/lib/db.ts --explain                    # motivations (last session)
ggt log src/lib/db.ts --explain --session=abc123   # motivations (specific session)
ggt log src/lib/db.ts --explain --grep=initSchema  # only edits touching initSchema
ggt log src/lib/db.ts --explain -L 40,50           # only edits affecting lines 40-50
```

| Flag | Description |
|------|-------------|
| `-p, --patch` | Show net unified diff for each session |
| `--grep` | Filter by pattern. In compact/net mode: filters sessions. In `--explain` mode: filters individual edits |
| `--explain` | Edit-by-edit breakdown with user prompt + Claude intent (default: last session) |
| `--session` | Session ID or prefix for `--explain` |
| `-L` | Line range for `--explain` (e.g. `40,50` or `42`). Only show edits affecting those lines |
| `--limit` | Max sessions (default: 20) |
| `--json` | JSON output (works with `--explain` too — returns structured edits with motivations) |

### `--explain` output structure

For each edit in the session:
1. **User** — the user prompt that triggered the edit chain
2. **Claude** — Claude's reasoning text just before making the edit
3. **Diff** — the old_string → new_string change

Net diff is shown at the top, followed by the edit-by-edit breakdown.

### `--explain` filtering

`--grep` and `-L` both narrow which edits are shown, preventing context blowup on sessions with many edits:

- **`--grep=pattern`** — only edits where `old_string` or `new_string` contains the pattern. Also filters net diff hunks.
- **`-L start,end`** — reads the file at those lines, then only shows edits whose `old_string`/`new_string` contains significant content (>4 chars) from those lines. Shows the target lines at the top for context.

Both can be combined. Output shows `(N/M edits)` so you know how many were filtered.

---

## `ggt undo [session-id]`

Restore files to their pre-session state. Defaults to last session in current project.

```bash
ggt undo --dry-run               # preview what would be restored
ggt undo                         # restore all files
ggt undo abc123                  # specific session
ggt undo --file=db.ts            # one file only
ggt undo --file=db.ts --dry-run  # preview one file
ggt undo --force                 # skip divergence check
```

| Flag | Description |
|------|-------------|
| `--dry-run` | Show what would be restored without writing |
| `--file` | Restore a specific file only (substring match) |
| `--force` | Skip divergence check — restore even if the file changed after the session |
| `--json` | JSON output (includes `diverged` field per file) |

Safety:
- **Divergence check:** Before overwriting, compares current file to the session's final snapshot. If the file was modified after the session (by another session, user, or git), the restore is skipped with a warning. Use `--force` to override.
- **Ambiguous prefix:** If a session ID prefix matches multiple sessions, the command errors with a list of matches instead of silently picking one.

Actions:
- Files modified during the session → restored to pre-session state
- Files created during the session → deleted
- Files that no longer exist → recreated from snapshot

Uses `~/.claude/file-history/` snapshots. Works without git.
