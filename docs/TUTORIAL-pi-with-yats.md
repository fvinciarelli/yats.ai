# Tutorial: YATS on this repo, consumed by pi

How this repository is indexed by YATS and how pi (the agent used to develop
YATS itself) consumes that index. Dogfooding setup — adapt paths to your
machine.

## 0. Prerequisites

- The YATS stack is running: `docker compose -f ~/.yats/docker-compose.yml up -d`
  (health check: `curl http://localhost:5555/health`).
- The `yats` CLI is available (npm `yats-toolkit`, or a symlink to
  `packages/yats-toolkit` when developing).

## 1. Per-repo filters — `.yats/config.json`

Create `.yats/config.json` at the repo root (committed, so every agent
indexing this repo gets the same filters):

```json
{
  "ignoredDirs": ["test_repo", "artifacts"]
}
```

What you do **not** need to configure:

- `node_modules` — skipped by default at any depth (built-in ignore list:
  `node_modules`, `dist`, `build`, `.next`, `__pycache__`, `vendor`, `target`,
  `bin`, `obj`, `.venv`, `venv`, `.yarn`, `.pnpm`, `.git`).
- Dotfiles and dot-directories (`.yats/`, `.pi/`, `.git/`) — never indexed.

Available keys (all optional): `indexDocs` (false = no docs for this repo),
`docExtensions` (replaces the machine list), `docPatterns` (whitelist of doc
files, prefix match), `ignoredDirs` + `skipExtensions` (added to the machine
config). A repo can only narrow, never widen, the machine config. A malformed
config **stops the run** with fix instructions instead of indexing with broken
filters — see `docs/SPIKE-per-repo-config.md`.

## 2. Initial index

```bash
yats index /path/to/code_indexer
```

Walks the repo (minus ignored dirs) and sends every code file plus doc files
(`.md`, `.mdx`, `.rst`, …) to the server. Verify with `yats summary
code_indexer` and a search:

```bash
yats search "synchronize file symbols"
```

## 3. Live updates — `yats watch`

```bash
yats watch /path/to/code_indexer        # commit-based: polls HEAD every ~2s
yats watch /path/to/code_indexer --live # adds save-based indexing on top
```

`yats index` records the current commit, so watch diffs from there. It applies
the same `.yats/config.json` filters (same stop-on-malformed-config behavior)
and gains `--no-config` to bypass the repo config for one run. Run it under
`nohup`/systemd for a permanent background sync.

## 4. Wire pi (local, gitignored)

`.pi/` is in `.gitignore` — these two files are machine-local.

### 4a. `.pi/mcp.json` — expose the MCP server

```json
{
  "mcpServers": {
    "yats": { "url": "http://localhost:5555/mcp", "lifecycle": "lazy" }
  }
}
```

Takes effect on the next pi session. The server also exposes `/mcp/sse`.

### 4b. `.pi/APPEND_SYSTEM.md` — YATS-first instructions

pi loads it automatically (appended to the system prompt). It tells the agent
to answer with the `yats` tools first (`search_code`, `find_symbol`,
`find_callers`, `find_callees`, `expand_graph`, `find_references`,
`find_implementations`, `find_inheritors`, `find_routes`,
`repository_summary`, `architecture_summary`) and to read files only when the
index cannot answer. `AGENTS.md` carries the same rule for every other agent
(Claude Code, Cursor, …) — see `connect/` to install their configs.

## 5. Verify

In a pi session ask something like "who calls `synchronizeFileSymbols`?" — the
agent should call `find_callers` and answer from the index without grepping.
If a YATS tool returns nothing, the watch may be stale (or the file is
excluded — see step 1).
