---
title: ggt - Claude Code Session Toolkit
summary: ggt is a toolkit for transferring Claude Code sessions between machines, bundling transcripts, tool results, and environment dependencies.
tags: []
keywords: []
importance: 50
recency: 1
maturity: draft
createdAt: '2026-04-05T03:32:21.600Z'
updatedAt: '2026-04-05T03:32:21.600Z'
---
## Reason
Documenting the core purpose and functionality of the ggt project from README.md

## Raw Concept
**Task:**
Document ggt project overview and session transfer mechanism

**Files:**
- README.md
- docs/session-export-import.md
- docs/ggt-cli.md
- docs/web-ui.md

**Flow:**
export session (ggt sessions export) -> transfer bundle (.tar.gz) -> import session (ggt sessions import) -> resume (claude --resume)

**Timestamp:** 2026-04-05

## Narrative
### Structure
A CLI tool and local web UI for managing and transferring Claude Code sessions.

### Highlights
Enables team collaboration by allowing teammates to resume sessions exactly where they left off. Includes intelligent bundling of only used artifacts.

### Rules
1. Export command: ggt sessions export <id> -o <output_file>
2. Import command: ggt sessions import <input_file> --dest <path>

### Examples
Export: ggt sessions export abc123 -o handoff.tar.gz
Import: ggt sessions import handoff.tar.gz --dest /path/to/project

## Facts
- **project_name**: ggt is a Claude Code Session Toolkit [project]
- **core_purpose**: Allows transferring Claude Code sessions between machines [project]
- **bundled_artifacts**: Bundles conversation transcripts, subagents, tool results, file history, project memories, and environment dependencies [project]
- **privacy**: Everything runs locally with no telemetry or external requests [project]
- **license**: License is MIT [project]
