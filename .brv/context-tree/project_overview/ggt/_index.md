---
children_hash: 1aa5928976a7051c042e5b89f3c9542c37c3a3a9db90e88e245861ecc02ed577
compression_ratio: 0.48239895697522817
condensation_order: 1
covers: [context.md, ggt_claude_code_session_toolkit.md, session_environment_bundling.md]
covers_token_total: 767
summary_level: d1
token_count: 370
type: summary
---
# ggt - Claude Code Session Toolkit

**Overview**
ggt is a local-first, MIT-licensed toolkit providing a CLI and web UI to transfer Claude Code sessions between machines. It ensures session reproducibility by bundling conversation transcripts, tool results, and environment dependencies without external telemetry. (Ref: `ggt_claude_code_session_toolkit.md`, `context.md`)

**Core Workflow & Interface**
The session transfer follows a linear pipeline: `export` $\rightarrow$ `transfer (.tar.gz)` $\rightarrow$ `import` $\rightarrow$ `resume (claude --resume)`. (Ref: `ggt_claude_code_session_toolkit.md`)

*   **Export**: `ggt sessions export <id> -o <output_file>`
*   **Import**: `ggt sessions import <input_file> --dest <path>`

**Session Environment Bundling**
The toolkit intelligently bundles only the artifacts used during a session to maintain a lean transfer package. (Ref: `session_environment_bundling.md`)

*   **Session State**: Includes transcripts, subagents, tool results, file history, and project memories.
*   **Environment Dependencies**:
    *   **MCP Configs**: Sourced from `.mcp.json` or `~/.claude/config.json` (credentials are redacted).
    *   **Skills & Agents**: `.md` files located in `.claude/skills/`, `~/.claude/skills/`, `.claude/agents/`, or `~/.claude/agents/`.
    *   **Project Hooks**: Extracted from the `hooks` key in `.claude/settings.json`.
    *   **Plugins**: Captured as requirements for the recipient to install separately.