# YATS — AI Documentation Hub

## Overview

YATS (**Yet Another Token Saver**) is an **AI Code Intelligence Platform** that indexes source code repositories, builds a symbolic knowledge graph, generates vector embeddings, and exposes intelligent retrieval through the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/).

LLMs query the codebase through MCP tools instead of reading raw files — drastically reducing token consumption.

## Purpose

- **Index** multi-language repositories into a unified model of symbols and relationships
- **Search** code semantically (natural language → code), not just by text matching
- **Traverse** codebases via graph relationships (callers, callees, inheritors, implementors)
- **Expose** all operations as MCP tools consumable by any AI agent

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22, TypeScript (strict mode) |
| Graph DB | Neo4j 5.x (Cypher, APOC) |
| Vector DB | Qdrant (Cosine distance) |
| Embeddings | Ollama (nomic-embed-text, 768d) or OpenAI (text-embedding-3-small, 1536d) |
| DI | tsyringe (decorator-free factory registration) |
| Package Manager | pnpm 9 workspaces |
| Protocol | MCP JSON-RPC over stdio, HTTP+SSE, and Streamable HTTP |
| Container Runtime | Docker Compose (unified `docker compose up -d`) |
| Parsers | TS Compiler API, tree-sitter, Go bridge |

## Solution Structure

```
yats/
├── AI/                     ← You are here. AI-oriented documentation.
├── packages/
│   ├── shared/             ← Domain models, enums, ports (interfaces), DTOs
│   ├── infra/              ← Neo4j, Qdrant, embeddings, file system, git, DI
│   ├── indexing/           ← Indexing pipeline: walker, language detector, indexer
│   ├── retrieval/          ← Hybrid retrieval: rank, dedup, compress, token budget
│   ├── mcp-server/         ← MCP JSON-RPC server (stdio + HTTP+SSE + Streamable HTTP), 20 tools
│   ├── cli/                ← CLI: yats list|index|search|serve|summary|clear
│   ├── setup/              ← One-command setup wizard + bridge/stop/status scripts
│   └── analyzers/
│       ├── analyzer-interface/   ← AbstractAnalyzer + AnalyzerFactory
│       ├── analyzer-typescript/  ← TS Compiler API (full implementation)
│       ├── analyzer-go/          ← Go subprocess bridge
│       ├── analyzer-csharp/      ← Stub (needs .NET project)
│       └── analyzer-treesitter/  ← Universal regex/TS fallback
├── docker/
│   ├── docker-compose.yml        ← Unified: neo4j, qdrant, ollama, yats MCP server
│   ├── docker-compose.dev.yml
│   ├── Dockerfile                ← Multi-stage, all-in-one
│   └── entrypoint.sh
└── ARCHITECTURE.md         ← Original design document
```

## Document Map

| Document | Purpose |
|----------|---------|
| [README.md](./README.md) | This hub |
| [architecture.md](./architecture.md) | System design, layers, dependency flow, diagrams |
| [domain.md](./domain.md) | Business concepts: Symbol, Relationship, graph model |
| [folders.md](./folders.md) | Every folder explained — what belongs where |
| [conventions.md](./conventions.md) | Coding patterns: naming, async, DI, logging, testing |
| [workflows.md](./workflows.md) | Step-by-step: add analyzer, add MCP tool, index repo |
| [components.md](./components.md) | Every component: responsibility, deps, public API |
| [glossary.md](./glossary.md) | Terminology: SymbolKind, RelationshipKind, MCP, embedding |
| [build.md](./build.md) | Build, run, test, debug, Docker, env vars |
| [decisions.md](./decisions.md) | Architectural decisions and rationale |
| [improvements.md](./improvements.md) | Technical debt, risks, missing pieces |
