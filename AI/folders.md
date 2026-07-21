# Folder Structure

## Root

```
code-indexer/
├── AI/                          ← AI-oriented documentation (this folder)
├── docker/                      ← Dockerfiles and compose configs
├── packages/                    ← pnpm workspace packages
│   ├── shared/                  ← Domain layer
│   ├── infra/                   ← Infrastructure layer
│   ├── indexing/                ← Indexing application
│   ├── retrieval/               ← Retrieval application
│   ├── mcp-server/              ← MCP server adapter
│   ├── cli/                     ← CLI adapter
│   └── analyzers/               ← Language analyzer plugins
├── ARCHITECTURE.md              ← Original design spec
├── package.json                 ← Root workspace config
├── pnpm-workspace.yaml          ← Workspace definition
├── tsconfig.base.json           ← Shared TypeScript config
├── .env.example                 ← Environment variable reference
└── .gitignore
```

---

## `packages/shared/` — Domain Layer

**Purpose:** Single source of truth for all domain types, interfaces, and utilities. Every other package depends on this one. This package has **zero** external dependencies.

```
shared/src/
├── domain/
│   ├── enums.ts          ← SymbolKind, RelationshipKind, Language, CollectionName
│   ├── models.ts         ← Symbol, Relationship, SourceLocation interfaces
│   └── value-objects.ts  ← SymbolId, RepositoryName (branded types + factories)
├── ports/                 ← All interfaces (contracts)
│   ├── language-analyzer.interface.ts
│   ├── graph-repository.interface.ts
│   ├── vector-repository.interface.ts
│   ├── embedding-generator.interface.ts
│   ├── indexer.interface.ts
│   ├── retriever.interface.ts
│   ├── file-system.interface.ts
│   ├── git-adapter.interface.ts
│   └── symbol-store.interface.ts
├── dto/                   ← Data transfer objects
│   ├── search-query.dto.ts
│   ├── search-result.dto.ts
│   ├── retrieval.dto.ts
│   ├── index-command.dto.ts
│   ├── vector.dto.ts
│   └── graph.dto.ts
├── utils/
│   ├── hash.ts            ← SHA256 hasher
│   ├── id-generator.ts    ← Re-exports from value-objects
│   └── logger.ts          ← Structured JSON logger
└── index.ts               ← Barrel export
```

**Rules:**
- ✅ Domain types, interfaces, DTOs, pure utility functions
- ❌ Never: infrastructure code, external library imports, side effects

---

## `packages/infra/` — Infrastructure Layer

**Purpose:** Implements all port interfaces. Contains adapters for Neo4j, Qdrant, Ollama, OpenAI, filesystem, and git.

```
infra/src/
├── neo4j/
│   ├── neo4j-connection.ts         ← Driver, retry, session pool
│   ├── neo4j-graph-repository.ts   ← Full GraphRepository implementation
│   └── migrations/
│       └── 001-schema.cypher       ← Constraints, indexes, fulltext
├── qdrant/
│   ├── qdrant-connection.ts        ← Client, collection init
│   ├── qdrant-vector-repository.ts ← Full VectorRepository implementation
│   └── collections.ts              ← Collection definitions
├── embeddings/
│   ├── ollama-embedding-generator.ts   ← Ollama API client
│   └── openai-embedding-generator.ts   ← OpenAI API client with rate-limit retry
├── storage/
│   ├── local-file-system.ts        ← FileSystem implementation
│   └── memory-symbol-store.ts      ← In-memory SymbolStore
├── git/
│   └── simple-git-adapter.ts       ← Git CLI wrapper
├── di/
│   ├── tokens.ts                   ← Injection token constants
│   └── container.ts                ← Tsyringe registration + lifecycle
└── index.ts
```

**Rules:**
- ✅ Neo4j queries, Qdrant operations, embedding API calls, git commands, DI wiring
- ❌ Never: business logic, domain types (reuse from `shared`)

---

## `packages/indexing/` — Indexing Application

**Purpose:** Orchestrates the indexing pipeline. Depends on infrastructure via interfaces only.

```
indexing/src/
├── application/
│   └── services/
│       ├── indexer.service.ts              ← Full indexing orchestrator
│       ├── incremental-indexer.service.ts  ← Git-diff based incremental indexing
│       └── symbol-differ.service.ts        ← Old vs new symbol comparison
├── infrastructure/
│   ├── file-walker.ts          ← Recursive directory walker with .gitignore
│   ├── file-watcher.ts         ← fs.watch-based change monitoring
│   └── language-detector.ts    ← Extension + shebang detection
└── index.ts
```

