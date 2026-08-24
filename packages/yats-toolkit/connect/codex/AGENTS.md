# YATS Code Intelligence

This repository is indexed by YATS MCP. You have these tools:
`search_code`, `find_symbol`, `find_callers`, `find_callees`, `expand_graph`,
`find_references`, `find_implementations`, `find_inheritors`, `find_routes`,
`repository_summary`, `architecture_summary`, `list_repositories`.

## Golden rule

**YATS first, Read second.** MCP tools return results in milliseconds for ~100 tokens. Reading files costs thousands of tokens and takes seconds.

## Efficient workflow

1. `search_code` — natural language query about the code (ALWAYS start here)
2. `expand_graph` on top 2-3 symbol ids — full subgraph (callers + callees + neighbors) in ONE call
3. `find_callers` / `find_callees` / `find_references` only for one specific relationship
4. Only then `Read` files at the exact lines YATS gave you

## Rules

- Max 3-5 YATS tool calls per task. Synthesize what you have.
- Never guess symbol names — always start with `search_code`.
- Prefer `expand_graph` over multiple individual calls.
- If YATS returns empty, try a different query before falling back to file reads.
- Do NOT use shell commands (`head`, `cat`, `sed`, `rg`, `grep`) to inspect code — YATS has the symbols and relationships.

## Repository

Use `path="__REPO_PATH__"` for every call — YATS identifies repos by their full path.
