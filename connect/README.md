# Connect your AI agent to YATS

> **Quick start:** run `yats connect` from your repo and pick your agent —
> YATS places the files automatically, without overwriting anything you already have.

```bash
yats connect <agent>            # preview the config for an agent
yats connect --install <agent>  # create/merge the files in the current repo
```

Agents: `claude`, `codex`, `copilot`, `cursor`, `gemini`

---

## What gets installed

| Agent | Instructions → | Config → |
|-------|---------------|----------|
| [Claude Code](./claude/) | `.claude/skills/yats/SKILL.md` | `.mcp.json` |
| [Gemini CLI](./gemini/) | `GEMINI.md` (repo root) | `.gemini/settings.json` |
| [Copilot CLI](./copilot/) | `.github/copilot-instructions.md` | `.copilot/mcp.json` |
| [Codex CLI](./codex/) | `AGENTS.md` (repo root) | `.codex/config.toml` |
| [Cursor](./cursor/) | `.cursor/rules/rules.mdc` | `.cursor/mcp.json` |

The instruction files teach the agent to use YATS tools (`search_code`,
`expand_graph`, …) before reading files; the config files connect it to the
YATS MCP server. Existing files are never overwritten — YATS content is
merged (JSON) or appended (text) after showing you what will be added.

## Quick test

After installing, ask your agent:

> *"What repos are indexed? Use list_repositories."*

If it responds with your repos, YATS is connected.
