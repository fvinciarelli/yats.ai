---
name: yats
description: YATS has this codebase indexed in a knowledge graph. Use when asked about the code — how something works, architecture, call chains, where something is defined. Use YATS tools first before reading files.
---

# YATS Code Intelligence

This repo is indexed by YATS (mcp__yats__* tools). Every symbol, call, and relationship is in a knowledge graph.

## Golden rule

**YATS first, Read second.** MCP tools return results in milliseconds for ~100 tokens. Reading files costs thousands of tokens and takes seconds.

## Efficient workflow

1. `search_code` — natural language query about the code (ALWAYS start here)
2. `find_symbol` on top 2-3 hits to get exact locations
3. `find_callers` / `find_callees` on 1-2 key symbols to trace the flow
4. `expand_graph` on seeds to get the full subgraph in one call
5. Only then `Read` files at the exact lines YATS gave you

## Rules

- Max 3-5 YATS tool calls per task. Synthesize what you have.
- Never guess symbol names — always start with `search_code`.
- Prefer `expand_graph` over multiple individual `find_symbol` calls.
- If YATS returns empty, try a different query before falling back to file reads.
- Repository name is usually the directory name. Check `list_repositories` if unsure.
