# Connect your AI agent to YATS

Pick your agent. Each folder has two files:

| | What it is | You copy it to... |
|---|---|---|
| **Instructions file** | Teaches the agent how to use YATS tools | A specific path the agent auto-discovers |
| **Config file** | Connection to YATS MCP server | A specific path the agent needs |

---

| Agent | Transport | Instructions → | Config → |
|-------|-----------|---------------|----------|
| [Claude Code](./claude/) | stdio bridge | `SKILL.md` → `.claude/skills/yats/` | `mcp.json` → `.mcp.json` or `~/.claude.json` |
| [Gemini CLI](./gemini/) | stdio bridge | `GEMINI.md` → repo root | `mcp.json` → `.gemini/settings.json` |
| [Copilot CLI](./copilot/) | stdio bridge | `instructions.md` → `.github/copilot-instructions.md` | `mcp.json` → `.copilot/mcp-config.json` |
| [Codex CLI](./codex/) | stdio bridge | `AGENTS.md` → repo root | `config.toml` → `.codex/config.toml` |
| [Cursor](./cursor/) | HTTP | `rules.mdc` → `.cursor/rules/` | `mcp.json` → `.cursor/mcp.json` |

## Quick test

After placing the files, ask your agent:

> *"What repos are indexed? Use list_repositories."*

If it responds with your repos, YATS is connected.
