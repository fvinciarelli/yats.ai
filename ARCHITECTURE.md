# Architecture — YATS

> High-level design of the code intelligence platform. For implementation details, see source.

---

## 1. System Overview

```
Repository → Indexer → [Neo4j + Qdrant] → Retriever → MCP Server → AI Agent
```

YATS indexes software repositories into a **symbolic knowledge graph** (Neo4j) and **semantic vector store** (Qdrant), then exposes intelligent retrieval through **MCP tools** — so AI coding agents never read files directly.

---

## 2. Bounded Contexts

```
┌──────────────────────────────────────────────────────────┐
│                     MCP Server                            │
│  (Exposes 23 tools to AI agents via MCP protocol)         │
└──────────────┬───────────────────────────────┬───────────┘
               │                               │
       ┌───────▼────────┐             ┌────────▼──────────┐
       │   Retriever    │             │  Index Operations  │
       │ (Hybrid search)│             │ (index/reindex/    │
       └───┬────────┬───┘             │  watch/remove)     │
           │        │                 └────────────────────┘
   ┌───────▼──┐ ┌──▼────────┐
   │  Qdrant  │ │   Neo4j   │
   │ (Vectors)│ │  (Graph)  │
   └────▲─────┘ └────▲──────┘
        │            │
   ┌────┴────────────┴────┐
   │      Indexer          │
   │  Walk → Analyze →     │
   │  Embed → Store        │
   └──────────┬────────────┘
              │
   ┌──────────┴────────────┐
   │  Language Analyzers    │
   │  TS | Go | C# | Py | PHP │
   └────────────────────────┘
```

---

## 3. Technology Stack

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Graph DB | Neo4j 5.x | Native graph traversal, Cypher |
| Vector DB | Qdrant | Payload filtering, cosine distance |
| Embeddings | Ollama / OpenAI / Mistral / Voyage | Configurable, local-first default |
| MCP Protocol | `@modelcontextprotocol/sdk` | Reference implementation |
| Language | TypeScript | MCP SDK + type safety |
| DI | tsyringe | Lightweight, decorator-based |
| Container | Docker Compose | Single command deployment |
| Package manager | pnpm | Workspace monorepo |

---

## 4. Package Structure

```
packages/
├── shared/              Domain types, interfaces, DTOs — zero external deps
├── infra/               Neo4j, Qdrant, Ollama/OpenAI adapters
├── indexing/            Walk → analyze → embed → store pipeline
├── retrieval/           Hybrid search: vector + graph + ranking
├── mcp-server/          MCP JSON-RPC (stdio, HTTP+SSE, Streamable HTTP)
├── dev-cli/             Local development server (yats-dev)
├── yats-toolkit/        User-facing CLI (setup, index, search, benchmark)
└── analyzers/
    ├── analyzer-interface/   Abstract base + factory
    ├── analyzer-typescript/   TypeScript compiler API
    ├── analyzer-go/          Go subprocess bridge
    ├── analyzer-csharp/      Roslyn bridge (.NET)
    ├── analyzer-python/      LibCST bridge
    ├── analyzer-php/         nikic/php-parser bridge
    └── analyzer-treesitter/  Universal fallback
```

---

## 5. Domain Model

### 5.1 Symbol

Every language analyzer emits symbols in a unified, language-agnostic structure:

```
Symbol {
  id           "repo::path::symbolPath"
  name         Human-readable name
  kind         class | interface | function | method | enum | struct | ...
  language     typescript | go | csharp | python | php
  location     { repository, relativePath, startLine, endLine }
  namespace    Fully qualified namespace/module path
  signature    Function/method signature
  docComment   JSDoc / XML doc / Docstring
  sourceSnippet  First ~80 lines of implementation
  contentHash  SHA256 for change detection
}
```

### 5.2 Relationship

```
Relationship {
  sourceSymbolId → targetSymbolId
  kind: CONTAINS | INHERITS | IMPLEMENTS | CALLS | IMPORTS |
        REFERENCES | TESTS | ROUTES_TO | ...
}
```

### 5.3 Architectural Conventions

Analyzers detect architectural patterns by naming conventions:

