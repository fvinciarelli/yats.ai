---
name: yats
description: YATS has this codebase indexed in a knowledge graph. Use when asked about the code — how something works, architecture, call chains, where something is defined. Use YATS tools first before reading files.
---

# YATS Code Intelligence

This repo is indexed by YATS (mcp__yats__* tools). Every symbol, call, and relationship is in a knowledge graph.

## Golden rule

**YATS first, Read second.** MCP tools return results in milliseconds for ~100 tokens. Reading files costs thousands of tokens and takes seconds.

## Efficient workflow

1. `search_code` — natural language query about the code. For questions about commands, docs, overview or how the project works: `search_documentation` FIRST — it contains the FULL section text (CLI.md, README.md…). NEVER explore source code (find_symbol/search_code on internals) for a docs question.
2. `find_symbol` on top 2-3 hits to get exact locations
3. `find_callers` / `find_callees` on 1-2 key symbols to trace the flow
4. `expand_graph` on seeds to get the full subgraph in one call
5. Only then `Read` files at the exact lines YATS gave you — at most ONCE per file

## Rules

- MAX 4 YATS tool calls per task. After call 4, answer with what you have.
- Never guess symbol names — always start with `search_code` (or `search_documentation`).
- Prefer `expand_graph` over multiple individual `find_symbol` calls.
- Do NOT re-verify YATS results with grep/cat/sed/find — the graph is already indexed and exact; re-reading files burns thousands of tokens. Never run sed/rg/grep/cat AFTER YATS answered — answer from the results.
- `search_documentation` returns the doc section CONTENT — answer from it, do NOT re-read the file.
- Read a file at most ONCE per task.
- If you need exact line contents, Read only the specific file:line range YATS returned, once.
- If YATS returns empty, try a different query before falling back to file reads.
- Pass `path="__REPO_PATH__"` on EVERY call (including `architecture_summary` and `repository_summary`) — the FULL absolute path (the `rootPath` value from `list_repositories` / `yats list`), never the repo `name`. A value like "abs-bench" is WRONG; the value must start with `/`.

## At startup

Run `yats list` once and check if `__REPO_PATH__` is indexed. If it's not, run:

  yats index __REPO_PATH__

and wait for it to finish. This startup check does NOT count toward the 4-call limit.
