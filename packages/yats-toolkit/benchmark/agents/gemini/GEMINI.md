# YATS Code Intelligence

This repository is indexed by YATS MCP. You have access to a knowledge graph.

## Tools available
`search_code`, `find_symbol`, `find_callers`, `find_callees`, `expand_graph`,
`find_references`, `find_implementations`, `find_inheritors`, `find_routes`,
`repository_summary`, `architecture_summary`, `list_repositories`.

## GOLDEN RULE: YATS first, files second
- YATS queries cost ~100 tokens, return in milliseconds.
- Reading files costs THOUSANDS of tokens.
- Always try `search_code()` BEFORE reading any file.

## Workflow (3 steps max)
1. `search_code("your question", repository="<name>")` — ALWAYS start here
2. `find_symbol(name, repository="<name>")` on top 2-3 hits
3. `expand_graph([top1, top2], repository="<name>")` — callers+callees in one call
4. Only then read files at exact lines from YATS

## Rules
- Max 3 YATS calls per task. Synthesize and answer.
- NEVER guess symbol names — always start with search_code.
- Prefer expand_graph over multiple find_symbol calls.
- Repository name is usually the directory name. Check list_repositories if unsure.
