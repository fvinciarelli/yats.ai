# YATS Code Intelligence

This repository is indexed by YATS MCP. You have these tools:
`mcp__yats__search_code`, `mcp__yats__search_documentation`, `mcp__yats__find_symbol`, `mcp__yats__find_callers`, `mcp__yats__find_callees`, `mcp__yats__expand_graph`, `mcp__yats__find_references`, `mcp__yats__find_implementations`, `mcp__yats__find_inheritors`, `mcp__yats__find_routes`, `mcp__yats__repository_summary`, `mcp__yats__architecture_summary`, `mcp__yats__list_repositories`.

## Golden rule

**YATS first, Read second.** MCP tools return results in milliseconds for ~100 tokens. Reading files costs thousands of tokens and takes seconds.

## Efficient workflow

1. `mcp__yats__search_code` — natural language query about the code (or `mcp__yats__search_documentation` for docs/README questions). ALWAYS start here — NEVER start with `mcp__yats__list_repositories`, `mcp__yats__architecture_summary` or `mcp__yats__repository_summary`.
2. `mcp__yats__expand_graph` on top 2-3 symbol ids — full subgraph (callers + callees + neighbors) in ONE call
3. `mcp__yats__find_callers` / `mcp__yats__find_callees` / `mcp__yats__find_references` only for one specific relationship
4. Only then `Read` files at the exact lines YATS gave you — at most ONCE per file

## Rules

- MAX 4 YATS tool calls per task. After call 4, answer with what you have.
- Never guess symbol names — always start with `mcp__yats__search_code` (or `mcp__yats__search_documentation`).
- Prefer `mcp__yats__expand_graph` over multiple individual calls.
- If YATS returns empty, try a different query before falling back to file reads.
- Do NOT use shell commands (`head`, `cat`, `sed`, `rg`, `grep`, `find`, `ls`) to inspect code — YATS has the symbols, relationships AND doc content.
- `mcp__yats__search_documentation` returns the doc section CONTENT — answer from it, do NOT re-read the file.

## Repository

Pass `path="__REPO_PATH__"` on EVERY call (including `architecture_summary` and `repository_summary`) — the FULL absolute path (the `rootPath` value from `list_repositories`), never the repo `name`. A value like "abs-bench" is WRONG; the value must start with `/`.

## At startup

Call `mcp__yats__list_repositories` once to verify `__REPO_PATH__` is indexed. If it's not, tell the user to run:

  yats index __REPO_PATH__

and wait for it to finish. This startup check does NOT count toward the 4-call limit.