**Rules:**
- ✅ Indexing orchestration, pipeline logic
- ❌ Never: direct Neo4j/Qdrant access (use GraphRepository/VectorRepository interfaces)

---

## `packages/retrieval/` — Retrieval Application

**Purpose:** Orchestrates the hybrid search pipeline. Combines vector search + graph expansion.

```
retrieval/src/
├── application/
│   └── services/
│       ├── retriever.service.ts           ← Hybrid pipeline orchestrator
│       ├── ranker.service.ts              ← Composite scoring (kind boost, source boost)
│       ├── deduplicator.service.ts        ← ID + file-level dedup
│       ├── token-budget.service.ts        ← Token estimation (chars/3.5) + fitting
│       └── context-compressor.service.ts  ← Snippet truncation, import stripping
└── index.ts
```

**Rules:**
- ✅ Retrieval logic, ranking, compression
- ❌ Never: direct Neo4j/Qdrant/API access

---

## `packages/mcp-server/` — MCP Server Adapter

**Purpose:** Exposes the platform as MCP tools over JSON-RPC stdio.

```
mcp-server/src/
├── server.ts              ← JSON-RPC parser, dispatcher, lifecycle
├── tools/
│   └── all-tools.ts       ← 22 tool definitions + handler factory
├── middleware/
│   ├── error-handler.ts   ← Exception → JSON-RPC error
│   ├── rate-limiter.ts    ← Sliding window rate limiter
│   └── logger.ts          ← Request/response logging with timing
└── index.ts
```

**Rules:**
- ✅ MCP protocol handling, tool definitions, JSON-RPC
- ❌ Never: business logic (delegate to services)

---

## `packages/cli/` — CLI Adapter

**Purpose:** Human-operated CLI for indexing, searching, and running the MCP server.

```
cli/src/
└── index.ts   ← Commander-based CLI (index, search, serve, summary commands)
```

**Rules:**
- ✅ CLI parsing, human-readable output, bootstrapping
- ❌ Never: business logic (delegate to services)

---

## `packages/analyzers/` — Language Analyzer Plugins

```
analyzers/
├── analyzer-interface/     ← AbstractAnalyzer base + AnalyzerFactory
│   └── src/
│       ├── analyzer.ts     ← AbstractAnalyzer (createSymbol, createRelationship helpers)
│       └── factory.ts      ← AnalyzerFactory (register + dispatch by language)
│
├── analyzer-typescript/    ← TS Compiler API (the reference implementation)
│   └── src/
│       └── ts-compiler-analyzer.ts  ← Full AST walk, symbol extraction, convention detection
│
├── analyzer-php/           ← PHP-Parser + PHPStan bridge
│   └── src/
│       ├── php-parser-analyzer.ts   ← Node.js side (spawns PHP, parses JSON)
│       └── php-bridge/             ← PHP side
│           ├── analyze.php         ← PHP parser script
│           └── composer.json       ← nikic/php-parser, phpstan/phpstan
│
├── analyzer-python/        ← LibCST + Jedi bridge
│   └── src/
│       ├── python-analyzer.ts      ← Node.js side (spawns Python, parses JSON)
│       └── python-bridge/          ← Python side
│           └── analyzer.py         ← LibCST + Jedi script
│
├── analyzer-csharp/        ← Placeholder (needs .NET project)
│   └── src/
│       └── index.ts        ← Stub only
│
└── analyzer-treesitter/    ← Universal fallback
    └── src/
        ├── treesitter-analyzer.ts  ← tree-sitter + regex fallback
        └── queries/
            ├── typescript.scm
            ├── php.scm
            └── python.scm
```

**Rules:**
- ✅ Parsing, symbol extraction, relationship extraction, convention detection
- ❌ Never: database access, business logic, HTTP calls

---

## `docker/`

```
docker/
├── docker-compose.yml          ← Production: neo4j, qdrant, ollama, redis, postgres
├── docker-compose.dev.yml      ← Development overrides (debug ports, mounts)
├── qdrant/
│   └── config.yaml             ← Qdrant production config
├── mcp-server/
│   └── Dockerfile              ← Multi-stage alpine build
├── retriever/
│   └── Dockerfile              ← Retriever service with health check
└── indexer/
    └── Dockerfile              ← Indexer service with health check
```

[← Back to README](./README.md)
