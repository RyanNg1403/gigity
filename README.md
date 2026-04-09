<p align="center">
  <img src="logo.png" alt="ggt" width="160" />
</p>

<h1 align="center">ggt</h1>

<p align="center">
  <strong>git for AI coding sessions</strong><br>
  <code>log</code> · <code>diff</code> · <code>blame</code> · <code>undo</code> · <code>compare</code> · <code>cost</code> · <code>find</code> · <code>export</code><br><br>
  <a href="https://claude.com/claude-code">Claude Code</a> records everything in <code>~/.claude/</code>.<br>
  <code>ggt</code> makes it queryable, diffable, and reversible.
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#commands">Commands</a> ·
  <a href="#workflows">Workflows</a> ·
  <a href="docs/ggt-cli.md">Full Reference</a> ·
  <a href="skills/ggt/SKILL.md">Skill</a>
</p>

---

Every session, every edit, every tool call — indexed into a local SQLite database. Inspect what changed, trace why, revert mistakes, compare approaches, and transfer sessions between projects. All local, no telemetry.

## Install

```bash
git clone https://github.com/RyanNg1403/gigity.git
cd gigity && pnpm install && pnpm build && npm link
```

The database builds automatically on first use. Every command auto-syncs fresh data.

## Commands

### Debug — what changed and why

| Command | Purpose |
|---|---|
| `ggt diff [id]` | Net file changes in a session (first state → final state) |
| `ggt log <file>` | File change history across all sessions |
| `ggt blame <file>` | Which sessions modified a file (with `-L` for specific lines) |
| `ggt undo [id]` | Restore files to pre-session state (with divergence check) |
| `ggt compare <a> <b>` | Diff file changes between two sessions |

### Search — recover compacted context

| Command | Purpose |
|---|---|
| `ggt find <query>` | Find session IDs by message content (returns matched snippet) |
| `ggt messages search <query>` | Search message content across sessions |
| `ggt messages list <id>` | Read messages from a session |

### Analyze

| Command | Purpose |
|---|---|
| `ggt cost` | Token spend and estimated cost (group by model, day, project, branch) |
| `ggt sessions list` | Browse sessions with filters (project, model, branch, date) |
| `ggt sessions show <id>` | Session details and token usage |

### Transfer

| Command | Purpose |
|---|---|
| `ggt oneshot <query>` | Search → export → import in one step |
| `ggt sessions export <id>` | Bundle session + file history + env into `.tar.gz` |
| `ggt sessions import <archive>` | Import bundle, rewrite paths, set up env, resume |

### Utilities

| Command | Purpose |
|---|---|
| `ggt sql <query>` | Raw SQL against the session database |
| `ggt projects list` | All indexed projects |
| `ggt sync` | Force a full re-sync |

All commands support `--json` for structured output and `--no-color` for clean text parsing. Session IDs support prefix matching (first 4-8 chars). Commands default to the **current project and branch**.

## Workflows

### Trace a bug to its source

```bash
ggt blame src/lib/db.ts -L 42          # Who wrote line 42?
ggt log src/lib/db.ts --explain \       # Why was each edit made?
  --session=abc123 --grep=initSchema
```

`blame -L` pinpoints which session introduced specific lines. `log --explain` traces each edit back to the **user prompt** that triggered it and **Claude's reasoning**.

### Understand and revert a session

```bash
ggt diff --stat                         # Summary: files changed, lines +/-
ggt diff --grep=parseConfig             # Only hunks touching parseConfig
ggt undo --dry-run                      # Preview what would be restored
ggt undo --file=src/lib/db.ts           # Restore one file
```

`diff` computes true net diffs from file-history snapshots (first state → final state), not per-edit noise. `undo` checks for post-session divergence before overwriting.

### Compare two approaches

```bash
ggt compare abc123 def456 --stat        # Which attempt touched more files?
ggt compare abc123 def456 --file=db.ts  # How do they differ on one file?
```

### Find lost context after compaction

```bash
ggt find "decided to use Postgres"      # Returns session ID + matched snippet
ggt diff $(ggt find "auth bug" | awk '{print $1}')  # Pipe into diff
```

`find` searches message content and returns the matched text so you can decide whether to drill in — one command instead of two.

### Transfer a session to another project

```bash
ggt oneshot "fix the auth bug" -d ../target-project
```

Finds a session by what you said in it, exports the full bundle (conversation, file history, memories, MCP configs, skills, agents — credentials redacted), and imports it into the target project. `claude --resume` picks up where you left off.

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
