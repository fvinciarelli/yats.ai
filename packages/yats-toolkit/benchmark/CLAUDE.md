# CLAUDE.md — YATS Code Intelligence Instructions

## Before reading files, check YATS first

YATS is a code intelligence MCP server connected to this project. It has indexed the entire codebase
into a knowledge graph with symbol definitions, call chains, inheritance, and vector search.

**Default workflow: YATS first, files second.**

When asked about the codebase:
1. Start with YATS MCP tools — they're instant and token-cheap
2. Only read files to verify details or see implementation specifics

## Available YATS MCP tools

The MCP server is at `yats` and exposes these tools:

### Discovery (use these first)
- `search_code` — Natural language search across the codebase. Best starting point.
  Example: `search_code(query="how does protocol translation work")`
- `repository_summary` — Symbol counts by kind. Quick overview.
- `architecture_summary` — Key services, routes, entities at a glance.

### Symbol lookup
- `find_symbol` — Find a symbol by name. Use `exact: true` for precise match.
- `list_symbols` — List symbols filtered by kind.

### Navigation (trace connections)
- `find_callers` — Who calls this function?
- `find_callees` — What does this function call?
- `find_references` — All references to a symbol.
- `find_implementations` — Implementations of an interface/abstract class.
- `find_inheritors` — Subclasses of a class.
- `related_symbols` — 1-hop neighbors in the graph.

### Specialized
- `find_routes` — HTTP endpoints and API routes.
- `find_tests` — Tests related to a symbol.
- `find_configuration` — Config settings and environment variables.
- `search_documentation` — Search docs (README, ADRs, etc.).
- `search_similar` — Semantically similar code to a symbol.
- `expand_graph` — Multi-hop graph exploration from symbol IDs.

## Rules

1. **Always try YATS first.** A `search_code` or `find_symbol` call costs virtually no tokens
   and returns structured results. Reading a file costs you reading the entire file.

2. **Trace call chains with YATS, not grep.** Use `find_callers`/`find_callees` to follow
   execution flow through the graph — no need to grep for function names across files.

3. **Read files only for details.** Once YATS gives you the file path and line number,
   read that specific file to see the implementation, not to discover connections.

4. **YATS is real-time indexed.** The knowledge graph reflects the current state of the
   codebase. Trust it over stale assumptions.

5. **Batch YATS calls when possible.** Multiple MCP calls are cheaper than one file read.
