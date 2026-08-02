# Copilot CLI — YATS Setup

Two files to place:

---

## 1. `instructions.md` — Agent behavior

**Copy to:** `.github/copilot-instructions.md` (in your repo root)

Copilot reads this when working in a repo. It tells Copilot to use YATS MCP tools first.

---

## 2. `mcp.json` — Connection config

**Copy to:** `.copilot/mcp-config.json` (in your repo root, or `~/.copilot/` for global)

Connects Copilot to the YATS bridge via stdio.

> **Global install:** Put `mcp.json` in `~/.copilot/mcp-config.json` for all repos.

Done.