| Pattern | Detection |
|---------|-----------|
| Controller | Class ending in `Controller` |
| Service | Class ending in `Service` |
| Repository | Class ending in `Repository` |
| Entity | Class with `@Entity` decorator/attribute |
| Route | HTTP method decorator/attribute present |
| Test | File in `tests/` or `*.test.*` / `*_test.*` |

---

## 6. Neo4j Graph Schema

Every symbol is a node with label `:Symbol` plus a kind-specific label (`:Class`, `:Method`, `:Controller`, etc.).

```
(:Symbol:Class {id, name, language, repository, ...})
    |
    | CONTAINS
    ▼
(:Symbol:Method {id, name, signature, ...})
    |
    | CALLS
    ▼
(:Symbol:Method)
```

Key relationship types:
- **Structural:** `CONTAINS`, `DECLARES`, `BELONGS_TO`
- **OOP:** `INHERITS`, `IMPLEMENTS`, `OVERRIDES`
- **Dependencies:** `IMPORTS`, `CALLS`, `REFERENCES`, `INSTANTIATES`
- **Architectural:** `ROUTES_TO`, `HANDLES`, `TESTS`

---

## 7. Qdrant Vector Schema

Two collections:

| Collection | What's embedded | Vector dims |
|-----------|-----------------|-------------|
| `code` | Each symbol: `[lang] [kind] namespace.name + signature + docComment + sourceSnippet` | 768 |
| `documentation` | Each markdown section: `[doc] heading + content` | 768 |

Payload indexes enable filtered search: `language`, `repository`, `kind`, `namespace`, `className`.

---

## 8. Indexing Pipeline

```
File Walker                 Language Analyzer
  │                              │
  │  Walk repo, detect           │  Parse source, extract
  │  language per file           │  symbols + relationships
  │                              │
  ▼                              ▼
Language Detector          AnalysisResult
  │                              │
  └──────────┬───────────────────┘
             │
             ▼
    Global Symbol Table
    (cross-file resolution)
             │
             ▼
    ┌────────┴────────┐
    ▼                  ▼
  Neo4j              Qdrant
  (upsert symbols,   (generate embedding,
   relationships)     upsert vector)
```

- **Full index:** Walk → analyze → resolve → store. Used for first index and `reindex`.
- **Incremental index:** Git diff detection, only process changed files.
- **Live sync:** `yats watch` uses `fs.watch` + HTTP POST to index on save.

---

## 9. Retrieval Pipeline

```
User query ("how does auth work?")
             │
             ▼
    Embedding Generator
    (query → vector)
             │
    ┌────────┴────────┐
    ▼                  ▼
  Qdrant             Neo4j
  (vector search,     (graph expansion
   top-K hits)        from seed symbols)
             │
             ▼
    ┌─────────────────┐
    │  Deduplication   │
    │  Ranking          │
    │  Token budgeting  │
    │  Compression      │
    └─────────────────┘
             │
             ▼
    Ranked context (≤ 8000 tokens)
```

---

## 10. MCP Tools (23)

| Category | Tools |
|----------|-------|
| **Search** | `search_code`, `search_documentation`, `search_similar` |
| **Navigation** | `find_symbol`, `find_references`, `find_callers`, `find_callees` |
| **Inheritance** | `find_implementations`, `find_inheritors` |
| **Graph** | `expand_graph`, `related_symbols` |
| **Discovery** | `list_symbols`, `find_routes`, `find_configuration`, `find_tests` |
| **Repository** | `list_repositories`, `index_repository`, `delete_repository`, `reindex` |
| **File ops** | `index_file`, `remove_file` |
| **Analysis** | `repository_summary`, `architecture_summary` |

Tools communicate via MCP JSON-RPC over stdio, HTTP+SSE, or Streamable HTTP (`/mcp`).

---

## 11. Deployment

```bash
# One command
docker compose -f docker/docker-compose.yml up -d

# Services:
#   neo4j:7474    — Graph database
#   qdrant:6333   — Vector database
#   ollama:11434  — Local embeddings (optional profile)
#   yats:5555     — MCP server
```

The MCP server Docker image includes all language bridges (Go, C#, PHP, Python) compiled in. Published at `ghcr.io/fvinciarelli/yats.ai`.
