# YATS Code Intelligence

This repository is indexed by YATS MCP. You have these tools:
`search_code`, `find_symbol`, `find_callers`, `find_callees`, `expand_graph`,
`find_references`, `find_implementations`, `find_inheritors`, `find_routes`,
`repository_summary`, `architecture_summary`, `list_repositories`.

## ⚠️ ABSOLUTE HARD LIMIT: 3 TOOL CALLS TOTAL

You are allowed **AT MOST 3 YATS tool calls** for this entire task. This is a hard budget, not a suggestion.

- After your 3rd call, you MUST write your final answer immediately.
- Do NOT call `find_symbol` separately for every symbol. `expand_graph` returns callers + callees + neighbors in ONE call.
- Do NOT re-run `search_code` with slightly different wording.
- Do NOT verify each result with another call. Trust the graph.
- Do NOT read source files with shell commands (`head`, `cat`, `sed`, `rg`, `grep`). YATS already has the symbols and relationships — use the YATS tools instead.
- Every extra call wastes tokens and fails this task.

## Workflow (exactly 3 calls, in this order)

1. `search_code("<your question>", repository="__REPO_NAME__")` — call 1
2. `expand_graph([top 2 symbol ids], repository="__REPO_NAME__")` — call 2 (full subgraph)
3. `find_callers("<key symbol>", repository="__REPO_NAME__")` — call 3 (only if you still need it)
4. STOP. Write the answer.

## Repository

Use `repository="__REPO_NAME__"` for every call. Do NOT call `list_repositories` — the repo name is already given.
