# Codex CLI — YATS Setup

Install from your repo root:

```bash
yats connect --install codex
```

This creates/updates:

| File | Purpose |
|------|---------|
| `AGENTS.md` (repo root) | Teaches Codex to use YATS MCP tools directly (no subagents) — golden rule, workflow, call budget |
| `.codex/config.toml` | Connects Codex to the YATS bridge via stdio (`[mcp_servers.yats]`) and forces `multi_agent = false` |

Existing files are never overwritten: `AGENTS.md` gets an appended YATS block
after confirmation, and `config.toml` only gets the `[mcp_servers.yats]`
section added if it isn't there already.

> Note: `yats` must be in your PATH for the stdio bridge to start. Check with `which yats`.

See the full docs at https://github.com/fvinciarelli/yats.ai/tree/main/connect/codex
