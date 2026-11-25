# YATS Code Intelligence

This repository is indexed by YATS MCP. You have these tools:
`search_code`, `search_documentation`, `find_symbol`, `find_callers`, `find_callees`, `expand_graph`,
`find_references`, `find_implementations`, `find_inheritors`, `find_routes`,
`repository_summary`, `architecture_summary`, `list_repositories`.

## Golden rule

**YATS first, Read second.** MCP tools return results in milliseconds for ~100 tokens. Reading files costs thousands of tokens and takes seconds.

## Efficient workflow

1. `search_code` — natural language query about the code (or `search_documentation` for docs/README questions). ALWAYS start here — NEVER start with `list_repositories`, `architecture_summary` or `repository_summary`.
2. `expand_graph` on top 2-3 symbol ids — full subgraph (callers + callees + neighbors) in ONE call
3. `find_callers` / `find_callees` / `find_references` only for one specific relationship
4. Only then `Read` files at the exact lines YATS gave you

## Rules

- MAX 4 YATS tool calls per task. After call 4, answer with what you have.
- Never guess symbol names — always start with `search_code` (or `search_documentation`).
- Prefer `expand_graph` over multiple individual calls.
- If YATS returns empty, try a different query before falling back to file reads.
- Do NOT use shell commands (`head`, `cat`, `sed`, `rg`, `grep`, `find`, `ls`) to inspect code — YATS has the symbols, relationships AND doc content. They re-read files YATS already indexed and burn thousands of tokens.
- Do NOT re-check the repo with `ls`/`find` after YATS answered — answer with what you have.
- `search_documentation` returns the doc section CONTENT — answer from it, do NOT re-read the file.

## Repository

Pass `path="__REPO_PATH__"` on EVERY call (including `architecture_summary` and `repository_summary`) — the FULL absolute path (the `rootPath` value from `list_repositories`), never the repo `name`. A value like "abs-bench" is WRONG; the value must start with `/`.

## At startup

Call `list_repositories` once to verify `__REPO_PATH__` is indexed. If it's not, tell the user to run:

  yats index __REPO_PATH__

and wait for it to finish. This startup check does NOT count toward the 4-call limit.
