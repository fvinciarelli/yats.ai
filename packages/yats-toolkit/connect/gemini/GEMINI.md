# YATS Code Intelligence

This repository is indexed by YATS MCP. You have access to a knowledge graph.

## Tools available
`search_code`, `search_documentation`, `find_symbol`, `find_callers`, `find_callees`, `expand_graph`,
`find_references`, `find_implementations`, `find_inheritors`, `find_routes`,
`repository_summary`, `architecture_summary`, `list_repositories`.

## GOLDEN RULE: YATS first, files second
- YATS queries cost ~100 tokens, return in milliseconds.
- Reading files costs THOUSANDS of tokens.
- Always try `search_code()` (or `search_documentation()` for docs/README questions) BEFORE reading any file.

## Workflow
1. `search_code("your question", path="__REPO_PATH__")` — ALWAYS start here. For questions about commands, docs, overview or how the project works: `search_documentation(...)` FIRST — it contains the FULL section text (CLI.md, README.md…). NEVER explore source code for a docs question.
2. `find_symbol(name, path="__REPO_PATH__")` on top 2-3 hits
3. `expand_graph([top1, top2], path="__REPO_PATH__")` — callers+callees in one call
4. Only then read files at exact lines from YATS — at most ONCE per file

## Rules
- Max 4 YATS calls per task. After call 4, synthesize and answer with what you have.
- NEVER guess symbol names — always start with search_code (or search_documentation).
- Prefer expand_graph over multiple find_symbol calls.
- Do NOT re-verify YATS results with grep/search tools — the graph is already indexed and exact. `search_documentation` returns the doc section CONTENT — answer from it, do NOT re-read the file.
- If YATS returns empty, try a different query before falling back to file reads.
- Pass `path="__REPO_PATH__"` on EVERY call (including `architecture_summary` and `repository_summary`) — the FULL absolute path (the `rootPath` value from `list_repositories` / `yats list`), never the repo `name`. A value like "abs-bench" is WRONG; the value must start with `/`.

## At startup

Run `yats list` once and check if `__REPO_PATH__` is indexed. If it's not, run:

  yats index __REPO_PATH__

and wait for it to finish. This startup check does NOT count toward the 4-call limit.
