# Codex CLI — YATS Setup

Two files to place:

---

## 1. `AGENTS.md` — Agent behavior

**Copy to:** repo root (e.g., `~/my-project/AGENTS.md`)

Codex reads this at session start. It tells Codex to use YATS MCP tools directly (no subagents) and limits MCP calls.

> **Important:** Codex must NOT spawn subagents. `multi_agent = false` in `config.toml` enforces this — subagents don't inherit MCP tools.

---

## 2. `config.toml` — Connection + behavior config

**Copy to:** `.codex/config.toml` (repo root) or `~/.codex/config.toml` (global)

Connects Codex to the YATS bridge via stdio and sets subagent policy.

> Update the `args` path if `yats` is not in your PATH. Use the full path: `which yats`.

Done.
