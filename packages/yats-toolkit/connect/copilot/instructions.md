# YATS Code Intelligence

This repo is indexed by YATS MCP. You have tools: search_code, find_symbol, find_callers, find_callees, expand_graph, find_references, find_implementations, find_inheritors, find_routes, repository_summary, list_repositories.

## Rules
- YATS first, file reads second. YATS is ~100 tokens and instant.
- Max 3 YATS calls per task. After call 3, answer with what you have.
- Start with search_code, then find_symbol on top hits, then expand_graph.
- Pass `path="__REPO_PATH__"` on every call — YATS identifies repos by their full path.
- Do NOT invent answers — verify with YATS or read files.
