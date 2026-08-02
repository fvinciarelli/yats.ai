# Claude Code — YATS Setup

Two files to place:

---

## 1. `SKILL.md` — Agent behavior

**Copy to:** `.claude/skills/yats/SKILL.md` (in each repo you want YATS in)

Teaches Claude to use YATS MCP tools first, before reading files. The skill auto-loads when you ask code questions.

---

## 2. `mcp.json` — Connection config

**Copy to:** `.mcp.json` (repo root) or `~/.claude.json` (global, all repos)

Connects Claude to the YATS bridge via stdio. The bridge forwards MCP calls to the YATS server.

> **Global install:** `~/.claude.json` makes YATS available in ALL your repos.
> **Per-repo:** `.mcp.json` only in repos you choose.

Done.
