---
children_hash: 3f9edbcf6eb077ef45b31d19efc7f14f8aa41de78f0dcd3885775ce7d5b6608a
compression_ratio: 0.7780320366132724
condensation_order: 3
covers: [project_overview/_index.md]
covers_token_total: 437
summary_level: d3
token_count: 340
type: summary
---
# Project Overview: ggt (Claude Code Session Toolkit)

**Core Purpose**
ggt is a local-first, MIT-licensed toolkit (CLI and Web UI) enabling the transfer of Claude Code sessions between machines to ensure reproducibility. It bundles session state and environment dependencies without external telemetry. (Ref: `ggt_claude_code_session_toolkit.md`, `context.md`)

**Technical Workflow & Commands**
The transfer follows a linear pipeline: `export` $\rightarrow$ `transfer (.tar.gz)` $\rightarrow$ `import` $\rightarrow$ `resume (claude --resume)`. (Ref: `ggt_claude_code_session_toolkit.md`)
*   **Export**: `ggt sessions export <id> -o <output_file>`
*   **Import**: `ggt sessions import <input_file> --dest <path>`

**Session Environment Bundling**
ggt captures specific artifacts to maintain lean transfer packages. (Ref: `session_environment_bundling.md`)
*   **Session State**: Transcripts, subagents, tool results, file history, and project memories.
*   **Environment Dependencies**:
    *   **MCP Configs**: `.mcp.json` or `~/.claude/config.json` (credentials redacted).
    *   **Skills & Agents**: `.md` files from `.claude/skills/`, `~/.claude/skills/`, `.claude/agents/`, or `~/.claude/agents/`.
    *   **Project Hooks**: Extracted from `hooks` in `.claude/settings.json`.
    *   **Plugins**: Captured as requirements for manual installation.