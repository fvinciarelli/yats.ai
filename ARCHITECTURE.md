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
│  (Exposes 20 tools to AI agents via MCP protocol)         │
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

Route symbols (kind `route`) additionally carry `httpMethod` (GET, POST, …)
and `routePath` — both indexed and queryable through `find_routes`.

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
| Route | HTTP method decorator/attribute or router registration (`HandleFunc`, `GET("/...")`, `app.get(...)`, `@app.route(...)`) — captured with `httpMethod` + `routePath` |
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

Route nodes store `httpMethod` and `routePath` as indexed properties;
`find_routes` filters on them (plus `repository` and `limit`).

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
- **Commit-based sync (P1):** `yats index` records the current commit;
  `yats watch` polls `git rev-parse HEAD` (~2s) and, when HEAD moves (new
  commit or checkout), streams `git diff --name-status <lastIndexed>..HEAD`
  through the HTTP API (`/index/file` for added/modified, `/index/remove` for
  deleted/renamed), then `/index/complete` + `POST /index/commit`. Saves
  without committing don't touch the index. `--live` adds save-based
  indexing (`fs.watch`) on top — the only mode for non-git directories.
- **In-place sync (P2):** re-indexing a file updates its symbols in place —
  incoming edges from other files are preserved (the server re-resolves
  cross-file references and only deletes relationships that no longer match).
- **Client-side filtering (P4/P6):** the CLI decides what to send. Built-ins
  skip `node_modules`, `dist`, dotfiles, …; `~/.yats/.env` provides the
  machine defaults (`DOC_EXTENSIONS`, `SKIP_EXTENSIONS`, `IGNORED_DIRS`); the
  repo's `.yats/config.json` can only narrow them further (`ignoredDirs` /
  `skipExtensions` union, `docExtensions` replace, `docPatterns` doc
  whitelist, `indexDocs: false`). A malformed repo config stops the run
  before reading any file. `--no-config` bypasses the repo config.

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

## 10. MCP Tools (20)

| Category | Tools |
|----------|-------|
| **Search** | `search_code`, `search_documentation`, `search_similar` |
| **Navigation** | `find_symbol`, `find_references`, `find_callers`, `find_callees` |
| **Inheritance** | `find_implementations`, `find_inheritors` |
| **Graph** | `expand_graph`, `related_symbols` |
| **Discovery** | `list_symbols`, `find_routes`, `find_configuration`, `find_tests` |
| **Repository** | `list_repositories`, `delete_repository` |
| **Analysis** | `repository_summary`, `architecture_summary` |
| **Maintenance** | `rebuild_vectors` |

Tools communicate via MCP JSON-RPC over stdio, HTTP+SSE, or Streamable HTTP (`/mcp`).

Indexing operations are **HTTP endpoints**, not MCP tools: `POST /index`,
`POST /index/file`, `POST /index/remove`, `POST /index/complete`,
`POST /index/commit`, `POST /reindex`. The CLI (`yats index` / `yats watch`)
is their main client.

The file-op tools (`read_file`, `write_file`, `update_file`, `create_file`,
`delete_file`) are advertised in `tools/list` but not yet wired to handlers —
they return `Unknown tool` if called.

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

The `yats` service interpolates these environment variables (defaults shown,
settable in `~/.yats/.env`): `INDEX_DOCS=true`, `DOC_MAX_FILES=300`,
`DOC_EXTENSIONS=.md,.mdx,.rst,.txt,.adoc,.org,.wiki,.readme`,
`SKIP_EXTENSIONS=`, `IGNORED_DIRS=`, `EMBEDDING_BATCH_SIZE=200`. `yats setup`
writes that file; the wizard's answers seed the defaults.
