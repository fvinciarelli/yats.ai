---
name: yats
description: YATS has this codebase indexed. Use when asked about the code — how something works, architecture, call chains, where something is defined.
when_to_use: "How does X work?, Where is X defined?, What calls X?, architecture, trace the flow, find routes, find config"
---

# YATS Code Intelligence
This repo is indexed by YATS (mcp__yats__* tools). Every symbol, call, and relationship is in a knowledge graph.

## Golden rule
**YATS first, Read second.** MCP tools return in ms for ~100 tokens. Reading files costs thousands.

## Workflow
1. search_code with natural language query — always pass repository="lab_hub"
2. find_symbol on hits — always pass repository="lab_hub"  
3. find_callers / find_callees to trace
4. Only then Read files at the line YATS gave you
