# YATS Code Intelligence

This repository is indexed by YATS MCP. You have these tools:
`search_code`, `find_symbol`, `find_callers`, `find_callees`, `expand_graph`,
`find_references`, `find_implementations`, `find_inheritors`, `find_routes`,
`repository_summary`, `architecture_summary`, `list_repositories`.

## ⚠️ ABSOLUTE HARD LIMIT: __TOOL_BUDGET__ TOOL CALLS TOTAL

You are allowed **AT MOST __TOOL_BUDGET__ YATS tool calls** for this entire task. This is a hard budget, not a suggestion.

- After your __TOOL_BUDGET__th call, you MUST write your final answer immediately.
- Do NOT call `find_symbol` separately for every symbol. `expand_graph` returns callers + callees + neighbors in ONE call.
- Do NOT re-run `search_code` with slightly different wording.
- Do NOT verify each result with another call. Trust the graph.
- Do NOT read source files with shell commands (`head`, `cat`, `sed`, `rg`, `grep`). YATS already has the symbols and relationships — use the YATS tools instead.
- Every extra call wastes tokens and fails this task.

## Workflow (at most __TOOL_BUDGET__ calls)

1. `search_code("<your question>", repository="__REPO_NAME__")` — first call
2. `expand_graph([top 2 symbol ids], repository="__REPO_NAME__")` — full subgraph in ONE call
3. Use remaining calls only for a specific relationship (`find_callers`, `find_references`, etc.)
4. STOP. Write the answer.

## Repository

Use `repository="__REPO_NAME__"` for every call. Do NOT call `list_repositories` — the repo name is already given.
