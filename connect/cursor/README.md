# Cursor — YATS Setup

Two files to place:

---

## 1. `rules.mdc` — Agent behavior

**Copy to:** `.cursor/rules/yats.mdc` (repo root)

Cursor auto-applies these rules to every session. It tells Cursor to use YATS MCP tools first.

---

## 2. `mcp.json` — Connection config

**Copy to:** `.cursor/mcp.json` (repo root)

Connects Cursor to YATS via HTTP. Cursor talks to the YATS server directly — no bridge needed.

> Cursor uses HTTP transport because it always has access to `localhost`. Make sure YATS is running (`yats status`).

Done.
