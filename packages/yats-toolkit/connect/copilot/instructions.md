# YATS Code Intelligence

This repo is indexed by YATS MCP. You have tools: search_code, find_symbol, find_callers, find_callees, expand_graph, find_references, find_implementations, find_inheritors, find_routes, repository_summary, list_repositories.

## Rules
- YATS first, file reads second. YATS is ~100 tokens and instant.
- Max 3 YATS calls per task. After call 3, answer with what you have.
- Start with search_code, then find_symbol on top hits, then expand_graph.
- Pass `path="__REPO_PATH__"` on every call — the FULL absolute path (the `rootPath` value from `list_repositories` / `yats list`), never the repo `name`. A name like "abs-bench" is wrong; the value must start with `/`.
- Do NOT invent answers — verify with YATS or read files.
- Do NOT re-verify YATS results with grep/cat/sed — the graph is already indexed and exact. If you need exact line contents, Read only the specific file:line range YATS returned, once.

## At startup

Run `yats list` and check if `__REPO_PATH__` is indexed. If it's not, run:

  yats index __REPO_PATH__

and wait for it to finish.
