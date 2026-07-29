# Agent Instructions for YATS

This folder contains orientation files that teach AI coding agents how to use YATS MCP tools efficiently.

Each agent reads instructions differently. Place the appropriate file in your project:

## Agents

| Agent | File | Location | How it works |
|-------|------|----------|--------------|
| **Claude Code** | `SKILL.md` | `.claude/skills/yats/SKILL.md` | Auto-loads when code questions are detected |
| **Codex CLI** | `AGENTS.md` | `AGENTS.md` (repo root) | Loaded automatically at session start |
| **Cursor** | `.cursorrules` | `.cursor/rules/yats.mdc` or `.cursorrules` | Auto-applied to all sessions |

## MCP Configuration

Each agent also needs the MCP server configured:

### Claude Code
```json
// .mcp.json or ~/.claude.json
{
  "mcpServers": {
    "yats": { "type": "sse", "url": "http://localhost:5555/mcp/sse" }
  }
}
```

### Codex CLI
```toml
# .codex/config.toml
[features]
multi_agent = false

[mcp_servers.yats]
command = "node"
args = ["path/to/mcp-bridge-stdio.cjs", "--stdio"]
```

### Cursor
```json
// .cursor/mcp.json
{
  "mcpServers": {
    "yats": { "url": "http://localhost:5555/mcp" }
  }
}
```

## Customizing

The instructions are deliberately minimal — users can add repo-specific rules:

- **Repo name**: Add `repository: "my-repo"` to the workflow section
- **Domain knowledge**: Add a "Key concepts" section with project-specific terminology
- **Tool restrictions**: Add `allowed-tools` in Claude's SKILL.md frontmatter
- **Max calls**: Adjust the limit per agent (Codex: 3, Claude: 5)

## Results

With these instructions + MCP config, Codex CLI showed **73% token reduction** vs reading files directly (100k → 27k tokens for a symbol lookup).
