---
children_hash: 3c9ef87f12fc7006dd3603e0c616d68393b5097f1349a797c3aee0b0cc7aaae4
compression_ratio: 0.6940298507462687
condensation_order: 2
covers: [context.md, ggt/_index.md]
covers_token_total: 536
summary_level: d2
token_count: 372
type: summary
---
# Project Overview: ggt (Claude Code Session Toolkit)

**Core Purpose**
ggt is a local-first, MIT-licensed toolkit featuring a CLI and web UI designed to transfer Claude Code sessions between machines to ensure reproducibility. It bundles conversation transcripts, tool results, and environment dependencies without external telemetry. (Ref: `ggt_claude_code_session_toolkit.md`, `context.md`)

**Technical Workflow**
The session transfer operates via a linear pipeline: `export` $\rightarrow$ `transfer (.tar.gz)` $\rightarrow$ `import` $\rightarrow$ `resume (claude --resume)`. (Ref: `ggt_claude_code_session_toolkit.md`)

*   **Export Command**: `ggt sessions export <id> -o <output_file>`
*   **Import Command**: `ggt sessions import <input_file> --dest <path>`

**Session Environment Bundling**
To maintain lean transfer packages, ggt bundles only specific artifacts used during the session. (Ref: `session_environment_bundling.md`)

*   **Session State**: Captures transcripts, subagents, tool results, file history, and project memories.
*   **Environment Dependencies**:
    *   **MCP Configs**: Sourced from `.mcp.json` or `~/.claude/config.json` (credentials redacted).
    *   **Skills & Agents**: `.md` files from `.claude/skills/`, `~/.claude/skills/`, `.claude/agents/`, or `~/.claude/agents/`.
    *   **Project Hooks**: Extracted from the `hooks` key in `.claude/settings.json`.
    *   **Plugins**: Captured as requirements for manual installation by the recipient.