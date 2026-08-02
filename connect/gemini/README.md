# Gemini CLI — YATS Setup

Two files to place:

---

## 1. `GEMINI.md` — Agent behavior

**Copy to:** repo root (e.g., `~/my-project/GEMINI.md`)

Gemini reads this automatically when you open a repo. It tells Gemini to use YATS MCP tools first, before reading files.

---

## 2. `mcp.json` — Connection config

**Copy to:** `.gemini/settings.json` (in your repo root)

Connects Gemini to the YATS bridge via stdio. Also set the env var:

```bash
export GEMINI_CLI_TRUST_WORKSPACE=true   # add to ~/.bashrc or ~/.zshrc
```

> Without `GEMINI_CLI_TRUST_WORKSPACE=true`, Gemini will ask permission for every MCP tool call.

Done.
