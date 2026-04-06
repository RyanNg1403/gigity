<p align="center">
  <img src="logo.png" alt="ggt" width="160" />
</p>

<h1 align="center">ggt</h1>

<p align="center">
  <strong>git for AI coding sessions</strong><br>
  <code>log</code> · <code>diff</code> · <code>blame</code> · <code>undo</code> · <code>cost</code> · <code>export</code><br><br>
  <a href="https://claude.com/claude-code">Claude Code</a> stores every session as structured data.<br>
  <code>ggt</code> makes it queryable.
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#commands">Commands</a> ·
  <a href="docs/ggt-cli.md">Full Reference</a> ·
  <a href="skills/ggt/SKILL.md">Skill</a>
</p>

---

The name started as a joke — Quagmire's catchphrase. Then I noticed *git* was hiding in *gigity* all along, and the tool I was building turned out to be exactly that: `git diff`, `git blame`, and `git log` — but for what the AI did to your codebase. Claude Code records everything in `~/.claude/`, yet there was no way to inspect, search, or undo any of it. ggt fills that gap.

---

## Install

```bash
git clone https://github.com/RyanNg1403/gigity.git
cd gigity && pnpm install && pnpm build && npm link
```

The database is built automatically on first use. Every command syncs fresh data.

## Commands

### `ggt log` — File history across sessions

```bash
ggt log src/lib/db.ts                     # Compact timeline
ggt log src/lib/db.ts --net             # With net diffs
ggt log src/lib/db.ts --explain           # Why was each edit made? (last session)
```

Shows every change to a file, chronologically. `--explain` traces each edit back to the **user prompt** that triggered it and **Claude's reasoning** — so you can understand not just *what* changed, but *why*.

### `ggt diff` — What did a session change?

```bash
ggt diff                       # Last session in current project
ggt diff abc123 --stat         # Summary: files changed, lines +/-
ggt diff --file=db.ts          # Filter to one file
```

Uses `~/.claude/file-history/` snapshots to compute true net diffs — not per-edit noise.

### `ggt blame` — Who changed this file?

```bash
ggt blame src/lib/db.ts        # Which sessions modified this file
ggt blame auth                 # Substring match across all paths
```

Traces file modifications back to sessions — with timestamps, models, and the prompt that started each one.

### `ggt undo` — Revert a session's changes

```bash
ggt undo --dry-run                   # Preview (last session)
ggt undo                             # Restore all files to pre-session state
ggt undo abc123 --file=db.ts         # Specific session, one file
```

Reads original file snapshots and writes them back. Files created during the session are deleted. Works without git.

### `ggt cost` — How much am I spending?

```bash
ggt cost                             # Current project
ggt cost --all --by=project          # Per-project breakdown
ggt cost --by=day --after=2026-04-01 # Daily trend
ggt cost --by=model                  # Model breakdown
```

Maps token usage to Anthropic API pricing. Covers the full Claude model family.

### `ggt find` — Get a session ID fast

```bash
ggt find "fix the auth bug"          # Best match in current project
ggt find "migration" --all --limit=5 # Search everywhere
ggt diff $(ggt find "auth" | awk '{print $1}')
```

Search by message content, get back session IDs ready to pipe into `diff`, `blame`, or `undo`.

### `ggt oneshot` — Search, export, import in one step

```bash
ggt oneshot "fix the auth bug" -p ../my-app
```

Finds a session by what you said in it, exports the bundle, and imports it into another project. The `.tar.gz` includes the full conversation, file history, memories, and environment dependencies (MCP configs, skills, agents, hooks — credentials redacted).

After import, `claude --resume` picks up exactly where you left off.

### More

```bash
ggt sessions list --project=.          # Browse sessions
ggt sessions show f81f                 # Session details + cost
ggt sessions export abc123 -o handoff  # Export a session bundle
ggt sessions import bundle.tar.gz --project-dir .
ggt messages search "auth" --project=. # Search message content
ggt messages list f81f --type=user     # Read messages
ggt projects list                      # All indexed projects
ggt sql "SELECT COUNT(*) FROM sessions" # Raw SQL
ggt sync                               # Force re-sync
```

See [docs/ggt-cli.md](docs/ggt-cli.md) for the full CLI reference with all flags.

---

<table>
<tr>
<td><strong>Data source</strong></td>
<td><code>~/.claude/</code> — session transcripts, file history, memories, configs</td>
</tr>
<tr>
<td><strong>Storage</strong></td>
<td>SQLite at <code>~/.claude/gigity.db</code>, auto-synced on every command</td>
</tr>
<tr>
<td><strong>Privacy</strong></td>
<td>Everything runs locally. No telemetry, no external requests.</td>
</tr>
<tr>
<td><strong>License</strong></td>
<td>MIT</td>
</tr>
</table>
