# AI Code Intelligence Platform — Architecture Design

> **Status:** Design Phase  
> **Audience:** AI coding agents implementing the system  
> **Principle:** Every component must be independently buildable, testable, and replaceable.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Domain Model](#2-domain-model)
3. [Architecture (DDD + Hexagonal)](#3-architecture)
4. [Folder Structure](#4-folder-structure)
5. [Service Interfaces](#5-service-interfaces)
6. [Neo4j Graph Schema](#6-neo4j-graph-schema)
7. [Qdrant Vector Schema](#7-qdrant-vector-schema)
8. [MCP Tool Contracts](#8-mcp-tool-contracts)
9. [Indexing Pipeline](#9-indexing-pipeline)
10. [Hybrid Retriever](#10-hybrid-retriever)
11. [Docker Architecture](#11-docker-architecture)
12. [Development Roadmap](#12-development-roadmap)
13. [AI Implementation Tasks](#13-ai-implementation-tasks)

---

## 1. System Overview

### 1.1 Elevator Pitch

A platform that indexes software repositories, builds a symbolic knowledge graph, generates vector embeddings, and exposes intelligent retrieval through MCP — so AI coding agents never touch files directly.

### 1.2 Core Flow

```
Repository → Indexer → [Neo4j + Qdrant] → Retriever → MCP Server → LLM
```

### 1.3 Bounded Contexts

```
┌──────────────────────────────────────────────────────────┐
│                      MCP Server                           │
│  (Exposes tools to LLMs — the only entry point for AI)    │
└──────────────┬───────────────────────────────┬───────────┘
               │                               │
       ┌───────▼────────┐             ┌────────▼──────────┐
       │    Retriever   │             │   File Operations  │
       │ (Hybrid search)│             │ (read/write/delete) │
       └───┬────────┬───┘             └────────────────────┘
           │        │
   ┌───────▼──┐ ┌──▼────────┐
   │  Qdrant  │ │   Neo4j   │
   │ (Vectors)│ │  (Graph)  │
   └────▲─────┘ └────▲──────┘
        │            │
   ┌────┴────────────┴────┐
   │      Indexer          │
   │  (Orchestrates the    │
   │   indexing pipeline)  │
   └──────────┬────────────┘
              │
   ┌──────────┴────────────┐
   │  Language Analyzers    │
   │  C# | PHP | Python | TS│
   └────────────────────────┘
```

### 1.4 Technology Decisions

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Graph DB | Neo4j 5.x | Native graph traversal, Cypher, mature |
| Vector DB | Qdrant | Rust-based, filtered search, payload indexing |
| Embeddings | Ollama (nomic-embed-text) or OpenAI text-embedding-3-small | Configurable, local-first |
| MCP Protocol | @modelcontextprotocol/sdk (TypeScript) | Reference implementation, streaming support |
| Language | TypeScript (primary services), Python (analyzers where needed) | TS for MCP/MCP SDK, Python for ML/parsing ecosystem |
| Transport | stdio (MCP), HTTP (internal services) | MCP spec compliance, Docker networking |
| Container | Docker Compose | Local-first, reproducible |
| DI | tsyringe (TS) / dependency-injector (Python) | Lightweight, decorator-based |
| CQRS | In-process command/query separation | Keeps indexing commands separate from retrieval queries |

---

## 2. Domain Model

### 2.1 Common Symbol Model

Every language analyzer emits this unified structure regardless of source language.

```typescript
// ============================================================
// Core Symbol (language-agnostic)
// ============================================================

interface Symbol {
  /** Universally unique ID: "{repository}::{relativePath}::{symbolPath}" */
  id: string;

  /** Human-readable name (last segment of the path) */
  name: string;

  /** Discriminator */
  kind: SymbolKind;

  /** Where in the repository this lives */
  location: SourceLocation;

  /** Source language */
  language: Language;

  /** Fully qualified namespace/module path */
  namespace: string;

  /** If this symbol is a member of a class/struct/interface */
  parentClass: string | null;

  /** Function/method signature (type-stripped) */
  signature: string | null;

  /** Doc comment / JSDoc / XML doc / Docstring */
  docComment: string | null;

  /** First 80 lines of implementation (for embedding) */
  sourceSnippet: string;

  /** SHA256 of sourceSnippet — used for change detection */
  contentHash: string;

  /** Arbitrary key-value metadata from the analyzer */
  metadata: Record<string, unknown>;
}

// ============================================================
// Symbol Kinds (discriminated union tag)
// ============================================================

enum SymbolKind {
  // ——— Structural ———
  NAMESPACE     = "namespace",
  MODULE        = "module",
  PACKAGE       = "package",

  // ——— Types ———
  CLASS         = "class",
  INTERFACE     = "interface",
  ENUM          = "enum",
  STRUCT        = "struct",
  RECORD        = "record",
  TYPE_ALIAS    = "type_alias",

  // ——— Callables ———
  FUNCTION      = "function",
  METHOD        = "method",
  CONSTRUCTOR   = "constructor",
  LAMBDA        = "lambda",

  // ——— Data ———
  PROPERTY      = "property",
  FIELD         = "field",
  CONSTANT      = "constant",
  VARIABLE      = "variable",
  PARAMETER     = "parameter",

  // ——— Decorators ———
  ANNOTATION    = "annotation",
  ATTRIBUTE     = "attribute",
  DECORATOR     = "decorator",

  // ——— Architectural ———
  CONTROLLER    = "controller",
  SERVICE       = "service",
  REPOSITORY    = "repository",
  DTO           = "dto",
  ENTITY        = "entity",
  COMMAND       = "command",
  QUERY         = "query",
  EVENT         = "event",
  MIDDLEWARE    = "middleware",
  GUARD         = "guard",
  INTERCEPTOR   = "interceptor",
  PROVIDER      = "provider",
  FACTORY       = "factory",
  CONFIG        = "config",
  MIGRATION     = "migration",
  TEST          = "test",
  FIXTURE       = "fixture",
  ROUTE         = "route",
  HOOK          = "hook",
  COMPONENT     = "component",
}

// ============================================================
// Relationships
// ============================================================

enum RelationshipKind {
  // ——— Structural ———
  CONTAINS        = "CONTAINS",
  DECLARES        = "DECLARES",
  BELONGS_TO      = "BELONGS_TO",

  // ——— OOP ———
  INHERITS        = "INHERITS",
  IMPLEMENTS      = "IMPLEMENTS",
  OVERRIDES       = "OVERRIDES",

  // ——— Dependencies ———
  IMPORTS         = "IMPORTS",
  EXPORTS         = "EXPORTS",
  DEPENDS_ON      = "DEPENDS_ON",
  CALLS           = "CALLS",
  REFERENCES      = "REFERENCES",
  INSTANTIATES    = "INSTANTIATES",

  // ——— Data flow ———
  RETURNS         = "RETURNS",
  ACCEPTS         = "ACCEPTS",
  PUBLISHES       = "PUBLISHES",
  SUBSCRIBES      = "SUBSCRIBES",

  // ——— Testing ———
  TESTS           = "TESTS",
  CONFIGURES      = "CONFIGURES",

  // ——— Architectural ———
  ROUTES_TO       = "ROUTES_TO",
  HANDLES         = "HANDLES",
}

// ============================================================
// Supporting types
// ============================================================

interface SourceLocation {
  repository: string;      // repo name / identifier
  relativePath: string;    // path relative to repo root
  startLine: number;       // 1-indexed
  endLine: number;
  startColumn: number;     // 0-indexed
  endColumn: number;
}

enum Language {
  CSHARP     = "csharp",
  PHP        = "php",
  PYTHON     = "python",
  TYPESCRIPT = "typescript",
  // Extensible
  GO         = "go",
  RUST       = "rust",
  JAVA       = "java",
  KOTLIN     = "kotlin",
  RUBY       = "ruby",
}

interface Relationship {
  id: string;
  sourceSymbolId: string;
  targetSymbolId: string;
  kind: RelationshipKind;
  metadata: Record<string, unknown>;
}
```

### 2.2 Repository Aggregate

```typescript
interface Repository {
  id: string;
  name: string;
  rootPath: string;
  languages: Language[];
  lastIndexedAt: Date | null;
  gitCommit: string | null;
  configFiles: ConfigFile[];
}

interface ConfigFile {
  path: string;
  kind: "dockerfile" | "docker_compose" | "env" | "ci" | "package_manager" | "other";
  content: string;
}

interface DocumentationFile {
  path: string;
  title: string;
  content: string;
  sections: DocSection[];
}

interface DocSection {
  heading: string;
  level: number;
  content: string;
}
```

---

## 3. Architecture (DDD + Hexagonal)

### 3.1 Layer Diagram

```
┌─────────────────────────────────────────────────────┐
│                   Application Layer                  │
│  Use Cases / Commands / Queries / CQRS Handlers      │
├─────────────────────────────────────────────────────┤
│                     Domain Layer                      │
│  Entities / Value Objects / Domain Services          │
│  Symbol, Relationship, Repository, SearchQuery       │
├─────────────────────────────────────────────────────┤
│                Infrastructure Layer                   │
│  Neo4jDriver, QdrantClient, OllamaClient,            │
│  FileSystem, GitAdapter, LanguageAnalyzerImpls        │
├─────────────────────────────────────────────────────┤
│                  Interface Adapters                   │
│  MCP Server, CLI, HTTP API (health), Events          │
└─────────────────────────────────────────────────────┘
```

### 3.2 Ports & Adapters (Hexagonal)

```
                    ┌──────────────┐
                    │   MCP Server │  ← Primary adapter (driving)
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │             │
     ┌────────▼──┐  ┌─────▼──────┐  ┌──▼──────────┐
     │ SearchCode│  │ FindSymbol │  │ ExpandGraph │  ← Ports (interfaces)
     └───────────┘  └────────────┘  └─────────────┘
              │            │             │
     ┌────────▼────────────▼─────────────▼──────────┐
     │              Application Services             │
     │  RetrieverService, IndexerService,            │
     │  FileOperationService                         │
     └──────────┬──────────────┬────────────────────┘
                │              │
   ┌────────────▼──┐  ┌───────▼──────────┐
   │  GraphRepo     │  │  VectorRepo     │  ← Secondary ports (driven)
   │  (Neo4j)       │  │  (Qdrant)       │
   └───────────────┘  └─────────────────┘
```

### 3.3 CQRS Separation

**Commands** (write side — indexing):
- `IndexRepositoryCommand`
- `IndexFileCommand`
- `DeleteSymbolCommand`
- `UpdateRelationshipsCommand`
- `ReindexFileCommand`

**Queries** (read side — retrieval):
- `SearchCodeQuery`
- `FindSymbolQuery`
- `FindReferencesQuery`
- `ExpandGraphQuery`
- `RepositorySummaryQuery`

The write side is only used during indexing. The read side is used during MCP tool calls. This separation means we can optimize reads and writes independently.

### 3.4 SOLID Principles Applied

| Principle | Application |
|-----------|------------|
| **S** | Each analyzer handles one language. Each MCP tool is one class. |
| **O** | Language analyzers registered via `LanguageAnalyzer` interface — add Go without touching existing code. |
| **L** | Every `LanguageAnalyzer` implementation must produce valid `Symbol[]` — the retriever doesn't care which language. |
| **I** | `SymbolStore`, `GraphRepository`, `VectorRepository`, `EmbeddingGenerator` — small focused interfaces. |
| **D** | Application layer depends on interfaces, not Neo4j/Qdrant directly. |

---

## 4. Folder Structure

```
code-indexer/
├── docker/
│   ├── docker-compose.yml
│   ├── docker-compose.dev.yml
│   ├── neo4j/
│   │   └── Dockerfile              # Neo4j + APOC plugins
│   ├── qdrant/
│   │   └── config.yaml
│   └── mcp-server/
│       └── Dockerfile
│
├── packages/
│   │
│   ├── shared/                     # @code-indexer/shared
│   │   ├── src/
│   │   │   ├── domain/             # Symbol, Relationship, enums
│   │   │   │   ├── models.ts
│   │   │   │   ├── enums.ts
│   │   │   │   └── value-objects.ts
│   │   │   ├── ports/              # All interfaces (ports)
│   │   │   │   ├── language-analyzer.interface.ts
│   │   │   │   ├── graph-repository.interface.ts
│   │   │   │   ├── vector-repository.interface.ts
│   │   │   │   ├── embedding-generator.interface.ts
│   │   │   │   ├── file-system.interface.ts
│   │   │   │   ├── git-adapter.interface.ts
│   │   │   │   ├── symbol-store.interface.ts
│   │   │   │   ├── retriever.interface.ts
│   │   │   │   └── indexer.interface.ts
│   │   │   ├── dto/                # Data Transfer Objects
│   │   │   │   ├── search-query.dto.ts
│   │   │   │   ├── search-result.dto.ts
│   │   │   │   └── index-command.dto.ts
│   │   │   └── utils/
│   │   │       ├── hash.ts
│   │   │       ├── id-generator.ts
│   │   │       └── logger.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── infra/                      # @code-indexer/infra
│   │   ├── src/
│   │   │   ├── neo4j/
│   │   │   │   ├── neo4j-graph-repository.ts
│   │   │   │   ├── neo4j-connection.ts
│   │   │   │   ├── queries/        # Cypher templates
│   │   │   │   │   ├── upsert-symbol.cypher
│   │   │   │   │   ├── upsert-relationship.cypher
│   │   │   │   │   ├── delete-symbol.cypher
│   │   │   │   │   ├── find-symbol.cypher
│   │   │   │   │   ├── find-references.cypher
│   │   │   │   │   ├── find-callers.cypher
│   │   │   │   │   ├── find-callees.cypher
│   │   │   │   │   ├── find-implementations.cypher
│   │   │   │   │   ├── find-inheritors.cypher
│   │   │   │   │   ├── expand-neighbors.cypher
│   │   │   │   │   └── repository-summary.cypher
│   │   │   │   └── migrations/
│   │   │   │       └── 001-schema.cypher
│   │   │   ├── qdrant/
│   │   │   │   ├── qdrant-vector-repository.ts
│   │   │   │   ├── qdrant-connection.ts
│   │   │   │   └── collections.ts
│   │   │   ├── embeddings/
│   │   │   │   ├── ollama-embedding-generator.ts
│   │   │   │   └── openai-embedding-generator.ts
│   │   │   ├── storage/
│   │   │   │   ├── local-file-system.ts
│   │   │   │   └── memory-symbol-store.ts
│   │   │   ├── git/
│   │   │   │   └── simple-git-adapter.ts
│   │   │   └── di/
│   │   │       └── container.ts        # Tsyringe DI setup
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── indexing/                   # @code-indexer/indexing
│   │   ├── src/
│   │   │   ├── application/
│   │   │   │   ├── commands/
│   │   │   │   │   ├── index-repository.command.ts
│   │   │   │   │   ├── index-repository.handler.ts
│   │   │   │   │   ├── index-file.command.ts
│   │   │   │   │   ├── index-file.handler.ts
│   │   │   │   │   ├── delete-symbol.command.ts
│   │   │   │   │   └── delete-symbol.handler.ts
│   │   │   │   └── services/
│   │   │   │       ├── indexer.service.ts
│   │   │   │       ├── incremental-indexer.service.ts
│   │   │   │       ├── symbol-differ.service.ts
│   │   │   │       └── documentation-indexer.service.ts
│   │   │   ├── domain/
│   │   │   │   └── pipeline.ts        # Pipeline orchestration model
│   │   │   └── infrastructure/
│   │   │       ├── language-detector.ts
│   │   │       └── file-walker.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── analyzers/                  # Language analyzer plugins
│   │   ├── analyzer-interface/     # @code-indexer/analyzer-interface
│   │   │   ├── src/
│   │   │   │   └── analyzer.ts     # Abstract base + factory
│   │   │   ├── package.json
│   │   │   └── tsconfig.json
│   │   │
│   │   ├── analyzer-csharp/        # @code-indexer/analyzer-csharp
│   │   │   ├── src/
│   │   │   │   ├── roslyn-analyzer.ts
│   │   │   │   ├── symbol-extractor.ts
│   │   │   │   ├── relationship-extractor.ts
│   │   │   │   └── roslyn-bridge.ts     # .NET bridge process
│   │   │   ├── package.json
│   │   │   └── tsconfig.json
│   │   │
│   │   ├── analyzer-typescript/    # @code-indexer/analyzer-typescript
│   │   │   ├── src/
│   │   │   │   ├── ts-compiler-analyzer.ts
│   │   │   │   ├── symbol-extractor.ts
│   │   │   │   └── relationship-extractor.ts
│   │   │   ├── package.json
│   │   │   └── tsconfig.json
│   │   │
│   │   ├── analyzer-php/           # @code-indexer/analyzer-php
│   │   │   ├── src/
│   │   │   │   ├── php-parser-analyzer.ts
│   │   │   │   ├── symbol-extractor.ts
│   │   │   │   ├── relationship-extractor.ts
│   │   │   │   └── phpstan-bridge.ts    # PHP process bridge
│   │   │   ├── package.json
│   │   │   └── tsconfig.json
│   │   │
│   │   ├── analyzer-python/        # @code-indexer/analyzer-python
│   │   │   ├── src/
│   │   │   │   ├── python-analyzer.ts
│   │   │   │   ├── symbol-extractor.ts
│   │   │   │   ├── relationship-extractor.ts
│   │   │   │   └── libcst-bridge.ts     # Python bridge
│   │   │   ├── package.json
│   │   │   └── tsconfig.json
│   │   │
│   │   └── analyzer-treesitter/    # @code-indexer/analyzer-treesitter (fallback)
│   │       ├── src/
│   │       │   ├── treesitter-analyzer.ts
│   │       │   └── queries/        # tree-sitter query files
│   │       │       ├── csharp.scm
│   │       │       ├── php.scm
│   │       │       ├── python.scm
│   │       │       └── typescript.scm
│   │       ├── package.json
│   │       └── tsconfig.json
│   │
│   ├── retrieval/                  # @code-indexer/retrieval
│   │   ├── src/
│   │   │   ├── application/
│   │   │   │   ├── queries/
│   │   │   │   │   ├── search-code.query.ts
│   │   │   │   │   ├── search-code.handler.ts
│   │   │   │   │   ├── search-documentation.query.ts
│   │   │   │   │   ├── search-documentation.handler.ts
│   │   │   │   │   ├── find-symbol.query.ts
│   │   │   │   │   ├── find-symbol.handler.ts
│   │   │   │   │   ├── find-references.query.ts
│   │   │   │   │   ├── find-references.handler.ts
│   │   │   │   │   ├── find-callers.query.ts
│   │   │   │   │   ├── find-callers.handler.ts
│   │   │   │   │   ├── find-callees.query.ts
│   │   │   │   │   ├── find-callees.handler.ts
│   │   │   │   │   ├── find-implementations.query.ts
│   │   │   │   │   ├── find-implementations.handler.ts
│   │   │   │   │   ├── find-inheritors.query.ts
│   │   │   │   │   ├── find-inheritors.handler.ts
│   │   │   │   │   ├── find-tests.query.ts
│   │   │   │   │   ├── find-tests.handler.ts
│   │   │   │   │   ├── find-routes.query.ts
│   │   │   │   │   ├── find-routes.handler.ts
│   │   │   │   │   ├── find-configuration.query.ts
│   │   │   │   │   ├── find-configuration.handler.ts
│   │   │   │   │   ├── expand-graph.query.ts
│   │   │   │   │   ├── expand-graph.handler.ts
│   │   │   │   │   ├── related-symbols.query.ts
│   │   │   │   │   ├── related-symbols.handler.ts
│   │   │   │   │   ├── search-similar.query.ts
│   │   │   │   │   ├── search-similar.handler.ts
│   │   │   │   │   ├── repository-summary.query.ts
│   │   │   │   │   └── repository-summary.handler.ts
│   │   │   │   └── services/
│   │   │   │       ├── retriever.service.ts
│   │   │   │       ├── ranker.service.ts
│   │   │   │       ├── deduplicator.service.ts
│   │   │   │       ├── context-compressor.service.ts
│   │   │   │       └── token-budget.service.ts
│   │   │   └── domain/
│   │   │       ├── search-query.ts
│   │   │       ├── search-result.ts
│   │   │       └── ranking-strategy.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── mcp-server/                 # @code-indexer/mcp-server
│   │   ├── src/
│   │   │   ├── server.ts           # MCP server entry point
│   │   │   ├── transport.ts        # stdio transport
│   │   │   ├── tools/              # One file per MCP tool
│   │   │   │   ├── search-code.tool.ts
│   │   │   │   ├── search-documentation.tool.ts
│   │   │   │   ├── find-symbol.tool.ts
│   │   │   │   ├── find-references.tool.ts
│   │   │   │   ├── find-callers.tool.ts
│   │   │   │   ├── find-callees.tool.ts
│   │   │   │   ├── find-implementations.tool.ts
│   │   │   │   ├── find-inheritors.tool.ts
│   │   │   │   ├── find-tests.tool.ts
│   │   │   │   ├── find-routes.tool.ts
│   │   │   │   ├── find-configuration.tool.ts
│   │   │   │   ├── expand-graph.tool.ts
│   │   │   │   ├── related-symbols.tool.ts
│   │   │   │   ├── list-symbols.tool.ts
│   │   │   │   ├── repository-summary.tool.ts
│   │   │   │   ├── architecture-summary.tool.ts
│   │   │   │   ├── search-similar.tool.ts
│   │   │   │   ├── read-file.tool.ts
│   │   │   │   ├── write-file.tool.ts
│   │   │   │   ├── update-file.tool.ts
│   │   │   │   ├── delete-file.tool.ts
│   │   │   │   └── create-file.tool.ts
│   │   │   └── middleware/
│   │   │       ├── error-handler.ts
│   │   │       ├── rate-limiter.ts
│   │   │       └── logger.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── cli/                        # @code-indexer/cli
│       ├── src/
│       │   ├── index.ts
│       │   ├── commands/
│       │   │   ├── index.ts
│       │   │   ├── search.ts
│       │   │   ├── serve.ts
│       │   │   ├── graph-stats.ts
│       │   │   └── clean.ts
│       │   └── config.ts
│       ├── package.json
│       └── tsconfig.json
│
├── tsconfig.base.json
├── package.json                    # Root workspace config
├── pnpm-workspace.yaml
├── .env.example
├── .gitignore
└── README.md
```

---

## 5. Service Interfaces

### 5.1 Language Analyzer (Plugin Contract)

```typescript
// packages/shared/src/ports/language-analyzer.interface.ts

interface LanguageAnalyzer {
  /** Language this analyzer handles */
  readonly language: Language;

  /** Returns true if this analyzer can process the given file */
  canAnalyze(filePath: string, content: string): boolean;

  /**
   * Extract symbols and relationships from source code.
   * Returns BOTH symbols and the relationships between them.
   * The relationships reference symbols by their IDs.
   */
  analyze(
    filePath: string,
    content: string,
    repositoryName: string
  ): Promise<AnalysisResult>;
}

interface AnalysisResult {
  symbols: Symbol[];
  relationships: Relationship[];
  errors: AnalysisError[];
  warnings: AnalysisWarning[];
}

interface AnalysisError {
  line: number;
  column: number;
  message: string;
  severity: "error" | "warning";
}
```

### 5.2 Graph Repository

```typescript
// packages/shared/src/ports/graph-repository.interface.ts

interface GraphRepository {
  // ——— Write ———
  upsertSymbol(symbol: Symbol): Promise<void>;
  upsertSymbols(symbols: Symbol[]): Promise<void>;
  upsertRelationship(rel: Relationship): Promise<void>;
  upsertRelationships(rels: Relationship[]): Promise<void>;
  deleteSymbol(symbolId: string): Promise<void>;
  deleteSymbols(symbolIds: string[]): Promise<void>;
  deleteRelationships(symbolId: string): Promise<void>;
  clearRepository(repository: string): Promise<void>;

  // ——— Read ———
  findSymbol(symbolId: string): Promise<GraphSymbol | null>;
  findSymbolByName(repository: string, name: string, kind?: SymbolKind): Promise<GraphSymbol[]>;

  findReferences(symbolId: string, limit?: number): Promise<GraphSymbol[]>;
  findCallers(symbolId: string, limit?: number): Promise<GraphSymbol[]>;
  findCallees(symbolId: string, limit?: number): Promise<GraphSymbol[]>;
  findImplementations(symbolId: string, limit?: number): Promise<GraphSymbol[]>;
  findInheritors(symbolId: string, limit?: number): Promise<GraphSymbol[]>;
  findTests(symbolId: string, limit?: number): Promise<GraphSymbol[]>;
  findRoutes(repository: string): Promise<GraphSymbol[]>;
  findConfiguration(repository: string, key?: string): Promise<GraphSymbol[]>;

  /**
   * Multi-hop expansion from a set of seed symbol IDs.
   * @param seedIds Starting symbol IDs
   * @param hops Number of hops (1-3)
   * @param relationshipTypes Which relationship types to traverse
   */
  expandGraph(
    seedIds: string[],
    hops: number,
    relationshipTypes: RelationshipKind[]
  ): Promise<Subgraph>;

  relatedSymbols(symbolId: string, limit?: number): Promise<GraphSymbol[]>;
  repositorySummary(repository: string): Promise<RepositorySummary>;
  listSymbols(repository: string, kind?: SymbolKind, limit?: number, offset?: number): Promise<GraphSymbol[]>;
}

interface GraphSymbol extends Symbol {
  /** Neo4j internal node ID (for fast lookups) */
  nodeId: number;
  /** Labels in Neo4j that classify this node */
  labels: string[];
}

interface Subgraph {
  nodes: GraphSymbol[];
  relationships: Relationship[];
}

interface RepositorySummary {
  repository: string;
  totalSymbols: number;
  totalRelationships: number;
  symbolsByKind: Record<string, number>;
  symbolsByLanguage: Record<string, number>;
  languages: Language[];
}
```

### 5.3 Vector Repository

```typescript
// packages/shared/src/ports/vector-repository.interface.ts

interface VectorRepository {
  // ——— Write ———
  upsertVectors(points: VectorPoint[]): Promise<void>;
  deleteVectors(symbolIds: string[]): Promise<void>;
  clearCollection(collection: CollectionName): Promise<void>;

  // ——— Read ———
  search(
    collection: CollectionName,
    queryVector: number[],
    options: SearchOptions
  ): Promise<SearchHit[]>;

  searchWithFilters(
    collection: CollectionName,
    queryVector: number[],
    filters: VectorFilters,
    options: SearchOptions
  ): Promise<SearchHit[]>;
}

enum CollectionName {
  CODE = "code",
  DOCUMENTATION = "documentation",
}

interface VectorPoint {
  id: string;            // Same as Symbol.id or DocSection id
  vector: number[];      // Embedding (768 or 1536 dims)
  payload: VectorPayload;
}

interface VectorPayload {
  symbolId?: string;
  docSectionId?: string;
  language: Language | "markdown";
  repository: string;
  relativePath: string;
  namespace: string;
  className: string | null;
  methodName: string | null;
  kind: SymbolKind | "doc_section";
  contentHash: string;
  gitCommit: string | null;
  timestamp: string;     // ISO 8601
}

interface SearchOptions {
  limit?: number;        // Default: 20, Max: 100
  scoreThreshold?: number; // Min score (0-1), default: 0.5
  offset?: number;
}

interface VectorFilters {
  language?: Language | Language[];
  repository?: string;
  kind?: SymbolKind | SymbolKind[];
  namespace?: string;
  className?: string;
}

interface SearchHit {
  id: string;
  score: number;
  payload: VectorPayload;
}
```

### 5.4 Embedding Generator

```typescript
// packages/shared/src/ports/embedding-generator.interface.ts

interface EmbeddingGenerator {
  /** Dimension of the generated embeddings */
  readonly dimensions: number;

  /** Generate embedding for a single text */
  embed(text: string): Promise<number[]>;

  /** Generate embeddings for multiple texts (batching) */
  embedBatch(texts: string[]): Promise<number[][]>;

  /** Generate embedding optimized for code */
  embedCode(code: string, language: Language): Promise<number[]>;

  /** Generate embedding optimized for documentation */
  embedDocumentation(text: string): Promise<number[]>;

  /** Health check */
  isAvailable(): Promise<boolean>;
}
```

### 5.5 Indexer

```typescript
// packages/shared/src/ports/indexer.interface.ts

interface Indexer {
  /** Full index of a repository from scratch */
  indexRepository(repositoryPath: string): Promise<IndexResult>;

  /** Index a single file (for incremental updates) */
  indexFile(repositoryName: string, filePath: string): Promise<void>;

  /** Remove a file's symbols from all stores */
  removeFile(repositoryName: string, filePath: string): Promise<void>;

  /** Re-index files changed since last commit */
  incrementalIndex(repositoryPath: string, sinceCommit: string): Promise<IndexResult>;

  /** Index documentation files */
  indexDocumentation(repositoryPath: string): Promise<void>;
}

interface IndexResult {
  repository: string;
  symbolsFound: number;
  relationshipsFound: number;
  vectorsCreated: number;
  docsIndexed: number;
  errors: number;
  duration: number; // ms
}
```

### 5.6 Retriever

```typescript
// packages/shared/src/ports/retriever.interface.ts

interface Retriever {
  /** Hybrid retrieval combining vector search and graph expansion */
  retrieve(query: RetrievalQuery): Promise<RetrievalResult>;
}

interface RetrievalQuery {
  /** Natural language query */
  query: string;

  /** Repository to search within */
  repository: string;

  /** Options */
  options?: {
    maxVectorHits?: number;       // Default: 20
    graphExpansionHops?: number;  // Default: 1
    maxTotalResults?: number;     // Default: 30
    maxTokens?: number;           // Default: 8000
    includeTests?: boolean;       // Default: true
    includeDocs?: boolean;        // Default: true
    rankingStrategy?: "relevance" | "diversity" | "balanced";
  };
}

interface RetrievalResult {
  /** Final ranked, deduplicated, compressed context */
  context: RankedContextItem[];
  /** Token count of the context */
  tokenCount: number;
  /** Query time */
  durationMs: number;
  /** Debug info (for observability) */
  debug?: RetrievalDebug;
}

interface RankedContextItem {
  symbol: Symbol;
  score: number;
  source: "vector" | "graph" | "both";
  relevanceReason: string;
  /** Snippet of source code */
  snippet: string;
}

interface RetrievalDebug {
  vectorHits: number;
  graphExpanded: number;
  afterDedup: number;
  afterRanking: number;
  afterCompression: number;
}
```

### 5.7 File System

```typescript
// packages/shared/src/ports/file-system.interface.ts

interface FileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  updateFile(path: string, edits: FileEdit[]): Promise<void>;
  deleteFile(path: string): Promise<void>;
  createFile(path: string, content: string): Promise<void>;
  listFiles(directory: string, pattern?: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  resolvePath(repository: string, relativePath: string): Promise<string>;
}

interface FileEdit {
  oldText: string;   // Exact text to find
  newText: string;   // Replacement text
}
```

### 5.8 Git Adapter

```typescript
// packages/shared/src/ports/git-adapter.interface.ts

interface GitAdapter {
  getCurrentCommit(repoPath: string): Promise<string>;
  getChangedFiles(repoPath: string, sinceCommit: string): Promise<ChangedFile[]>;
  getFileAtCommit(repoPath: string, filePath: string, commit: string): Promise<string>;
  watchRepository(repoPath: string, onChanges: (files: string[]) => void): Promise<Watcher>;
}

interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  previousPath?: string;
}

interface Watcher {
  close(): void;
}
```

---

## 6. Neo4j Graph Schema

### 6.1 Node Labels

```cypher
-- packages/infra/src/neo4j/migrations/001-schema.cypher

// ============================================
// Constraints
// ============================================
CREATE CONSTRAINT symbol_id IF NOT EXISTS
FOR (s:Symbol) REQUIRE s.id IS UNIQUE;

CREATE CONSTRAINT repository_name IF NOT EXISTS
FOR (r:Repository) REQUIRE r.name IS UNIQUE;

CREATE INDEX symbol_kind IF NOT EXISTS
FOR (s:Symbol) ON (s.kind);

CREATE INDEX symbol_language IF NOT EXISTS
FOR (s:Symbol) ON (s.language);

CREATE INDEX symbol_name IF NOT EXISTS
FOR (s:Symbol) ON (s.name);

CREATE INDEX symbol_repository IF NOT EXISTS
FOR (s:Symbol) ON (s.repository);

// Full-text index for name search
CREATE FULLTEXT INDEX symbol_name_ft IF NOT EXISTS
FOR (s:Symbol) ON EACH [s.name, s.signature, s.docComment];

// ============================================
// Node hierarchy via labels
//
// Every node gets the label :Symbol
// Additional labels represent kind:
//   :Symbol:Class
//   :Symbol:Method
//   :Symbol:Controller
//   :Symbol:Service
//   etc.
//
// This allows queries like:
//   MATCH (c:Controller) RETURN c
// ============================================

// ============================================
// Relationship types (all have direction)
// ============================================

// Structural
// (:Symbol)-[:CONTAINS]->(:Symbol)
// (:Symbol)-[:DECLARES]->(:Symbol)
// (:Symbol)-[:BELONGS_TO]->(:Symbol)

// OOP
// (:Symbol)-[:INHERITS]->(:Symbol)
// (:Symbol)-[:IMPLEMENTS]->(:Symbol)
// (:Symbol)-[:OVERRIDES]->(:Symbol)

// Dependencies
// (:Symbol)-[:IMPORTS]->(:Symbol)
// (:Symbol)-[:EXPORTS]->(:Symbol)
// (:Symbol)-[:DEPENDS_ON]->(:Symbol)
// (:Symbol)-[:CALLS]->(:Symbol)
// (:Symbol)-[:REFERENCES]->(:Symbol)
// (:Symbol)-[:INSTANTIATES]->(:Symbol)

// Data flow
// (:Symbol)-[:RETURNS]->(:Symbol)
// (:Symbol)-[:ACCEPTS]->(:Symbol)
// (:Symbol)-[:PUBLISHES]->(:Symbol)
// (:Symbol)-[:SUBSCRIBES]->(:Symbol)

// Testing & Configuration
// (:Symbol)-[:TESTS]->(:Symbol)
// (:Symbol)-[:CONFIGURES]->(:Symbol)

// Architectural
// (:Symbol)-[:ROUTES_TO]->(:Symbol)
// (:Symbol)-[:HANDLES]->(:Symbol)
```

### 6.2 Node Properties

| Property | Type | Description |
|----------|------|-------------|
| id | String | Unique symbol ID |
| name | String | Short name |
| kind | String | SymbolKind enum value |
| language | String | Language enum value |
| repository | String | Repository name |
| namespace | String | Full namespace path |
| parentClass | String? | Parent class name if member |
| signature | String? | Method/function signature |
| docComment | String? | Documentation comment text |
| contentHash | String | SHA256 of source |
| relativePath | String | File path in repo |
| startLine | Integer | 1-indexed |
| endLine | Integer |  |
| startColumn | Integer | 0-indexed |
| endColumn | Integer |  |
| metadata | String (JSON) | Arbitrary extras |

### 6.3 Key Cypher Queries

```cypher
-- Find symbol by fuzzy name within repository
MATCH (s:Symbol)
WHERE s.repository = $repository
  AND toLower(s.name) CONTAINS toLower($name)
RETURN s
LIMIT $limit;

-- Find all references to a symbol
MATCH (target:Symbol {id: $symbolId})
MATCH (source:Symbol)-[r:REFERENCES|CALLS|USES|IMPORTS|INSTANTIATES]->(target)
RETURN source, type(r) as relationshipType, r
LIMIT $limit;

-- Find callers (methods/functions that call this)
MATCH (target:Symbol {id: $symbolId})
MATCH (caller:Symbol)-[r:CALLS]->(target)
RETURN caller
LIMIT $limit;

-- Find callees (functions this symbol calls)
MATCH (source:Symbol {id: $symbolId})
MATCH (source)-[r:CALLS]->(callee:Symbol)
RETURN callee
LIMIT $limit;

-- Find implementations of an interface
MATCH (iface:Symbol {id: $symbolId})
MATCH (impl:Symbol)-[r:IMPLEMENTS]->(iface)
RETURN impl
LIMIT $limit;

-- Find inheritors (subclasses)
MATCH (parent:Symbol {id: $symbolId})
MATCH (child:Symbol)-[r:INHERITS]->(parent)
RETURN child
LIMIT $limit;

-- Find tests
MATCH (source:Symbol {id: $symbolId})
MATCH (test:Symbol)-[r:TESTS]->(source)
RETURN test
LIMIT $limit;

-- Find tests (reverse: find what a test tests)
MATCH (test:Symbol {id: $symbolId})
MATCH (test)-[r:TESTS]->(target:Symbol)
RETURN target
LIMIT $limit;

-- Expand neighbors (multi-hop)
MATCH (seed:Symbol)
WHERE seed.id IN $seedIds
MATCH path = (seed)-[*1..$hops]-(neighbor:Symbol)
WHERE ALL(r IN relationships(path) WHERE type(r) IN $relationshipTypes)
RETURN DISTINCT neighbor, path
LIMIT $limit;

-- Related symbols (all direct connections)
MATCH (s:Symbol {id: $symbolId})-[r]-(neighbor:Symbol)
RETURN neighbor, type(r) as relationshipType
LIMIT $limit;

-- Repository summary
MATCH (s:Symbol {repository: $repository})
RETURN s.kind AS kind, count(s) AS count
ORDER BY count DESC;

-- List symbols with optional kind filter
MATCH (s:Symbol {repository: $repository})
WHERE $kind IS NULL OR s.kind = $kind
RETURN s
ORDER BY s.name
SKIP $offset
LIMIT $limit;
```

### 6.4 Architectural Node Detection

Language analyzers should tag nodes with additional labels based on conventions:

| Convention | Detected Labels |
|------------|----------------|
| Class ends with "Controller" | `:Controller` |
| Class ends with "Service" | `:Service` |
| Class ends with "Repository" | `:Repository` |
| Class ends with "Dto" or "DTO" | `:DTO` |
| Class has @Entity decorator/attribute | `:Entity` |
| Class ends with "Command" | `:Command` |
| Class ends with "Query" | `:Query` |
| Class extends Event | `:Event` |
| File in tests/ or *.test.* or *_test.* | `:Test` |
| File in migrations/ | `:Migration` |
| File is *.config.* or in config/ | `:Config` |
| Route decorator / attribute present | `:Route` |

---

## 7. Qdrant Vector Schema

### 7.1 Collections

```typescript
// packages/infra/src/qdrant/collections.ts

const COLLECTIONS = {
  code: {
    name: "code",
    vectorSize: 768,        // nomic-embed-text: 768 dimensions
    distance: "Cosine",
    // Payload indexes for filtered search
    payloadIndexes: [
      { field: "language", type: "keyword" },
      { field: "repository", type: "keyword" },
      { field: "kind", type: "keyword" },
      { field: "namespace", type: "keyword" },
      { field: "className", type: "keyword" },
      { field: "relativePath", type: "keyword" },
    ],
  },

  documentation: {
    name: "documentation",
    vectorSize: 768,
    distance: "Cosine",
    payloadIndexes: [
      { field: "repository", type: "keyword" },
      { field: "relativePath", type: "keyword" },
      { field: "kind", type: "keyword" },
    ],
  },
};
```

### 7.2 What Gets Embedded (Code)

For each symbol extracted by the language analyzer, the embedding text is constructed as:

```
[${language}] [${kind}] ${namespace}.${name}
${signature}
${docComment}
${sourceSnippet}
```

Example for a TypeScript method:

```
[typescript] [method] PaymentService.processPayment
async processPayment(amount: Money, method: PaymentMethod): Promise<PaymentResult>
/**
 * Processes a payment using the configured payment provider.
 * Validates the amount, checks for fraud, and executes the transaction.
 */
async processPayment(amount: Money, method: PaymentMethod): Promise<PaymentResult> {
  this.validateAmount(amount);
  await this.fraudCheck(amount, method);
  const result = await this.provider.charge(amount, method);
  return result;
}
```

### 7.3 What Gets Embedded (Documentation)

Each section of a documentation file is embedded separately:

```
[documentation] ${heading}
${content}
```

The heading includes the full path hierarchy: `file.md > Section > Subsection`

---

## 8. MCP Tool Contracts

Every tool follows the MCP `Tool` shape with `name`, `description`, and `inputSchema` (JSON Schema).

### 8.1 Tool Definitions

```typescript
// ============================================================
// 1. search_code
// ============================================================
const search_code = {
  name: "search_code",
  description: "Search for code symbols using natural language. Combines vector similarity with graph expansion for context-aware results.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Natural language query describing what to find" },
      repository: { type: "string", description: "Repository name to search within" },
      language: { type: "string", enum: Object.values(Language), description: "Filter by language" },
      kind: { type: "string", enum: Object.values(SymbolKind), description: "Filter by symbol kind" },
      limit: { type: "number", default: 10, maximum: 50, description: "Max results" },
      includeTests: { type: "boolean", default: false },
    },
    required: ["query", "repository"],
  },
};

// ============================================================
// 2. search_documentation
// ============================================================
const search_documentation = {
  name: "search_documentation",
  description: "Search documentation files (README, architecture docs, ADRs) using natural language.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      repository: { type: "string" },
      limit: { type: "number", default: 10 },
    },
    required: ["query", "repository"],
  },
};

// ============================================================
// 3. find_symbol
// ============================================================
const find_symbol = {
  name: "find_symbol",
  description: "Find a specific symbol by exact or fuzzy name match.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Symbol name (exact or partial)" },
      repository: { type: "string" },
      kind: { type: "string", enum: Object.values(SymbolKind) },
      exact: { type: "boolean", default: false },
      limit: { type: "number", default: 10 },
    },
    required: ["name", "repository"],
  },
};

// ============================================================
// 4. find_references
// ============================================================
const find_references = {
  name: "find_references",
  description: "Find all symbols that reference the given symbol.",
  inputSchema: {
    type: "object",
    properties: {
      symbolId: { type: "string", description: "Symbol ID (from search results)" },
      repository: { type: "string" },
      limit: { type: "number", default: 20 },
    },
    required: ["symbolId", "repository"],
  },
};

// ============================================================
// 5. find_callers
// ============================================================
const find_callers = {
  name: "find_callers",
  description: "Find all functions/methods that call the given function/method.",
  inputSchema: {
    type: "object",
    properties: {
      symbolId: { type: "string" },
      repository: { type: "string" },
      limit: { type: "number", default: 20 },
    },
    required: ["symbolId", "repository"],
  },
};

// ============================================================
// 6. find_callees
// ============================================================
const find_callees = {
  name: "find_callees",
  description: "Find all functions/methods called by the given function/method.",
  inputSchema: {
    type: "object",
    properties: {
      symbolId: { type: "string" },
      repository: { type: "string" },
      limit: { type: "number", default: 20 },
    },
    required: ["symbolId", "repository"],
  },
};

// ============================================================
// 7. find_implementations
// ============================================================
const find_implementations = {
  name: "find_implementations",
  description: "Find all implementations of an interface or abstract class/method.",
  inputSchema: {
    type: "object",
    properties: {
      symbolId: { type: "string" },
      repository: { type: "string" },
      limit: { type: "number", default: 20 },
    },
    required: ["symbolId", "repository"],
  },
};

// ============================================================
// 8. find_inheritors
// ============================================================
const find_inheritors = {
  name: "find_inheritors",
  description: "Find all subclasses / types that inherit from the given class.",
  inputSchema: {
    type: "object",
    properties: {
      symbolId: { type: "string" },
      repository: { type: "string" },
      limit: { type: "number", default: 20 },
    },
    required: ["symbolId", "repository"],
  },
};

// ============================================================
// 9. find_tests
// ============================================================
const find_tests = {
  name: "find_tests",
  description: "Find tests related to the given symbol, or find what a test covers.",
  inputSchema: {
    type: "object",
    properties: {
      symbolId: { type: "string" },
      repository: { type: "string" },
      limit: { type: "number", default: 20 },
    },
    required: ["symbolId", "repository"],
  },
};

// ============================================================
// 10. find_routes
// ============================================================
const find_routes = {
  name: "find_routes",
  description: "Find HTTP routes / API endpoints in the repository.",
  inputSchema: {
    type: "object",
    properties: {
      repository: { type: "string" },
      method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
      path: { type: "string", description: "Partial path match" },
      limit: { type: "number", default: 30 },
    },
    required: ["repository"],
  },
};

// ============================================================
// 11. find_configuration
// ============================================================
const find_configuration = {
  name: "find_configuration",
  description: "Find configuration settings, environment variables, and config files.",
  inputSchema: {
    type: "object",
    properties: {
      repository: { type: "string" },
      key: { type: "string", description: "Config key to search for (e.g., DATABASE_URL)" },
      limit: { type: "number", default: 20 },
    },
    required: ["repository"],
  },
};

// ============================================================
// 12. expand_graph
// ============================================================
const expand_graph = {
  name: "expand_graph",
  description: "Expand from one or more symbol IDs through the graph to find connected symbols. Useful after getting initial results to find related code.",
  inputSchema: {
    type: "object",
    properties: {
      symbolIds: { type: "array", items: { type: "string" } },
      repository: { type: "string" },
      hops: { type: "number", default: 1, minimum: 1, maximum: 3 },
      relationshipTypes: {
        type: "array",
        items: { type: "string", enum: Object.values(RelationshipKind) },
        description: "Which relationship types to traverse. Default: all.",
      },
      limit: { type: "number", default: 30 },
    },
    required: ["symbolIds", "repository"],
  },
};

// ============================================================
// 13. related_symbols
// ============================================================
const related_symbols = {
  name: "related_symbols",
  description: "Find symbols directly related to the given symbol (1-hop neighbors).",
  inputSchema: {
    type: "object",
    properties: {
      symbolId: { type: "string" },
      repository: { type: "string" },
      limit: { type: "number", default: 30 },
    },
    required: ["symbolId", "repository"],
  },
};

// ============================================================
// 14. list_symbols
// ============================================================
const list_symbols = {
  name: "list_symbols",
  description: "List symbols in a repository, optionally filtered by kind. Useful for exploration.",
  inputSchema: {
    type: "object",
    properties: {
      repository: { type: "string" },
      kind: { type: "string", enum: Object.values(SymbolKind) },
      limit: { type: "number", default: 50 },
      offset: { type: "number", default: 0 },
    },
    required: ["repository"],
  },
};

// ============================================================
// 15. repository_summary
// ============================================================
const repository_summary = {
  name: "repository_summary",
  description: "Get a high-level summary of the repository: symbol counts by kind and language, total symbols, total relationships.",
  inputSchema: {
    type: "object",
    properties: {
      repository: { type: "string" },
    },
    required: ["repository"],
  },
};

// ============================================================
// 16. architecture_summary
// ============================================================
const architecture_summary = {
  name: "architecture_summary",
  description: "Get an architectural overview of the repository: key services, controllers, DTOs, and their relationships. Useful for understanding the big picture.",
  inputSchema: {
    type: "object",
    properties: {
      repository: { type: "string" },
    },
    required: ["repository"],
  },
};

// ============================================================
// 17. search_similar
// ============================================================
const search_similar = {
  name: "search_similar",
  description: "Find code semantically similar to a given symbol. Uses the vector embedding of the symbol to find neighbors.",
  inputSchema: {
    type: "object",
    properties: {
      symbolId: { type: "string" },
      repository: { type: "string" },
      limit: { type: "number", default: 10 },
    },
    required: ["symbolId", "repository"],
  },
};

// ============================================================
// 18-22. File Operations
// ============================================================
const read_file = {
  name: "read_file",
  description: "Read a file from the repository. Returns the full file content or a specific range of lines.",
  inputSchema: {
    type: "object",
    properties: {
      repository: { type: "string" },
      path: { type: "string", description: "Relative path within the repository" },
      startLine: { type: "number", description: "1-indexed start line (optional)" },
      endLine: { type: "number", description: "1-indexed end line (optional)" },
    },
    required: ["repository", "path"],
  },
};

const write_file = {
  name: "write_file",
  description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
  inputSchema: {
    type: "object",
    properties: {
      repository: { type: "string" },
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["repository", "path", "content"],
  },
};

const update_file = {
  name: "update_file",
  description: "Update a file with one or more precise text replacements. Each edit finds exact text and replaces it.",
  inputSchema: {
    type: "object",
    properties: {
      repository: { type: "string" },
      path: { type: "string" },
      edits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            oldText: { type: "string", description: "Exact text to find" },
            newText: { type: "string", description: "Replacement text" },
          },
          required: ["oldText", "newText"],
        },
      },
    },
    required: ["repository", "path", "edits"],
  },
};

const delete_file = {
  name: "delete_file",
  description: "Delete a file from the repository.",
  inputSchema: {
    type: "object",
    properties: {
      repository: { type: "string" },
      path: { type: "string" },
    },
    required: ["repository", "path"],
  },
};

const create_file = {
  name: "create_file",
  description: "Create a new file in the repository. Fails if the file already exists.",
  inputSchema: {
    type: "object",
    properties: {
      repository: { type: "string" },
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["repository", "path", "content"],
  },
};
```

### 8.2 MCP Server Registration

The MCP server registers all tools at startup and routes calls to the appropriate query/command handler:

```typescript
// packages/mcp-server/src/server.ts (sketch)

class McpServer {
  private tools: Map<string, ToolHandler>;

  register(tool: ToolDefinition, handler: ToolHandler): void;
  handleToolCall(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}

interface ToolHandler {
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}
```

---

## 9. Indexing Pipeline

### 9.1 Full Indexing Flow

```
                    ┌──────────────┐
                    │  Repository  │
                    │   (files)    │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ Language     │
                    │ Detector     │  ← extension-based + shebang
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ File Walker  │  ← walks dirs, respects .gitignore
                    └──┬──┬──┬─────┘
                       │  │  │
              ┌────────▼──▼──▼──────────┐
              │   Language Analyzers     │
              │  ┌───────┐ ┌──────────┐ │
              │  │ C#    │ │ TypeScript│ │
              │  │Roslyn │ │ TS Comp. │ │
              │  └───────┘ └──────────┘ │
              │  ┌───────┐ ┌──────────┐ │
              │  │ PHP   │ │ Python   │ │
              │  │Parser │ │ LibCST   │ │
              │  └───────┘ └──────────┘ │
              └────────────┬────────────┘
                           │
                   ┌───────▼────────┐
                   │  Symbol Store  │  ← in-memory during indexing
                   │  (aggregates   │
                   │   all symbols) │
                   └──┬─────────┬───┘
                      │         │
            ┌─────────▼──┐  ┌──▼──────────┐
            │  Neo4j     │  │  Qdrant     │
            │  Batch     │  │  Batch      │
            │  Upsert    │  │  Upsert     │
            └────────────┘  └─────────────┘
```

### 9.2 Incremental Indexing Flow

```
Git commit change / File watcher event
                │
        ┌───────▼───────┐
        │  Get changed  │
        │  files (git   │
        │  diff)        │
        └───────┬───────┘
                │
        ┌───────▼───────┐
        │  For each     │
        │  file:        │
        │               │
        │  added    → index
        │  modified → re-index (delete old, insert new)
        │  deleted  → remove symbols
        │  renamed  → update paths
        └───────────────┘
                │
        ┌───────▼───────┐
        │  Symbol        │
        │  Differ        │  ← Compare old vs new symbols
        │               │     Only update what changed
        └───────┬───────┘
                │
        ┌───────▼───────┐
        │  Update        │
        │  Neo4j +       │
        │  Qdrant        │
        └───────────────┘
```

### 9.3 Documentation Indexing

```
Walk repository for doc files
        │
        ▼
  AI/
  architecture.md
  conventions.md
  domain.md
  decisions.md
  components.md
  README.md
  docs/**/*.md
        │
        ▼
  Parse Markdown → extract sections
        │
        ▼
  Generate embedding for each section
        │
        ▼
  Store in Qdrant (collection: "documentation")
```

---

## 10. Hybrid Retriever

### 10.1 Algorithm

```
Input: userQuery, repository, options
                │
        ┌───────▼───────┐
        │  1. Generate  │
        │  embedding    │
        │  for query    │
        └───────┬───────┘
                │
        ┌───────▼───────┐
        │  2. Search    │
        │  Qdrant       │
        │  top-K code   │  ← K = options.maxVectorHits (default 20)
        │  + top-K docs │
        └───────┬───────┘
                │
        ┌───────▼───────┐
        │  3. Graph     │
        │  Expansion    │
        │  For each     │
        │  vector hit:  │
        │  expand 1-hop │  ← H = options.graphExpansionHops (default 1)
        │  neighbors    │
        │  from Neo4j   │
        └───────┬───────┘
                │
        ┌───────▼───────┐
        │  4. Merge &   │
        │  Deduplicate  │
        │  (by symbolId)│
        └───────┬───────┘
                │
        ┌───────▼───────┐
        │  5. Rank      │
        │  - vector     │
        │    similarity  │
        │  - graph      │
        │    distance    │
        │  - symbol kind│
        │    weights     │
        │  - freshness   │
        └───────┬───────┘
                │
        ┌───────▼───────┐
        │  6. Truncate  │
        │  to maxResults│
        └───────┬───────┘
                │
        ┌───────▼───────┐
        │  7. Context   │
        │  Compression  │
        │  - trim long  │
        │    files       │
        │  - prioritize  │
        │    signatures  │
        │  - token budget│
        │    check       │
        └───────┬───────┘
                │
        ┌───────▼───────┐
        │  8. Return    │
        │  RankedContext│
        └───────────────┘
```

### 10.2 Ranking Weights

```typescript
const DEFAULT_RANKING_WEIGHTS = {
  vectorScore: 0.5,        // Cosine similarity from Qdrant
  graphDistance: 0.2,      // 1.0 for direct neighbor, 0.5 for 2-hop, etc.
  symbolKindBoost: 0.15,   // Boost for Service, Controller, Entity, etc.
  referenceCount: 0.1,     // Symbols referenced by many others rank higher
  freshness: 0.05,         // Recently modified files get slight boost
};
```

### 10.3 Context Compression Strategies

| Strategy | Description |
|----------|-------------|
| **Signature-only** | For methods/functions, return only the signature + doc comment, not the body |
| **Snippet truncation** | Cap source code to 50 lines per symbol |
| **File-level dedup** | If 5+ symbols from the same file, return the whole file path instead |
| **Token budget** | Hard stop when accumulated tokens exceed maxTokens |
| **Import stripping** | Remove import statements from snippets unless the import IS the result |
| **Test deprioritization** | If includeTests=false, strip test symbols entirely |

### 10.4 Token Budgeting

```typescript
class TokenBudgetService {
  estimateTokens(text: string): number {
    // Conservative estimate: chars / 3.5 for code
    // Better: use tiktoken or equivalent tokenizer
    return Math.ceil(text.length / 3.5);
  }

  fitWithinBudget(
    items: RankedContextItem[],
    maxTokens: number
  ): RankedContextItem[] {
    const result: RankedContextItem[] = [];
    let used = 0;

    for (const item of items) {
      const tokens = this.estimateTokens(item.snippet);
      if (used + tokens > maxTokens) {
        // Try with signature-only
        const sigTokens = this.estimateTokens(item.symbol.signature || "");
        if (used + sigTokens <= maxTokens) {
          item.snippet = item.symbol.signature!;
          result.push(item);
          used += sigTokens;
        }
        break; // Hard stop
      }
      result.push(item);
      used += tokens;
    }

    return result;
  }
}
```

---

## 11. Docker Architecture

### 11.1 Service Map

```
┌─────────────────────────────────────────────────────────┐
│                    Docker Network                        │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ mcp-     │  │ retriever│  │ indexer  │              │
│  │ server   │  │ (HTTP)   │  │ (HTTP)   │              │
│  │ :3000    │  │ :3001    │  │ :3002    │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       │             │             │                     │
│       └─────────────┼─────────────┘                     │
│                     │                                   │
│       ┌─────────────┼─────────────┐                     │
│       │             │             │                     │
│  ┌────▼─────┐  ┌────▼─────┐  ┌───▼──────────┐         │
│  │ Neo4j    │  │ Qdrant   │  │ Ollama        │         │
│  │ :7474    │  │ :6333    │  │ :11434        │         │
│  │ :7687    │  │ :6334    │  │ (optional)    │         │
│  └──────────┘  └──────────┘  └───────────────┘         │
│                                                         │
│  ┌──────────┐  ┌──────────┐                             │
│  │ Redis    │  │ Postgres │  (optional)                 │
│  │ :6379    │  │ :5432    │                             │
│  └──────────┘  └──────────┘                             │
│                                                         │
│  ┌──────────────────────────────┐                       │
│  │ Volumes                      │                       │
│  │ neo4j-data, qdrant-storage,  │                       │
│  │ ollama-models, redis-data,   │                       │
│  │ pgdata                       │                       │
│  └──────────────────────────────┘                       │
└─────────────────────────────────────────────────────────┘
```

### 11.2 docker-compose.yml

```yaml
version: "3.9"

services:
  # ——— Core Services ———

  mcp-server:
    build:
      context: .
      dockerfile: docker/mcp-server/Dockerfile
    ports:
      - "3000:3000"
    environment:
      - RETRIEVER_URL=http://retriever:3001
      - INDEXER_URL=http://indexer:3002
      - REPOSITORIES_PATH=/repositories
    volumes:
      - ${REPOSITORIES_PATH:-~/repos}:/repositories:ro
      - mcp-log:/var/log/code-indexer
    depends_on:
      retriever:
        condition: service_healthy
      indexer:
        condition: service_started
    restart: unless-stopped
    stdin_open: true   # Required for MCP stdio (when not using HTTP)
    tty: true

  retriever:
    build:
      context: .
      dockerfile: docker/retriever/Dockerfile
    ports:
      - "3001:3001"
    environment:
      - NEO4J_URI=bolt://neo4j:7687
      - NEO4J_USER=neo4j
      - NEO4J_PASSWORD=${NEO4J_PASSWORD:-password}
      - QDRANT_URL=http://qdrant:6334
      - EMBEDDING_PROVIDER=${EMBEDDING_PROVIDER:-ollama}
      - OLLAMA_URL=http://ollama:11434
      - OPENAI_API_KEY=${OPENAI_API_KEY:-}
      - LOG_LEVEL=${LOG_LEVEL:-info}
    depends_on:
      neo4j:
        condition: service_healthy
      qdrant:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  indexer:
    build:
      context: .
      dockerfile: docker/indexer/Dockerfile
    ports:
      - "3002:3002"
    environment:
      - NEO4J_URI=bolt://neo4j:7687
      - NEO4J_USER=neo4j
      - NEO4J_PASSWORD=${NEO4J_PASSWORD:-password}
      - QDRANT_URL=http://qdrant:6334
      - EMBEDDING_PROVIDER=${EMBEDDING_PROVIDER:-ollama}
      - OLLAMA_URL=http://ollama:11434
      - OPENAI_API_KEY=${OPENAI_API_KEY:-}
      - REPOSITORIES_PATH=/repositories
      - LOG_LEVEL=${LOG_LEVEL:-info}
    volumes:
      - ${REPOSITORIES_PATH:-~/repos}:/repositories
    depends_on:
      neo4j:
        condition: service_healthy
      qdrant:
        condition: service_healthy
    restart: unless-stopped

  # ——— Data Services ———

  neo4j:
    image: neo4j:5.25-enterprise
    ports:
      - "7474:7474"   # HTTP
      - "7687:7687"   # Bolt
    environment:
      - NEO4J_AUTH=neo4j/${NEO4J_PASSWORD:-password}
      - NEO4J_apoc_export_file_enabled=true
      - NEO4J_apoc_import_file_enabled=true
      - NEO4J_apoc_import_file_use__neo4j__config=true
      - NEO4J_PLUGINS=["apoc", "graph-data-science"]
    volumes:
      - neo4j-data:/data
      - neo4j-logs:/logs
    healthcheck:
      test: ["CMD", "cypher-shell", "-u", "neo4j", "-p", "${NEO4J_PASSWORD:-password}", "RETURN 1"]
      interval: 10s
      timeout: 10s
      retries: 10
    restart: unless-stopped

  qdrant:
    image: qdrant/qdrant:v1.12
    ports:
      - "6333:6333"   # HTTP
      - "6334:6334"   # gRPC
    volumes:
      - qdrant-storage:/qdrant/storage
      - ./docker/qdrant/config.yaml:/qdrant/config/production.yaml
    environment:
      - QDRANT__SERVICE__GRPC_PORT=6334
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:6333/health"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  # ——— Optional Services ———

  ollama:
    image: ollama/ollama:latest
    profiles: ["ollama"]
    ports:
      - "11434:11434"
    volumes:
      - ollama-models:/root/.ollama
    environment:
      - OLLAMA_KEEP_ALIVE=24h
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    restart: unless-stopped
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        ollama serve &
        sleep 5
        ollama pull nomic-embed-text
        wait

  redis:
    image: redis:7-alpine
    profiles: ["full"]
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    profiles: ["full"]
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_USER=codeindexer
      - POSTGRES_PASSWORD=${PG_PASSWORD:-password}
      - POSTGRES_DB=codeindexer
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U codeindexer"]
      interval: 5s
    restart: unless-stopped

volumes:
  neo4j-data:
  neo4j-logs:
  qdrant-storage:
  ollama-models:
  redis-data:
  pgdata:
  mcp-log:
```

---

## 12. Development Roadmap

### Phase 0 — Project Foundation (Week 1-2)

| ID | Task | Dependencies |
|----|------|-------------|
| P0-01 | Initialize monorepo with pnpm workspaces, tsconfig.base.json, .eslintrc | None |
| P0-02 | Implement shared domain models (Symbol, Relationship, enums) | P0-01 |
| P0-03 | Define all interfaces (ports) in @code-indexer/shared | P0-02 |
| P0-04 | Set up tsyringe DI container with placeholder bindings | P0-03 |
| P0-05 | Create Neo4j schema migration (001-schema.cypher) | None |
| P0-06 | Create Qdrant collection definitions | None |
| P0-07 | Set up Docker Compose with Neo4j + Qdrant + health checks | P0-05, P0-06 |
| P0-08 | Implement logger utility (pino-based) | P0-01 |
| P0-09 | Implement ID generator utility | P0-01 |
| P0-10 | Implement content hasher (SHA256) | P0-01 |

### Phase 1 — Infrastructure Layer (Week 3-4)

| ID | Task | Dependencies |
|----|------|-------------|
| P1-01 | Implement Neo4jConnection (driver, session management, retry logic) | P0-07 |
| P1-02 | Implement QdrantConnection (client, collection init) | P0-07 |
| P1-03 | Implement Neo4jGraphRepository (upsertSymbol, deleteSymbol, findSymbol) | P1-01, P0-03 |
| P1-04 | Implement Neo4jGraphRepository (relationships — upsert, find) | P1-03 |
| P1-05 | Implement Neo4jGraphRepository (graph traversal — expand, callers, callees) | P1-04 |
| P1-06 | Implement Neo4jGraphRepository (list, summary, search) | P1-05 |
| P1-07 | Implement QdrantVectorRepository (upsert, delete, clear) | P1-02, P0-03 |
| P1-08 | Implement QdrantVectorRepository (search, filtered search) | P1-07 |
| P1-09 | Implement OllamaEmbeddingGenerator | P0-03 |
| P1-10 | Implement OpenAIEmbeddingGenerator | P0-03 |
| P1-11 | Implement LocalFileSystem adapter | P0-03 |
| P1-12 | Implement SimpleGitAdapter (git log, diff, changed files) | P0-03 |
| P1-13 | Wire up DI container with all infrastructure bindings | P1-03, P1-07, P1-09, P1-11, P1-12 |

### Phase 2 — Language Analyzers (Week 5-8)

Each analyzer is completely independent. They can be built in parallel.

| ID | Task | Dependencies |
|----|------|-------------|
| P2-01 | Define analyzer abstract base class and factory | P0-03 |
| P2-02 | Build analyzer-csharp: Roslyn bridge process (.NET tool) | P2-01 |
| P2-03 | Build analyzer-csharp: symbol extractor | P2-02 |
| P2-04 | Build analyzer-csharp: relationship extractor | P2-03 |
| P2-05 | Build analyzer-csharp: architectural convention detector | P2-03 |
| P2-06 | Build analyzer-typescript: TS Compiler API analyzer | P2-01 |
| P2-07 | Build analyzer-typescript: symbol extractor | P2-06 |
| P2-08 | Build analyzer-typescript: relationship extractor | P2-07 |
| P2-09 | Build analyzer-typescript: architectural convention detector | P2-07 |
| P2-10 | Build analyzer-php: PHP-Parser + PHPStan bridge | P2-01 |
| P2-11 | Build analyzer-php: symbol extractor | P2-10 |
| P2-12 | Build analyzer-php: relationship extractor | P2-11 |
| P2-13 | Build analyzer-php: architectural convention detector | P2-11 |
| P2-14 | Build analyzer-python: LibCST + Jedi bridge | P2-01 |
| P2-15 | Build analyzer-python: symbol extractor | P2-14 |
| P2-16 | Build analyzer-python: relationship extractor | P2-15 |
| P2-17 | Build analyzer-python: architectural convention detector | P2-15 |
| P2-18 | Build analyzer-treesitter: fallback analyzer for all 4 languages | P2-01 |
| P2-19 | Build analyzer-treesitter: tree-sitter query files (C#, PHP, Python, TS) | P2-18 |
| P2-20 | Write analyzer integration tests (fixture repos for each language) | P2-RESPECTIVE |

### Phase 3 — Indexing Pipeline (Week 9-10)

| ID | Task | Dependencies |
|----|------|-------------|
| P3-01 | Implement LanguageDetector (extension mapping, shebang detection) | P0-03 |
| P3-02 | Implement FileWalker (directory walk, .gitignore support, file filtering) | P0-03 |
| P3-03 | Implement MemorySymbolStore (in-memory aggregator during indexing) | P0-03 |
| P3-04 | Implement IndexerService (orchestrates the full pipeline) | P3-01, P3-02, P3-03, P1-13, P2-* |
| P3-05 | Implement batch processing (process files in parallel with concurrency limit) | P3-04 |
| P3-06 | Implement SymbolDiffer (compare old vs new symbols, compute delta) | P0-02 |
| P3-07 | Implement IncrementalIndexer (git-based change detection + partial reindex) | P3-06, P1-12 |
| P3-08 | Implement FileWatcher-based incremental indexing | P3-07 |
| P3-09 | Implement DocumentationIndexer (markdown parsing, section extraction) | P3-04 |
| P3-10 | Write indexing integration tests (index a real open-source repo) | P3-04 |

### Phase 4 — Retrieval (Week 11-12)

| ID | Task | Dependencies |
|----|------|-------------|
| P4-01 | Implement RankerService (scoring, weighting, sorting) | P0-03 |
| P4-02 | Implement DeduplicatorService (symbol ID dedup, file-level dedup) | P0-03 |
| P4-03 | Implement TokenBudgetService (token estimation, budget fitting) | P0-03 |
| P4-04 | Implement ContextCompressorService (snippet truncation, signature fallback) | P4-03 |
| P4-05 | Implement RetrieverService (hybrid: vector + graph, full pipeline) | P4-01, P4-02, P4-04, P1-13 |
| P4-06 | Implement SearchCodeHandler (query handler) | P4-05 |
| P4-07 | Implement SearchDocumentationHandler | P4-05 |
| P4-08 | Implement FindSymbolHandler | P1-06 |
| P4-09 | Implement FindReferencesHandler | P1-06 |
| P4-10 | Implement FindCallersHandler | P1-06 |
| P4-11 | Implement FindCalleesHandler | P1-06 |
| P4-12 | Implement FindImplementationsHandler | P1-06 |
| P4-13 | Implement FindInheritorsHandler | P1-06 |
| P4-14 | Implement FindTestsHandler | P1-06 |
| P4-15 | Implement FindRoutesHandler | P1-06 |
| P4-16 | Implement FindConfigurationHandler | P1-06 |
| P4-17 | Implement ExpandGraphHandler | P1-06 |
| P4-18 | Implement RelatedSymbolsHandler | P1-06 |
| P4-19 | Implement SearchSimilarHandler | P1-08 |
| P4-20 | Implement RepositorySummaryHandler | P1-06 |
| P4-21 | Implement ArchitectureSummaryHandler | P1-06 |
| P4-22 | Implement ListSymbolsHandler | P1-06 |

### Phase 5 — MCP Server (Week 13-14)

| ID | Task | Dependencies |
|----|------|-------------|
| P5-01 | Implement MCP protocol (JSON-RPC, stdio transport) | P0-03 |
| P5-02 | Implement tool registry (register tools, route calls to handlers) | P5-01 |
| P5-03 | Implement all 22 MCP tool wrappers | P5-02, P4-*, P1-11 |
| P5-04 | Implement error handling middleware | P5-02 |
| P5-05 | Implement rate limiter middleware | P5-02 |
| P5-06 | Implement request/response logging | P5-02 |
| P5-07 | Implement MCP server health endpoint (when running in HTTP mode) | P5-01 |
| P5-08 | Write MCP server integration tests (mock client calling tools) | P5-03 |

### Phase 6 — CLI & DevOps (Week 15-16)

| ID | Task | Dependencies |
|----|------|-------------|
| P6-01 | Implement CLI entry point (commander-based) | P0-03 |
| P6-02 | Implement `index` command (full repository index) | P3-04 |
| P6-03 | Implement `index --watch` command (incremental with file watcher) | P3-08 |
| P6-04 | Implement `search` command (CLI search for testing) | P4-05 |
| P6-05 | Implement `serve` command (start MCP server) | P5-03 |
| P6-06 | Implement `graph-stats` command (Neo4j statistics) | P1-06 |
| P6-07 | Implement `clean` command (clear all data for a repository) | P1-06 |
| P6-08 | Create Dockerfiles for mcp-server, retriever, indexer | P5-03, P4-05, P3-04 |
| P6-09 | Create docker-compose.yml (full stack) | P6-08 |
| P6-10 | Create docker-compose.dev.yml (development overrides) | P6-09 |
| P6-11 | Write README.md with setup instructions | P6-09 |
| P6-12 | Create .env.example with all config vars | None |

### Phase 7 — Polish & Hardening (Week 17-18)

| ID | Task | Dependencies |
|----|------|-------------|
| P7-01 | Add retry logic to all external service calls | P1-13 |
| P7-02 | Add circuit breaker pattern for Neo4j/Qdrant connections | P7-01 |
| P7-03 | Add Prometheus metrics (index duration, search latency, error rates) | P5-03 |
| P7-04 | Performance tuning: batch sizing, parallel indexing, connection pooling | P3-04 |
| P7-05 | Security: input sanitization, path traversal prevention, rate limiting | P5-03 |
| P7-06 | Write comprehensive integration test suite (real-world repos) | ALL |
| P7-07 | Load test with large repositories (100K+ symbols) | ALL |
| P7-08 | Documentation: architecture docs, API docs, analyzer contribution guide | ALL |

---

## 13. AI Implementation Tasks

Each task below is designed to be completed by a coding agent in a single session.

### Task Format

```
Task ID: T-XXXX
Objective: One sentence goal
Requirements: Concrete what-to-build
Acceptance Criteria: Verifiable outcomes
Dependencies: Other task IDs
Definition of Done: Checklist
Suggested Tests: Test ideas
Estimated Complexity: S | M | L | XL
Context Files: What to read first
```

---

### T-001: Monorepo Scaffold
- **Objective:** Initialize pnpm monorepo with all package skeletons and shared config
- **Requirements:** pnpm workspaces, tsconfig.base.json with strict mode, ESLint config, .gitignore, .env.example, package.json in every package with correct naming (@code-indexer/*), build scripts
- **Acceptance Criteria:**
  - `pnpm install` succeeds at root
  - `pnpm build` runs `tsc` across all packages (empty src is fine)
  - `pnpm lint` runs ESLint across all packages
  - All tsconfigs extend tsconfig.base.json
- **Dependencies:** None
- **Definition of Done:**
  - [ ] Root package.json with workspaces config
  - [ ] pnpm-workspace.yaml
  - [ ] tsconfig.base.json (strict, ESNext, Node16, declaration, sourceMap)
  - [ ] .eslintrc.cjs (TypeScript strict rules)
  - [ ] .gitignore (node_modules, dist, .env, data/)
  - [ ] .env.example
  - [ ] packages/shared/package.json (name: @code-indexer/shared)
  - [ ] packages/infra/package.json
  - [ ] packages/indexing/package.json
  - [ ] packages/retrieval/package.json
  - [ ] packages/mcp-server/package.json
  - [ ] packages/cli/package.json
  - [ ] packages/analyzers/analyzer-interface/package.json
  - [ ] packages/analyzers/analyzer-csharp/package.json
  - [ ] packages/analyzers/analyzer-typescript/package.json
  - [ ] packages/analyzers/analyzer-php/package.json
  - [ ] packages/analyzers/analyzer-python/package.json
  - [ ] packages/analyzers/analyzer-treesitter/package.json
  - [ ] Root README.md with quickstart
- **Suggested Tests:** `pnpm install && pnpm build` returns exit 0
- **Estimated Complexity:** M

---

### T-002: Domain Models — Symbol & Enums
- **Objective:** Implement all domain models and enums in @code-indexer/shared
- **Requirements:** Symbol interface, SymbolKind enum, RelationshipKind enum, Language enum, SourceLocation interface, Relationship interface, all with proper TypeScript types and JSDoc comments
- **Acceptance Criteria:**
  - Symbol exported from @code-indexer/shared
  - All enums are const enums or string enums with explicit values
  - SourceLocation has all fields (repository, relativePath, startLine, endLine, startColumn, endColumn)
  - All types re-exported from index.ts barrel
  - Compiles with strict TypeScript
- **Dependencies:** T-001
- **Definition of Done:**
  - [ ] packages/shared/src/domain/enums.ts with SymbolKind, RelationshipKind, Language, CollectionName
  - [ ] packages/shared/src/domain/models.ts with Symbol, Relationship, SourceLocation
  - [ ] packages/shared/src/domain/value-objects.ts with SymbolId (branded string), RepositoryName
  - [ ] packages/shared/src/index.ts exports everything
  - [ ] JSDoc on every exported type
- **Suggested Tests:** TypeScript compilation, no runtime tests needed (types-only)
- **Estimated Complexity:** S

---

### T-003: Domain Models — DTOs & Value Objects
- **Objective:** Define all DTOs for search, indexing commands, and retrieval results
- **Requirements:** SearchQuery, SearchResult, RetrievalQuery, RetrievalResult, RankedContextItem, IndexCommand, IndexResult, RepositorySummary, VectorPayload, SearchHit, all as interfaces
- **Acceptance Criteria:** All DTOs exported, compiles cleanly
- **Dependencies:** T-002
- **Definition of Done:**
  - [ ] packages/shared/src/dto/search-query.dto.ts
  - [ ] packages/shared/src/dto/search-result.dto.ts
  - [ ] packages/shared/src/dto/retrieval.dto.ts
  - [ ] packages/shared/src/dto/index-command.dto.ts
  - [ ] packages/shared/src/dto/vector.dto.ts
  - [ ] packages/shared/src/dto/graph.dto.ts with GraphSymbol, Subgraph, RepositorySummary
  - [ ] Barrel export
- **Suggested Tests:** Compilation only
- **Estimated Complexity:** S

---

### T-004: Port Interfaces — All Contracts
- **Objective:** Define every service interface (port) in @code-indexer/shared
- **Requirements:** LanguageAnalyzer, GraphRepository, VectorRepository, EmbeddingGenerator, Indexer, Retriever, FileSystem, GitAdapter, SymbolStore interfaces with full method signatures
- **Acceptance Criteria:** All interfaces exported, no implementations, clear JSDoc
- **Dependencies:** T-003
- **Definition of Done:**
  - [ ] language-analyzer.interface.ts (with AnalysisResult, AnalysisError)
  - [ ] graph-repository.interface.ts
  - [ ] vector-repository.interface.ts (with SearchOptions, VectorFilters)
  - [ ] embedding-generator.interface.ts
  - [ ] indexer.interface.ts
  - [ ] retriever.interface.ts (with RetrievalQuery, RetrievalResult, RetrievalDebug)
  - [ ] file-system.interface.ts (with FileEdit)
  - [ ] git-adapter.interface.ts (with ChangedFile, Watcher)
  - [ ] symbol-store.interface.ts
  - [ ] Barrel export
- **Suggested Tests:** Compilation only
- **Estimated Complexity:** M

---

### T-005: Utility Functions
- **Objective:** Implement shared utilities: content hasher, ID generator, logger factory
- **Requirements:** SHA256 hasher using Node crypto, deterministic symbol ID generator (repo::path::symbolPath), pino-based logger factory with level configuration
- **Acceptance Criteria:**
  - `hashContent(text: string): string` returns consistent SHA256 hex
  - `generateSymbolId(repo, path, symbolPath): SymbolId` returns id in format `repo::relativePath::symbolPath`
  - `createLogger(name: string): Logger` returns configured pino logger
- **Dependencies:** T-002
- **Definition of Done:**
  - [ ] packages/shared/src/utils/hash.ts
  - [ ] packages/shared/src/utils/id-generator.ts
  - [ ] packages/shared/src/utils/logger.ts
  - [ ] Unit tests for hash and id-generator
- **Suggested Tests:**
  - `hashContent("hello")` returns known SHA256
  - `generateSymbolId("myrepo", "src/foo.ts", "Foo.bar")` returns `myrepo::src/foo.ts::Foo.bar`
  - Logger creates without throwing
- **Estimated Complexity:** S

---

### T-006: DI Container Setup
- **Objective:** Configure tsyringe DI container with all interface bindings (initially as placeholders)
- **Requirements:** Container that can be configured with real implementations later. All interfaces bound to placeholder/mock implementations or token names.
- **Acceptance Criteria:**
  - `container.resolve<GraphRepository>("GraphRepository")` returns a mock (for now)
  - Token constants for all interfaces
  - Module-based registration for easy swapping
- **Dependencies:** T-004
- **Definition of Done:**
  - [ ] packages/infra/src/di/container.ts
  - [ ] packages/infra/src/di/tokens.ts (injection token constants)
  - [ ] packages/infra/src/di/modules/ (one module per concern: graph, vector, embeddings, etc.)
  - [ ] Each module has a register() function
- **Suggested Tests:** Resolve each token, verify it returns something
- **Estimated Complexity:** M

---

### T-007: Neo4j Schema Migration
- **Objective:** Create the Neo4j schema migration with all constraints and indexes
- **Requirements:** Cypher script that creates uniqueness constraints, indexes, full-text indexes as specified in section 6
- **Acceptance Criteria:**
  - Script runs idempotently (IF NOT EXISTS)
  - Creates constraint on Symbol.id
  - Creates indexes on kind, language, name, repository
  - Creates full-text index on name, signature, docComment
- **Dependencies:** None
- **Definition of Done:**
  - [ ] packages/infra/src/neo4j/migrations/001-schema.cypher
  - [ ] Script tested against a running Neo4j instance
- **Suggested Tests:** Run against Neo4j container, verify constraints exist via `SHOW CONSTRAINTS`
- **Estimated Complexity:** S

---

### T-008: Docker Compose (Data Services)
- **Objective:** Create docker-compose.yml with Neo4j, Qdrant, and health checks
- **Requirements:** Neo4j 5.25, Qdrant v1.12, named volumes, health checks, environment variables via .env
- **Acceptance Criteria:**
  - `docker compose up -d` starts Neo4j and Qdrant
  - Both services report healthy within 30 seconds
  - Data persists across restarts (volumes work)
  - Qdrant config file for production settings
- **Dependencies:** None
- **Definition of Done:**
  - [ ] docker/docker-compose.yml (data services section)
  - [ ] docker/qdrant/config.yaml
  - [ ] .env.example updated with NEO4J_PASSWORD, QDRANT config
  - [ ] Tested with `docker compose up -d && docker compose ps` showing healthy
- **Suggested Tests:** `docker compose up -d`, wait, `curl localhost:6333/health`, `curl localhost:7474`
- **Estimated Complexity:** M

---

### T-009: Neo4jConnection
- **Objective:** Implement Neo4j connection manager with retry logic
- **Requirements:** Wrapper around neo4j-driver that handles connection lifecycle, session pool, retry with exponential backoff, health check
- **Acceptance Criteria:**
  - `connect()` establishes connection, retries 5 times with backoff
  - `getSession()` returns a session from the pool
  - `healthCheck()` returns true/false
  - `close()` gracefully shuts down
  - Reads NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD from env
- **Dependencies:** T-008 (need running Neo4j for testing), T-006
- **Definition of Done:**
  - [ ] packages/infra/src/neo4j/neo4j-connection.ts
  - [ ] Exponential backoff retry (1s, 2s, 4s, 8s, 16s)
  - [ ] Structured logging on connect/disconnect
  - [ ] Unit tests with mock driver
  - [ ] Integration test against real Neo4j
- **Suggested Tests:**
  - Unit: mock driver, verify retry on failure
  - Integration: connect to docker Neo4j, run `RETURN 1`, disconnect
- **Estimated Complexity:** M

---

### T-010: QdrantConnection
- **Objective:** Implement Qdrant connection manager with collection initialization
- **Requirements:** Wrapper around @qdrant/js-client-rest that creates collections if they don't exist, payload indexes, health check
- **Acceptance Criteria:**
  - `initialize()` creates code and documentation collections with correct vector size
  - Payload indexes created for language, repository, kind, namespace
  - `healthCheck()` pings Qdrant
- **Dependencies:** T-008
- **Definition of Done:**
  - [ ] packages/infra/src/qdrant/qdrant-connection.ts
  - [ ] packages/infra/src/qdrant/collections.ts (collection definitions)
  - [ ] Integration test: initialize, verify collections exist
- **Suggested Tests:** Integration: create collections, verify via Qdrant API
- **Estimated Complexity:** M

---

### T-011: Neo4jGraphRepository — Symbol CRUD
- **Objective:** Implement symbol upsert and delete operations in Neo4j
- **Requirements:** upsertSymbol uses MERGE to create/update a Symbol node with all properties. deleteSymbol removes a node and its relationships. Both operate in transactions.
- **Acceptance Criteria:**
  - `upsertSymbol(symbol)` creates or updates a Symbol node
  - Node has correct labels (Symbol + kind-specific label)
  - All properties stored correctly (including JSON metadata)
  - `deleteSymbol(id)` removes node + relationships
  - `deleteSymbols(ids)` batch deletes
  - `clearRepository(repo)` removes all symbols for a repo
- **Dependencies:** T-009
- **Definition of Done:**
  - [ ] upsert-symbol.cypher
  - [ ] delete-symbol.cypher
  - [ ] methods in neo4j-graph-repository.ts
  - [ ] Integration tests with real Neo4j
- **Suggested Tests:**
  - Upsert a symbol, read it back via cypher-shell
  - Upsert same symbol with changed property, verify update
  - Delete symbol, verify node gone
  - Clear repository, verify zero nodes
- **Estimated Complexity:** M

---

### T-012: Neo4jGraphRepository — Relationship CRUD
- **Objective:** Implement relationship upsert and batch operations
- **Requirements:** Upsert relationships between symbols. Batch upsert for efficiency. Delete all relationships for a symbol.
- **Acceptance Criteria:**
  - `upsertRelationship(rel)` creates relationship between nodes
  - Relationship type matches RelationshipKind
  - `upsertRelationships(rels)` batch creates in single transaction
  - `deleteRelationships(symbolId)` removes all relationships connected to symbol
- **Dependencies:** T-011
- **Definition of Done:**
  - [ ] upsert-relationship.cypher
  - [ ] Methods in neo4j-graph-repository.ts
  - [ ] Integration tests
- **Suggested Tests:**
  - Create two symbols, create CALLS relationship, verify
  - Batch create 100 relationships, verify count
  - Delete relationships, verify zero
- **Estimated Complexity:** M

---

### T-013: Neo4jGraphRepository — Symbol Lookups
- **Objective:** Implement findSymbol, findSymbolByName, listSymbols
- **Requirements:** Exact ID lookup, fuzzy name search within repository, paginated listing with kind filter
- **Acceptance Criteria:**
  - `findSymbol(id)` returns GraphSymbol or null
  - `findSymbolByName(repo, name)` returns partial matches, case-insensitive, uses fulltext index
  - `listSymbols(repo, kind, limit, offset)` returns paginated results
- **Dependencies:** T-011
- **Definition of Done:**
  - [ ] find-symbol.cypher
  - [ ] Methods in neo4j-graph-repository.ts
  - [ ] Integration tests
- **Suggested Tests:**
  - Insert known symbol, find by ID
  - Find by partial name, verify multiple results
  - List with kind filter, verify only that kind returned
  - List with offset/limit, verify pagination
- **Estimated Complexity:** M

---

### T-014: Neo4jGraphRepository — Reference & Call Resolution
- **Objective:** Implement findReferences, findCallers, findCallees
- **Requirements:** Graph traversal following REFERENCES, CALLS relationships with direction
- **Acceptance Criteria:**
  - `findReferences(id)` returns all symbols that REFERENCE the target
  - `findCallers(id)` returns functions/methods that CALL this
  - `findCallees(id)` returns functions/methods called BY this
  - All respect limit parameter
- **Dependencies:** T-012
- **Definition of Done:**
  - [ ] find-references.cypher
  - [ ] find-callers.cypher
  - [ ] find-callees.cypher
  - [ ] Methods in neo4j-graph-repository.ts
  - [ ] Integration tests
- **Suggested Tests:**
  - Create call chain A→B→C, verify callers(B)=[A], callees(B)=[C]
  - Verify empty results for symbol with no connections
- **Estimated Complexity:** M

---

### T-015: Neo4jGraphRepository — Inheritance & Implementation
- **Objective:** Implement findImplementations, findInheritors
- **Requirements:** Traverse IMPLEMENTS and INHERITS relationships
- **Acceptance Criteria:**
  - `findImplementations(interfaceId)` returns all classes implementing it
  - `findInheritors(classId)` returns all subclasses
- **Dependencies:** T-012
- **Definition of Done:**
  - [ ] find-implementations.cypher
  - [ ] find-inheritors.cypher
  - [ ] Methods in neo4j-graph-repository.ts
  - [ ] Integration tests
- **Suggested Tests:**
  - Interface I, classes A and B implement I → findImplementations(I) = [A, B]
  - Base class B, Derived D → findInheritors(B) = [D]
- **Estimated Complexity:** S

---

### T-016: Neo4jGraphRepository — Graph Expansion
- **Objective:** Implement expandGraph and relatedSymbols
- **Requirements:** Multi-hop traversal with relationship type filtering. Use APOC or plain Cypher for variable-length paths.
- **Acceptance Criteria:**
  - `expandGraph(seedIds, hops, relTypes)` returns subgraph
  - Works with 1-, 2-, and 3-hop expansion
  - Respects relationship type filter
  - Deduplicates nodes
  - `relatedSymbols(id)` returns 1-hop neighbors
- **Dependencies:** T-013
- **Definition of Done:**
  - [ ] expand-neighbors.cypher
  - [ ] Methods in neo4j-graph-repository.ts
  - [ ] Integration tests
- **Suggested Tests:**
  - Create A→B→C chain, expand from A with 2 hops, verify [A, B, C]
  - Filter by relationship type, verify only matching edges traversed
  - Large graph: verify limit works
- **Estimated Complexity:** L

---

### T-017: Neo4jGraphRepository — Specialized Searches
- **Objective:** Implement findTests, findRoutes, findConfiguration, repositorySummary, architectureSummary
- **Requirements:** Each specialized search targets specific node labels or relationships
- **Acceptance Criteria:**
  - `findTests(id)` finds Test nodes related to symbol
  - `findRoutes(repo)` finds Route nodes
  - `findConfiguration(repo, key?)` finds Config nodes
  - `repositorySummary(repo)` returns counts by kind, language
  - `architectureSummary(repo)` returns high-level structural overview
- **Dependencies:** T-013
- **Definition of Done:**
  - [ ] repository-summary.cypher
  - [ ] Methods in neo4j-graph-repository.ts
  - [ ] Integration tests
- **Suggested Tests:**
  - Insert test symbols with TESTS relationships, verify findTests
  - Insert route symbols, verify findRoutes
  - Insert 100 symbols of various kinds, verify summary counts match
- **Estimated Complexity:** M

---

### T-018: QdrantVectorRepository — Write Operations
- **Objective:** Implement upsertVectors, deleteVectors, clearCollection
- **Requirements:** Batch upsert of vector points with payloads. Batch delete by ID. Clear entire collection.
- **Acceptance Criteria:**
  - `upsertVectors(points)` stores vectors with payload
  - Payload validated (all required fields present)
  - `deleteVectors(ids)` removes points
  - `clearCollection(name)` deletes all points in collection
  - Batch size handling (max 1000 points per request)
- **Dependencies:** T-010
- **Definition of Done:**
  - [ ] packages/infra/src/qdrant/qdrant-vector-repository.ts (write methods)
  - [ ] Integration tests
- **Suggested Tests:**
  - Upsert 10 vectors, verify collection count
  - Delete 5 vectors, verify count reduced
  - Clear collection, verify count = 0
  - Upsert 2000 points (verify batching works)
- **Estimated Complexity:** M

---

### T-019: QdrantVectorRepository — Search Operations
- **Objective:** Implement vector search with and without payload filters
- **Requirements:** Cosine similarity search. Payload filters for language, repository, kind, namespace, className. Score threshold. Offset pagination.
- **Acceptance Criteria:**
  - `search(collection, vector, options)` returns top-K hits sorted by score
  - `searchWithFilters` applies payload filter correctly
  - Score threshold filters out low-relevance hits
  - Offset works for pagination
- **Dependencies:** T-018
- **Definition of Done:**
  - [ ] packages/infra/src/qdrant/qdrant-vector-repository.ts (read methods)
  - [ ] Integration tests with known vectors
- **Suggested Tests:**
  - Insert vectors with known payloads, search with query vector, verify returned
  - Filter by language, verify only matching language returned
  - Score threshold: verify low-score results excluded
  - Offset: first page and second page have no overlap
- **Estimated Complexity:** M

---

### T-020: OllamaEmbeddingGenerator
- **Objective:** Implement embedding generation using Ollama (nomic-embed-text)
- **Requirements:** Calls Ollama API. Configurable model, URL. Batch embedding. Text preprocessing for code (language-aware prefix). Implements EmbeddingGenerator interface.
- **Acceptance Criteria:**
  - `embed(text)` returns 768-dim vector
  - `embedBatch(texts)` processes multiple texts efficiently
  - `embedCode(code, language)` prepends language context
  - `embedDocumentation(text)` prepends doc context
  - `isAvailable()` pings Ollama
  - Error handling for Ollama unavailable
- **Dependencies:** T-004 (interface), T-008 (Ollama container or mock)
- **Definition of Done:**
  - [ ] packages/infra/src/embeddings/ollama-embedding-generator.ts
  - [ ] Text preprocessing: `[language] [kind] name\nsignature\ndoc\nsource`
  - [ ] Unit tests with mocked Ollama API
- **Suggested Tests:**
  - Unit: mock fetch, verify request shape, return known vector
  - Integration: with running Ollama, embed known text, verify dimension = 768
  - Batch: embed 5 texts, verify 5 vectors returned
- **Estimated Complexity:** M

---

### T-021: OpenAIEmbeddingGenerator
- **Objective:** Implement embedding generation using OpenAI (text-embedding-3-small)
- **Requirements:** Calls OpenAI API. Handles API key, rate limiting. Batch embedding. Implements EmbeddingGenerator interface.
- **Acceptance Criteria:**
  - `embed(text)` returns 1536-dim vector
  - Respects rate limits (with retry-after)
  - `isAvailable()` verifies API key is set
  - Falls back gracefully if key not configured
- **Dependencies:** T-004
- **Definition of Done:**
  - [ ] packages/infra/src/embeddings/openai-embedding-generator.ts
  - [ ] Rate limit handling with exponential backoff
  - [ ] Unit tests with mocked OpenAI API
- **Suggested Tests:**
  - Unit: mock fetch, verify Authorization header, return known vector
  - Error: simulated 429, verify retry
  - Error: simulated 401, verify graceful error
- **Estimated Complexity:** M

---

### T-022: LocalFileSystem
- **Objective:** Implement FileSystem interface for local filesystem operations
- **Requirements:** Read, write, update (with edit-based replacement), delete, create, list, exists, resolve path. Path security (prevent traversal outside repository root).
- **Acceptance Criteria:**
  - `readFile(path)` returns content
  - `writeFile(path, content)` writes file, creates directories
  - `updateFile(path, edits)` applies precise text replacements
  - `deleteFile(path)` removes file
  - `createFile(path, content)` creates but fails if exists
  - `listFiles(dir, pattern)` returns matching files
  - Path traversal prevention (reject `../../etc/passwd`)
- **Dependencies:** T-004
- **Definition of Done:**
  - [ ] packages/infra/src/storage/local-file-system.ts
  - [ ] Path sanitization
  - [ ] Unit tests with temp directories
- **Suggested Tests:**
  - Write then read, verify content matches
  - Update with single edit, verify replacement
  - Update with multiple edits, verify all applied
  - Create duplicate file, verify error
  - Path traversal attempt, verify rejected
- **Estimated Complexity:** M

---

### T-023: SimpleGitAdapter
- **Objective:** Implement GitAdapter using simple-git library
- **Requirements:** Get current commit, get changed files between commits, get file at specific commit. Minimal dependency on git binary (uses simple-git which bundles libgit).
- **Acceptance Criteria:**
  - `getCurrentCommit(repo)` returns HEAD SHA
  - `getChangedFiles(repo, sinceCommit)` returns ChangedFile[] with status
  - `getFileAtCommit(repo, path, commit)` returns file content
- **Dependencies:** T-004
- **Definition of Done:**
  - [ ] packages/infra/src/git/simple-git-adapter.ts
  - [ ] Unit tests with a git-initialized temp directory
- **Suggested Tests:**
  - Init git repo, make commit, verify getCurrentCommit
  - Make changes (add, modify, delete, rename), verify getChangedFiles
  - Get file content at specific commit, verify correctness
- **Estimated Complexity:** M

---

### T-024: MemorySymbolStore
- **Objective:** Implement in-memory symbol store used during indexing
- **Requirements:** Store symbols and relationships in memory during a single indexing run. Lookup by ID. Export all.
- **Acceptance Criteria:**
  - `add(symbol)` stores symbol
  - `get(id)` returns symbol
  - `getAll()` returns all symbols
  - `getRelationships()` returns all relationships
  - `addRelationship(rel)` stores relationship
  - `clear()` empties the store
  - Thread-safe for concurrent reads
- **Dependencies:** T-004
- **Definition of Done:**
  - [ ] packages/infra/src/storage/memory-symbol-store.ts
  - [ ] Uses Map<string, Symbol> internally
  - [ ] Unit tests
- **Suggested Tests:**
  - Add 1000 symbols, retrieve all, verify count
  - Add relationship, verify it references valid symbol IDs
  - Clear, verify empty
- **Estimated Complexity:** S

---

### T-025: DI Container Wiring
- **Objective:** Wire all infrastructure implementations into the DI container
- **Requirements:** All interfaces bound to their implementations. Environment-based configuration. Conditional bindings (Ollama vs OpenAI).
- **Acceptance Criteria:**
  - `container.resolve<GraphRepository>(GRAPH_REPOSITORY)` returns Neo4jGraphRepository
  - `container.resolve<VectorRepository>(VECTOR_REPOSITORY)` returns QdrantVectorRepository
  - `container.resolve<EmbeddingGenerator>(EMBEDDING_GENERATOR)` returns Ollama or OpenAI based on env
  - `container.resolve<FileSystem>(FILE_SYSTEM)` returns LocalFileSystem
  - `container.resolve<GitAdapter>(GIT_ADAPTER)` returns SimpleGitAdapter
- **Dependencies:** T-006, T-009, T-010, T-011, T-018, T-020, T-022, T-023, T-024
- **Definition of Done:**
  - [ ] packages/infra/src/di/container.ts updated with real bindings
  - [ ] Environment config loader
  - [ ] Conditional embedding provider binding
  - [ ] Integration test: resolve all tokens
- **Suggested Tests:** Resolve each token, call a simple method (healthCheck), verify no DI errors
- **Estimated Complexity:** M

---

### T-026: Analyzer Abstract Base
- **Objective:** Define abstract base class and factory for language analyzers
- **Requirements:** Base class implements common logic (ID generation, error collection). Factory registers analyzers and dispatches by language. Each analyzer self-registers its language.
- **Acceptance Criteria:**
  - `AnalyzerFactory.getAnalyzer(language)` returns correct analyzer
  - `AnalyzerFactory.getAnalyzerForFile(path, content)` detects language and returns analyzer
  - Abstract base provides `generateId()`, `createSymbol()`, `createRelationship()` helpers
- **Dependencies:** T-002, T-004
- **Definition of Done:**
  - [ ] packages/analyzers/analyzer-interface/src/analyzer.ts
  - [ ] AbstractAnalyzerBase class
  - [ ] AnalyzerFactory class
  - [ ] Unit tests
- **Suggested Tests:**
  - Register mock analyzer for "typescript", getAnalyzer("typescript") returns it
  - getAnalyzerForFile("foo.ts") detects "typescript"
  - getAnalyzerForFile("foo.php") detects "php"
- **Estimated Complexity:** M

---

### T-027: TypeScript Compiler API Analyzer — Bridge
- **Objective:** Implement the TypeScript Compiler API analyzer that parses .ts/.tsx files
- **Requirements:** Uses TS Compiler API to create a program, traverse AST, extract symbols. No node_modules analysis.
- **Acceptance Criteria:**
  - Parses TypeScript files without errors on valid code
  - Extracts classes, interfaces, enums, type aliases
  - Extracts methods, properties, constructors
  - Extracts functions, variables, constants
  - Extracts decorators (annotations)
  - Extracts imports/exports
  - Handles generics
  - Emits symbols in the common model format
- **Dependencies:** T-026
- **Definition of Done:**
  - [ ] packages/analyzers/analyzer-typescript/src/ts-compiler-analyzer.ts
  - [ ] Uses `ts.createProgram` for type-aware analysis
  - [ ] Handles .ts, .tsx, .mts, .cts files
  - [ ] Handles both project-based (tsconfig.json) and single-file analysis
  - [ ] Unit tests with fixture TypeScript code
- **Suggested Tests:**
  - Parse a class with methods, verify all symbols extracted
  - Parse an interface with a method that extends another interface
  - Parse a file with generics
  - Parse decorators
  - Parse import statements
- **Estimated Complexity:** L

---

### T-028: TypeScript — Relationship Extractor
- **Objective:** Extract relationships from TypeScript AST
- **Requirements:** Detect CALLS, IMPLEMENTS, INHERITS, REFERENCES, IMPORTS, EXPORTS, DECLARES, CONTAINS
- **Acceptance Criteria:**
  - Method calls detected as CALLS
  - Class implements interface → IMPLEMENTS
  - Class extends class → INHERITS
  - Type references → REFERENCES
  - Import statements → IMPORTS
  - Export statements → EXPORTS
  - Class contains method → CONTAINS
- **Dependencies:** T-027
- **Definition of Done:**
  - [ ] packages/analyzers/analyzer-typescript/src/relationship-extractor.ts
  - [ ] Walks the full AST to detect all relationship types
  - [ ] Resolves symbols to their IDs
  - [ ] Unit tests
- **Suggested Tests:**
  - Class A calls method from Class B → CALLS relationship
  - Class A implements Interface I → IMPLEMENTS
  - Import { foo } from "./bar" → IMPORTS
- **Estimated Complexity:** L

---

### T-029: TypeScript — Architectural Convention Detector
- **Objective:** Detect architectural patterns and apply special labels
- **Requirements:** Convention-based detection of Controller, Service, Repository, DTO, Entity, Command, Query, Event, Test, Config, Route, Middleware, Guard
- **Acceptance Criteria:**
  - `*Controller` classes tagged as Controller
  - `*Service` classes tagged as Service
  - `*Repository` classes tagged as Repository
  - `@Injectable()` + naming pattern → Service
  - `@Controller()` decorator → Controller + Route
  - `@Get/@Post/@Put/@Delete` decorators → Route
  - `@Entity()` decorator → Entity
  - `*.spec.ts`, `*.test.ts` → Test
  - `*.config.ts` → Config
- **Dependencies:** T-027
- **Definition of Done:**
  - [ ] packages/analyzers/analyzer-typescript/src/convention-detector.ts
  - [ ] Returns additional labels and relationship kinds
  - [ ] Unit tests with NestJS, Express, vanilla TS fixtures
- **Suggested Tests:**
  - NestJS controller: detect Controller, Route labels
  - TypeORM entity: detect Entity label
  - Jest test file: detect Test label
  - DTO class: detect DTO label
- **Estimated Complexity:** M

---

### T-030: C# Roslyn Analyzer — Bridge
- **Objective:** Build a .NET tool that uses Roslyn to analyze C# code and output JSON
- **Requirements:** A .NET 8 console app that accepts file paths, parses them with Roslyn, and outputs symbols + relationships as JSON on stdout. The Node.js side spawns this process.
- **Acceptance Criteria:**
  - .NET tool compiles and runs
  - Accepts `--file <path>` and `--project <path>`
  - Outputs valid JSON matching the common symbol model
  - Extracts namespaces, classes, interfaces, enums, records, structs
  - Extracts methods, properties, fields, events, delegates
  - Extracts attributes
  - Extracts using directives (imports)
- **Dependencies:** None (standalone .NET project)
- **Definition of Done:**
  - [ ] packages/analyzers/analyzer-csharp/src/roslyn-bridge/ (C# project)
  - [ ] .csproj with Roslyn NuGet packages
  - [ ] Program.cs with file/project analysis
  - [ ] JSON output schema matching AnalysisResult
  - [ ] Compiled binary or dotnet tool manifest
- **Suggested Tests:**
  - Run against a .cs file, verify JSON output is parseable
  - Run against a .csproj, verify all files analyzed
- **Estimated Complexity:** L

---

### T-031: C# — Bridge Client & Symbol Extractor
- **Objective:** Implement the Node.js side that calls the Roslyn bridge and parses its output
- **Requirements:** Spawn the .NET bridge process, send file paths, receive JSON, convert to Symbol + Relationship objects
- **Acceptance Criteria:**
  - Spawns bridge process with correct arguments
  - Parses JSON output into AnalysisResult
  - Handles bridge process errors gracefully
  - Caches bridge process for performance
- **Dependencies:** T-026, T-030
- **Definition of Done:**
  - [ ] packages/analyzers/analyzer-csharp/src/roslyn-bridge.ts
  - [ ] packages/analyzers/analyzer-csharp/src/roslyn-analyzer.ts
  - [ ] packages/analyzers/analyzer-csharp/src/symbol-extractor.ts
  - [ ] Unit tests with mock bridge output
- **Suggested Tests:**
  - Mock bridge JSON, verify symbols extracted correctly
  - Bridge process crash, verify error handling
  - Multiple files, verify all processed
- **Estimated Complexity:** M

---

### T-032: C# — Relationship & Convention Extractor
- **Objective:** Extract relationships and architectural conventions from Roslyn output
- **Requirements:** CALLS, IMPLEMENTS, INHERITS, REFERENCES, IMPORTS. ASP.NET conventions (Controller, Service, Repository, DTO, Entity, Middleware).
- **Acceptance Criteria:**
  - Inheritance chains detected
  - Interface implementations detected
  - Method calls detected
  - ASP.NET ControllerBase inheritance → Controller
  - [ApiController] attribute → Controller + Route
  - [HttpGet], [HttpPost] etc. → Route
  - Entity Framework entity detection
- **Dependencies:** T-031
- **Definition of Done:**
  - [ ] relationship-extractor.ts
  - [ ] convention-detector.ts
  - [ ] Unit tests
- **Suggested Tests:** Same patterns as T-029 but for C# conventions
- **Estimated Complexity:** M

---

### T-033: PHP Analyzer — Parser Bridge
- **Objective:** Build a PHP script that uses nikic/php-parser and PHPStan to analyze PHP code
- **Requirements:** PHP script that accepts file paths via CLI args, parses with PHP-Parser, does semantic analysis with PHPStan, outputs JSON
- **Acceptance Criteria:**
  - Parses PHP files (7.4, 8.x)
  - Extracts namespaces, classes, interfaces, enums, traits
  - Extracts methods, properties, constants
  - Extracts attributes (PHP 8+)
  - Extracts use statements (imports)
  - Outputs JSON to stdout
- **Dependencies:** None (standalone PHP project)
- **Definition of Done:**
  - [ ] packages/analyzers/analyzer-php/src/php-bridge/ (PHP project)
  - [ ] Composer.json with nikic/php-parser, phpstan/phpstan
  - [ ] analyzer.php CLI script
  - [ ] JSON output
- **Suggested Tests:**
  - Run against PHP file, verify JSON
  - Test with PHP 8 attributes
  - Test with traits
- **Estimated Complexity:** L

---

### T-034: PHP — Bridge Client, Symbol & Relationship Extractors
- **Objective:** Node.js side for PHP analyzer + convention detection (Symfony, Laravel)
- **Requirements:** Same bridge pattern as C#. Detect PHP conventions: Controller, Service, Repository, Entity (Doctrine), Command, Event, DTO, Middleware, Provider.
- **Acceptance Criteria:**
  - Spawns PHP process, receives JSON, parses
  - Detects Symfony Controller (extends AbstractController)
  - Detects Laravel Controller
  - Detects Doctrine entities
  - Detects Symfony Console commands
- **Dependencies:** T-026, T-033
- **Definition of Done:**
  - [ ] php-parser-analyzer.ts
  - [ ] phpstan-bridge.ts
  - [ ] symbol-extractor.ts
  - [ ] relationship-extractor.ts
  - [ ] convention-detector.ts
  - [ ] Unit tests
- **Estimated Complexity:** L

---

### T-035: Python Analyzer — LibCST Bridge
- **Objective:** Build a Python script that uses LibCST + Jedi for static analysis
- **Requirements:** Python script that parses .py files, extracts symbols with LibCST, resolves types/imports with Jedi, outputs JSON
- **Acceptance Criteria:**
  - Parses Python 3.8+ files
  - Extracts modules, classes, functions, methods, properties
  - Extracts decorators
  - Extracts imports
  - Extracts type annotations
  - Uses Jedi for import resolution and type inference
  - Outputs JSON
- **Dependencies:** None (standalone Python project)
- **Definition of Done:**
  - [ ] packages/analyzers/analyzer-python/src/python-bridge/ (Python project)
  - [ ] requirements.txt (libcst, jedi)
  - [ ] analyzer.py CLI script
  - [ ] JSON output
- **Suggested Tests:**
  - Parse class with methods and decorators
  - Parse FastAPI route with decorators
  - Parse dataclass
  - Parse with type hints
- **Estimated Complexity:** L

---

### T-036: Python — Bridge Client, Symbol & Relationship Extractors
- **Objective:** Node.js side for Python analyzer + convention detection (FastAPI, Django, Flask)
- **Requirements:** Bridge client. Detect: Controller/Route (FastAPI/Django/Flask), Service, Repository, Entity (SQLAlchemy/Django models), Command, DTO (Pydantic), Test (pytest).
- **Acceptance Criteria:**
  - Spawns Python process, parses JSON
  - Detects FastAPI routes (@app.get, @router.post)
  - Detects Django views and URL patterns
  - Detects SQLAlchemy models
  - Detects Pydantic models
  - Detects pytest tests
- **Dependencies:** T-026, T-035
- **Definition of Done:**
  - [ ] python-analyzer.ts
  - [ ] libcst-bridge.ts
  - [ ] symbol-extractor.ts
  - [ ] relationship-extractor.ts
  - [ ] convention-detector.ts
  - [ ] Unit tests
- **Estimated Complexity:** L

---

### T-037: Tree-Sitter Fallback Analyzer
- **Objective:** Implement a universal fallback analyzer using tree-sitter for all 4 languages
- **Requirements:** Use tree-sitter with language grammars for C#, PHP, Python, TypeScript. Extract basic symbols and relationships from AST queries.
- **Acceptance Criteria:**
  - Loads tree-sitter grammars dynamically
  - Applies .scm query files to extract symbols
  - Extracts basic relationships (CONTAINS, CALLS where detectable)
  - Returns AnalysisResult in common format
  - Used as fallback when primary analyzer fails
- **Dependencies:** T-026
- **Definition of Done:**
  - [ ] treesitter-analyzer.ts
  - [ ] queries/csharp.scm
  - [ ] queries/php.scm
  - [ ] queries/python.scm
  - [ ] queries/typescript.scm
  - [ ] Unit tests with fixture code
- **Suggested Tests:**
  - Parse simple class in each language, verify symbols
  - Parse function with call, verify relationship
  - Verify graceful degradation on syntax errors
- **Estimated Complexity:** L

---

### T-038: LanguageDetector
- **Objective:** Implement language detection from file extension, content, and shebang
- **Requirements:** Map extensions to Language enum. Handle special cases (.tsx→TypeScript, .cshtml→C#, .blade.php→PHP). Detect from shebang lines. Respect .gitignore patterns.
- **Acceptance Criteria:**
  - `detectLanguage(filePath)` returns Language based on extension
  - `detectLanguageFromContent(content)` checks shebang
  - `detectLanguage(filePath, content)` combines both
  - Returns null for unsupported files
- **Dependencies:** T-002
- **Definition of Done:**
  - [ ] packages/indexing/src/infrastructure/language-detector.ts
  - [ ] Extension → Language mapping table
  - [ ] Special case handling
  - [ ] Unit tests
- **Suggested Tests:**
  - foo.ts → TypeScript
  - foo.tsx → TypeScript
  - foo.php → PHP
  - foo.py → Python
  - foo.cs → CSharp
  - shebang #!/usr/bin/python3 → Python
  - foo.md → null
- **Estimated Complexity:** S

---

### T-039: FileWalker
- **Objective:** Implement file system walker with filtering and .gitignore support
- **Requirements:** Walk directory tree, filter by extension, respect .gitignore, skip node_modules/vendor/.git/__pycache__, configurable include/exclude patterns
- **Acceptance Criteria:**
  - `walk(rootPath, options)` yields file paths
  - Respects .gitignore rules
  - Skips common ignore directories
  - Glob pattern include/exclude
  - Returns relative paths
- **Dependencies:** T-038
- **Definition of Done:**
  - [ ] packages/indexing/src/infrastructure/file-walker.ts
  - [ ] Uses `ignore` npm package for .gitignore
  - [ ] Unit tests with temp directory structure
- **Suggested Tests:**
  - Walk temp dir with .ts, .php, .md files, verify all found
  - .gitignore with *.log, verify .log files excluded
  - Git-ignored directory excluded
- **Estimated Complexity:** M

---

### T-040: IndexerService
- **Objective:** Implement the full indexing pipeline orchestrator
- **Requirements:** Walks repo, detects language per file, dispatches to correct analyzer, aggregates results, stores in Neo4j and Qdrant, indexes documentation. Uses DI to get all dependencies.
- **Acceptance Criteria:**
  - `indexRepository(repoPath)` completes full index
  - Files processed in parallel with configurable concurrency
  - Progress reporting (logs)
  - Errors per file don't crash the whole pipeline
  - Returns IndexResult with statistics
- **Dependencies:** T-025, T-038, T-039, T-027-T-037 (at least one analyzer working)
- **Definition of Done:**
  - [ ] packages/indexing/src/application/services/indexer.service.ts
  - [ ] packages/indexing/src/application/commands/index-repository.handler.ts
  - [ ] Batch processor with worker pool
  - [ ] Integration test with a small fixture repo
- **Suggested Tests:**
  - Index a fixture repo with 10 TypeScript files, verify symbols in Neo4j and Qdrant
  - Index handles missing analyzer gracefully (logs warning)
  - Index empty repo completes without errors
- **Estimated Complexity:** L

---

### T-041: Documentation Indexer
- **Objective:** Implement documentation file indexing (markdown parsing, section extraction, embedding)
- **Requirements:** Find all .md files in AI/, docs/, and root README. Parse into sections. Embed each section. Store in documentation collection in Qdrant.
- **Acceptance Criteria:**
  - Finds documentation files in known locations
  - Parses markdown into heading hierarchy
  - Each section is embedded separately
  - Section ID format: `{repo}::{path}#{heading}`
- **Dependencies:** T-019, T-020
- **Definition of Done:**
  - [ ] packages/indexing/src/application/services/documentation-indexer.service.ts
  - [ ] Markdown parser (use marked or markdown-it)
  - [ ] Section extractor
  - [ ] Integration test with fixture docs
- **Suggested Tests:**
  - Parse README with 3 headings → 3 sections embedded
  - AI/architecture.md with subsections → all embedded
  - Verify sections searchable in Qdrant documentation collection
- **Estimated Complexity:** M

---

### T-042: SymbolDiffer
- **Objective:** Compare old and new symbols to determine what changed
- **Requirements:** Given two sets of symbols (old and new), compute added, modified, deleted, and unchanged symbols based on contentHash comparison.
- **Acceptance Criteria:**
  - `diff(oldSymbols, newSymbols)` returns delta
  - Added: new symbols with no old match
  - Modified: same ID but different contentHash
  - Deleted: old symbols with no new match
  - Unchanged: same ID, same contentHash
- **Dependencies:** T-002, T-005
- **Definition of Done:**
  - [ ] packages/indexing/src/application/services/symbol-differ.service.ts
  - [ ] Uses Map<SymbolId, Symbol> for O(1) lookups
  - [ ] Unit tests
- **Suggested Tests:**
  - Empty old, new symbols → all "added"
  - Same set → all "unchanged"
  - Modified symbol (same ID, different hash) → "modified"
  - Missing in new → "deleted"
- **Estimated Complexity:** S

---

### T-043: IncrementalIndexer
- **Objective:** Implement incremental indexing based on git changes
- **Requirements:** Get changed files since last indexed commit, re-index only those files, remove deleted files' symbols, update graph and vectors.
- **Acceptance Criteria:**
  - `incrementalIndex(repo, sinceCommit)` indexes only changed files
  - Added files → full index
  - Modified files → delete old symbols, index new
  - Deleted files → remove all symbols
  - Renamed files → update paths
- **Dependencies:** T-040, T-042, T-023
- **Definition of Done:**
  - [ ] packages/indexing/src/application/services/incremental-indexer.service.ts
  - [ ] packages/indexing/src/application/commands/index-repository.handler.ts (incremental mode)
  - [ ] Integration test with git repo
- **Suggested Tests:**
  - Index repo, modify one file, incremental index, verify only that file's symbols updated
  - Add new file, incremental index, verify new symbols appear
  - Delete file, incremental index, verify symbols removed
- **Estimated Complexity:** L

---

### T-044: FileWatcher
- **Objective:** Implement file system watcher for real-time incremental indexing
- **Requirements:** Watch repository directory for changes. Debounce rapid changes. Trigger incremental index on change.
- **Acceptance Criteria:**
  - `watchRepository(repo, callback)` watches for file changes
  - Debounces changes (500ms window)
  - Triggers incremental index for changed files
  - Handles new files, modifications, deletions
- **Dependencies:** T-043
- **Definition of Done:**
  - [ ] packages/indexing/src/infrastructure/file-watcher.ts (or within git-adapter)
  - [ ] Uses chokidar for cross-platform watching
  - [ ] Debounce logic
  - [ ] Integration test
- **Suggested Tests:**
  - Start watcher, touch a file, verify callback invoked
  - Rapid changes (10 touches in 100ms), verify only one callback
- **Estimated Complexity:** M

---

### T-045: RankerService
- **Objective:** Implement ranking algorithm for hybrid search results
- **Requirements:** Score each result using vector similarity score, graph distance, symbol kind boost, reference count, and freshness. Configurable weights.
- **Acceptance Criteria:**
  - `rank(items, weights)` returns sorted items
  - Combines multiple signals into final score
  - Configurable weights
  - Symbol kind boost: Services, Controllers, Entities score higher
- **Dependencies:** T-002
- **Definition of Done:**
  - [ ] packages/retrieval/src/application/services/ranker.service.ts
  - [ ] packages/retrieval/src/domain/ranking-strategy.ts
  - [ ] Default weights defined
  - [ ] Unit tests
- **Suggested Tests:**
  - Two items with same vector score but different graph distance → closer ranks higher
  - Service symbol ranks higher than variable symbol (all else equal)
  - Empty items → empty result
- **Estimated Complexity:** M

---

### T-046: DeduplicatorService
- **Objective:** Remove duplicate search results
- **Requirements:** Deduplicate by symbol ID. File-level dedup: if 5+ results from same file, keep top 3. Exact snippet dedup.
- **Acceptance Criteria:**
  - `deduplicate(items)` removes exact ID duplicates
  - `deduplicate(items, {fileLevelLimit: 3})` limits per-file results
  - Keeps highest-scoring items
- **Dependencies:** T-002
- **Definition of Done:**
  - [ ] packages/retrieval/src/application/services/deduplicator.service.ts
  - [ ] Unit tests
- **Suggested Tests:**
  - Duplicate IDs → only one kept (highest score)
  - 7 items from same file, fileLevelLimit=3 → 3 kept
  - All unique → all kept
- **Estimated Complexity:** S

---

### T-047: TokenBudgetService
- **Objective:** Estimate token counts and fit results within budget
- **Requirements:** Conservative token estimation. Fit items within maxTokens, using signature-only fallback when needed.
- **Acceptance Criteria:**
  - `estimateTokens(text)` returns token count estimate
  - `fitWithinBudget(items, maxTokens)` returns truncated list
  - Falls back to signature-only for individual items near budget limit
  - Hard stop when budget exceeded
- **Dependencies:** None
- **Definition of Done:**
  - [ ] packages/retrieval/src/application/services/token-budget.service.ts
  - [ ] Token estimation: chars / 3.5 for code, or tiktoken if available
  - [ ] Unit tests
- **Suggested Tests:**
  - Estimate tokens for known text lengths
  - 5 items totaling 1000 tokens, budget 500 → first ~3 items returned
  - Single large item > budget → signature-only fallback
- **Estimated Complexity:** M

---

### T-048: ContextCompressorService
- **Objective:** Compress context snippets to fit token budgets
- **Requirements:** Truncate long source snippets, strip imports, use signature-only for methods when budget is tight, prioritize key symbols.
- **Acceptance Criteria:**
  - `compress(items, maxTokens)` applies compression strategies
  - Long functions truncated to 50 lines
  - Import statements stripped (unless the import IS the result)
  - Signature-only fallback for low-relevance items
- **Dependencies:** T-047
- **Definition of Done:**
  - [ ] packages/retrieval/src/application/services/context-compressor.service.ts
  - [ ] Multiple compression strategies in priority order
  - [ ] Unit tests
- **Suggested Tests:**
  - 100-line function snippet → truncated to 50 lines
  - Imports at top of snippet → stripped
  - Test symbols with includeTests=false → removed
- **Estimated Complexity:** M

---

### T-049: RetrieverService (Hybrid Retrieval)
- **Objective:** Implement the full hybrid retrieval pipeline: vector search + graph expansion + ranking + dedup + compression
- **Requirements:** Orchestrates Qdrant search, Neo4j expansion, ranking, deduplication, context compression, and token budgeting. This is the core "brain" of the platform.
- **Acceptance Criteria:**
  - `retrieve(query)` returns RankedContextItem[]
  - Vector search in Qdrant for code and documentation
  - Graph expansion from vector hits
  - Ranking, dedup, compression applied
  - Token budget respected
  - Debug info returned
- **Dependencies:** T-045, T-046, T-048, T-019, T-016, T-020
- **Definition of Done:**
  - [ ] packages/retrieval/src/application/services/retriever.service.ts
  - [ ] Full pipeline as described in section 10
  - [ ] Integration test with indexed fixture repo
- **Suggested Tests:**
  - Index known repo, retrieve with known query, verify relevant results
  - Verify graph expansion adds neighbors
  - Verify token budget is respected
  - Verify debug info has all stages
- **Estimated Complexity:** L

---

### T-050: SearchCodeHandler
- **Objective:** Implement the search_code query handler
- **Requirements:** Takes SearchCodeQuery, calls RetrieverService, maps to MCP-compatible result format
- **Acceptance Criteria:**
  - Calls RetrieverService.retrieve() with correct parameters
  - Maps RetrievalResult to SearchResult DTO
  - Handles empty results
  - Language and kind filters applied
- **Dependencies:** T-049
- **Definition of Done:**
  - [ ] packages/retrieval/src/application/queries/search-code.handler.ts
  - [ ] Unit test (mock retriever)
- **Suggested Tests:**
  - Verify retriever called with correct query
  - Verify language filter passed through
  - Empty result handling
- **Estimated Complexity:** S

---

### T-051-T-066: Remaining Query Handlers
- **Objective:** Implement all remaining query handlers from the retrieval package
- **Requirements:** Each handler is a thin wrapper around GraphRepository or VectorRepository methods. All follow the same pattern as T-050.
- **Tasks:**
  - T-051: SearchDocumentationHandler
  - T-052: FindSymbolHandler
  - T-053: FindReferencesHandler
  - T-054: FindCallersHandler
  - T-055: FindCalleesHandler
  - T-056: FindImplementationsHandler
  - T-057: FindInheritorsHandler
  - T-058: FindTestsHandler
  - T-059: FindRoutesHandler
  - T-060: FindConfigurationHandler
  - T-061: ExpandGraphHandler
  - T-062: RelatedSymbolsHandler
  - T-063: SearchSimilarHandler
  - T-064: RepositorySummaryHandler
  - T-065: ArchitectureSummaryHandler
  - T-066: ListSymbolsHandler
- **Acceptance Criteria:** Each handler calls the correct repository method, maps results, handles errors
- **Dependencies:** T-013-T-019 (respective repository methods)
- **Definition of Done:** Same pattern as T-050
- **Suggested Tests:** Mock repository, verify correct method called
- **Estimated Complexity:** S each

---

### T-067: MCP Protocol Implementation
- **Objective:** Implement the MCP JSON-RPC protocol over stdio
- **Requirements:** Parse JSON-RPC messages from stdin, dispatch to tool handlers, write responses to stdout. Support initialize, tools/list, tools/call, shutdown.
- **Acceptance Criteria:**
  - Reads JSON-RPC messages from stdin (line-delimited or content-length header)
  - Parses method, params, id
  - Routes to registered tool handlers
  - Writes JSON-RPC responses to stdout
  - Handles initialize handshake
  - Handles shutdown gracefully
  - Handles invalid messages with error responses
- **Dependencies:** None (pure protocol)
- **Definition of Done:**
  - [ ] packages/mcp-server/src/transport.ts
  - [ ] packages/mcp-server/src/server.ts (core MCP logic)
  - [ ] JSON-RPC error codes
  - [ ] Unit tests with mock stdin/stdout
- **Suggested Tests:**
  - Send valid initialize request, verify response
  - Send tools/list, verify tool list returned
  - Send tools/call with valid tool, verify result
  - Send invalid JSON, verify error response
- **Estimated Complexity:** L

---

### T-068: MCP Tool Registry & Wrappers (Part 1 — Search & Read Tools)
- **Objective:** Register all tools and implement wrappers for the first batch of tools
- **Requirements:** Tool definitions (name, description, inputSchema) for: search_code, search_documentation, find_symbol, find_references, find_callers, find_callees. Each tool wrapper validates args, calls handler, formats result.
- **Acceptance Criteria:**
  - All tool definitions match the contracts in section 8
  - Each tool validates input against schema
  - Each tool returns properly formatted MCP tool result
- **Dependencies:** T-067, T-050-T-055
- **Definition of Done:**
  - [ ] search-code.tool.ts
  - [ ] search-documentation.tool.ts
  - [ ] find-symbol.tool.ts
  - [ ] find-references.tool.ts
  - [ ] find-callers.tool.ts
  - [ ] find-callees.tool.ts
  - [ ] Tool registry
- **Suggested Tests:** Mock handlers, call each tool, verify correct output format
- **Estimated Complexity:** M

---

### T-069: MCP Tool Wrappers (Part 2 — Navigation Tools)
- **Objective:** Implement tool wrappers for: find_implementations, find_inheritors, find_tests, find_routes, find_configuration, expand_graph, related_symbols
- **Acceptance Criteria:** Same as T-068
- **Dependencies:** T-067, T-056-T-062
- **Definition of Done:**
  - [ ] find-implementations.tool.ts
  - [ ] find-inheritors.tool.ts
  - [ ] find-tests.tool.ts
  - [ ] find-routes.tool.ts
  - [ ] find-configuration.tool.ts
  - [ ] expand-graph.tool.ts
  - [ ] related-symbols.tool.ts
- **Estimated Complexity:** M

---

### T-070: MCP Tool Wrappers (Part 3 — Exploration & File Tools)
- **Objective:** Implement wrappers for: list_symbols, repository_summary, architecture_summary, search_similar, read_file, write_file, update_file, delete_file, create_file
- **Acceptance Criteria:** Same as T-068
- **Dependencies:** T-067, T-063-T-066, T-022
- **Definition of Done:**
  - [ ] list-symbols.tool.ts
  - [ ] repository-summary.tool.ts
  - [ ] architecture-summary.tool.ts
  - [ ] search-similar.tool.ts
  - [ ] read-file.tool.ts
  - [ ] write-file.tool.ts
  - [ ] update-file.tool.ts
  - [ ] delete-file.tool.ts
  - [ ] create-file.tool.ts
- **Estimated Complexity:** M

---

### T-071: MCP Server Middleware
- **Objective:** Implement error handling, rate limiting, and logging middleware
- **Requirements:** Error handler catches all exceptions, returns proper JSON-RPC errors. Rate limiter limits tool calls per second. Logger logs every request/response.
- **Acceptance Criteria:**
  - Unhandled errors return JSON-RPC error with code -32603
  - Rate limiter: configurable max calls/second, returns error when exceeded
  - Logger: structured JSON logs for every request/response
- **Dependencies:** T-067
- **Definition of Done:**
  - [ ] error-handler.ts
  - [ ] rate-limiter.ts
  - [ ] logger.ts (middleware wrapper)
  - [ ] Unit tests
- **Suggested Tests:**
  - Throw in tool handler → error response, not crash
  - Exceed rate limit → error response
  - Verify logs written
- **Estimated Complexity:** M

---

### T-072: MCP Server Entry Point
- **Objective:** Wire everything together: transport, tool registry, all tools, middleware, and start the server
- **Requirements:** Main entry point that initializes all components and starts listening on stdio
- **Acceptance Criteria:**
  - `start()` initializes MCP server with all 22 tools
  - Graceful shutdown on SIGINT/SIGTERM
  - Configurable via environment variables
- **Dependencies:** T-068, T-069, T-070, T-071
- **Definition of Done:**
  - [ ] packages/mcp-server/src/index.ts (or main.ts)
  - [ ] All tools registered
  - [ ] Middleware applied
  - [ ] Integration test: start server, send initialize + tools/list
- **Suggested Tests:**
  - Start server, send tools/list, verify 22 tools returned
  - Start server, send tools/call for search_code, verify result
  - SIGTERM, verify graceful shutdown
- **Estimated Complexity:** M

---

### T-073: CLI — Entry Point & Config
- **Objective:** Implement CLI framework with config loading
- **Requirements:** Commander-based CLI. Load config from .code-indexer.json, environment variables, and CLI flags. Config precedence: CLI flags > env vars > config file > defaults.
- **Acceptance Criteria:**
  - `code-indexer --help` shows all commands
  - Config loaded from multiple sources
  - Repository path configurable
  - Neo4j/Qdrant connections configurable
- **Dependencies:** T-004
- **Definition of Done:**
  - [ ] packages/cli/src/index.ts
  - [ ] packages/cli/src/config.ts
  - [ ] Commander program with subcommands
  - [ ] Unit tests for config loading
- **Suggested Tests:**
  - Load config from file
  - CLI flag overrides config file
  - Missing config → defaults
- **Estimated Complexity:** M

---

### T-074: CLI — Index Command
- **Objective:** Implement `code-indexer index <repository-path>` command
- **Requirements:** Calls IndexerService.indexRepository(). Shows progress bar. Prints summary when done.
- **Acceptance Criteria:**
  - Indexes repository and shows progress
  - Prints IndexResult (symbols, relationships, vectors, duration)
  - `--watch` flag starts incremental indexing
- **Dependencies:** T-040, T-043, T-073
- **Definition of Done:**
  - [ ] packages/cli/src/commands/index.ts
  - [ ] Progress reporting
  - [ ] Integration test with fixture repo
- **Suggested Tests:** Run index on fixture repo, verify exit code 0, verify output
- **Estimated Complexity:** M

---

### T-075: CLI — Search Command
- **Objective:** Implement `code-indexer search <query>` command
- **Requirements:** Calls RetrieverService.retrieve(). Formats results nicely in terminal.
- **Acceptance Criteria:**
  - Search returns ranked results
  - `--repo` flag to specify repository
  - `--limit` flag to control result count
  - Results show symbol name, kind, file, score, snippet
- **Dependencies:** T-049, T-073
- **Definition of Done:**
  - [ ] packages/cli/src/commands/search.ts
  - [ ] Terminal formatting (chalk for colors)
  - [ ] Integration test
- **Estimated Complexity:** M

---

### T-076: CLI — Serve Command
- **Objective:** Implement `code-indexer serve` command that starts the MCP server
- **Requirements:** Starts MCP server on stdio (default) or HTTP (with --http flag)
- **Acceptance Criteria:**
  - `serve` starts MCP server on stdio
  - `serve --http --port 3000` starts HTTP server
  - Graceful shutdown
- **Dependencies:** T-072, T-073
- **Definition of Done:**
  - [ ] packages/cli/src/commands/serve.ts
  - [ ] Integration test: start serve, verify tools/list works
- **Estimated Complexity:** S

---

### T-077: CLI — Utility Commands
- **Objective:** Implement `graph-stats` and `clean` commands
- **Requirements:** graph-stats shows Neo4j statistics. clean clears all data for a repository.
- **Acceptance Criteria:**
  - `graph-stats --repo <name>` shows symbols by kind, language, relationship counts
  - `clean --repo <name>` removes all data
  - Confirmation prompt for clean
- **Dependencies:** T-017, T-073
- **Definition of Done:**
  - [ ] packages/cli/src/commands/graph-stats.ts
  - [ ] packages/cli/src/commands/clean.ts
  - [ ] Integration tests
- **Estimated Complexity:** S

---

### T-078: Dockerfiles
- **Objective:** Create production Dockerfiles for mcp-server, retriever, and indexer services
- **Requirements:** Multi-stage builds. Node.js 22 base. pnpm for install. Production dependencies only. Health check endpoints.
- **Acceptance Criteria:**
  - Each Dockerfile builds successfully
  - Image sizes reasonable (< 500MB each)
  - Health checks work
  - Environment variables for configuration
- **Dependencies:** T-040, T-049, T-072
- **Definition of Done:**
  - [ ] docker/mcp-server/Dockerfile
  - [ ] docker/retriever/Dockerfile
  - [ ] docker/indexer/Dockerfile
  - [ ] Test with `docker build`
- **Suggested Tests:** `docker build -t code-indexer-mcp .` succeeds
- **Estimated Complexity:** M

---

### T-079: Full Docker Compose
- **Objective:** Create the complete docker-compose.yml with all services
- **Requirements:** All services from section 11.2. Health checks. Volume mounts. Environment variables. Profiles for optional services.
- **Acceptance Criteria:**
  - `docker compose up -d` starts all core services
  - All services healthy within 60 seconds
  - `docker compose --profile ollama up -d` includes Ollama
  - Data persists across restarts
- **Dependencies:** T-078, T-008
- **Definition of Done:**
  - [ ] docker/docker-compose.yml (complete)
  - [ ] docker/docker-compose.dev.yml (with hot reload, debug ports)
  - [ ] .env.example updated
  - [ ] Tested end-to-end
- **Suggested Tests:**
  - Full stack up, index a repo via CLI in same network
  - Search via MCP server
  - Restart, verify data persists
- **Estimated Complexity:** L

---

### T-080: Resilience & Retry Logic
- **Objective:** Add retry with exponential backoff to all external service calls
- **Requirements:** Generic retry decorator/wrapper. Applied to Neo4j, Qdrant, Ollama, OpenAI calls. Configurable max retries and backoff.
- **Acceptance Criteria:**
  - Failed Neo4j queries retry up to 3 times
  - Failed Qdrant operations retry
  - Exponential backoff: 1s, 2s, 4s
  - Circuit breaker: after 5 consecutive failures, pause for 30s
- **Dependencies:** T-025
- **Definition of Done:**
  - [ ] packages/infra/src/utils/retry.ts
  - [ ] packages/infra/src/utils/circuit-breaker.ts
  - [ ] Applied to Neo4jConnection, QdrantConnection, embedding generators
  - [ ] Unit tests
- **Suggested Tests:**
  - Mock failing connection, verify 3 retries
  - Mock 5 failures, verify circuit opens
  - Verify circuit closes after timeout
- **Estimated Complexity:** M

---

### T-081: Metrics & Observability
- **Objective:** Add Prometheus metrics and structured logging throughout
- **Requirements:** Metrics: index duration, search latency, error rates, symbol counts. Logging: structured JSON, request IDs for tracing.
- **Acceptance Criteria:**
  - `/metrics` endpoint on retriever and indexer (Prometheus format)
  - Index duration histogram
  - Search latency histogram
  - Error counter by type
  - Request ID propagated through all services
- **Dependencies:** T-040, T-049
- **Definition of Done:**
  - [ ] prom-client integration
  - [ ] Metrics middleware
  - [ ] Request ID middleware
  - [ ] Dashboard JSON for Grafana (optional)
- **Estimated Complexity:** M

---

### T-082: Security Hardening
- **Objective:** Input sanitization, path traversal prevention, file operation security
- **Requirements:** All user inputs sanitized. File paths validated (no traversal outside repo). Rate limiting on MCP. Content size limits.
- **Acceptance Criteria:**
  - Path traversal attacks rejected
  - File reads limited to repository root
  - File writes validated
  - MCP rate limited at 60 calls/min
  - Max file size for indexing: 10MB
- **Dependencies:** T-022, T-071
- **Definition of Done:**
  - [ ] Path validation in FileSystem
  - [ ] Input sanitization in MCP tools
  - [ ] Content size limits in indexer
  - [ ] Security test cases
- **Suggested Tests:**
  - Try to read ../../../etc/passwd → rejected
  - Try to write outside repo → rejected
  - Send 100 MCP calls in 10s → rate limited
- **Estimated Complexity:** M

---

### T-083: Integration Test Suite
- **Objective:** End-to-end tests with real repositories
- **Requirements:** Test fixtures: small open-source repos in each language. Full pipeline: index → search → verify results.
- **Acceptance Criteria:**
  - TypeScript fixture repo indexed and searchable
  - C# fixture repo indexed and searchable
  - PHP fixture repo indexed and searchable
  - Python fixture repo indexed and searchable
  - Documentation indexed and searchable
  - Incremental indexing works
- **Dependencies:** ALL previous tasks
- **Definition of Done:**
  - [ ] tests/integration/ directory
  - [ ] test-fixtures/ directory with small repos
  - [ ] Test runner script
  - [ ] CI-compatible (all in Docker)
- **Suggested Tests:** See acceptance criteria
- **Estimated Complexity:** L

---

### T-084: README & Contribution Guide
- **Objective:** Write comprehensive README and analyzer contribution guide
- **Requirements:** Setup instructions, architecture overview, how to add a new language analyzer, API reference, MCP tool reference
- **Acceptance Criteria:**
  - README has quickstart (< 5 min to running)
  - Architecture diagram
  - Analyzer contribution guide with code examples
  - MCP tool reference table
  - Environment variable reference
- **Dependencies:** ALL
- **Definition of Done:**
  - [ ] README.md (comprehensive)
  - [ ] CONTRIBUTING.md (analyzer guide)
  - [ ] docs/architecture.md (diagrams)
  - [ ] docs/mcp-tools.md (tool reference)
- **Estimated Complexity:** M

---

## Summary: Task Breakdown by Phase

| Phase | Tasks | Total |
|-------|-------|-------|
| P0 — Foundation | T-001 to T-010 | 10 |
| P1 — Infrastructure | T-011 to T-025 | 15 |
| P2 — Analyzers | T-026 to T-037 | 12 |
| P3 — Indexing | T-038 to T-044 | 7 |
| P4 — Retrieval | T-045 to T-066 | 22 |
| P5 — MCP Server | T-067 to T-072 | 6 |
| P6 — CLI & DevOps | T-073 to T-079 | 7 |
| P7 — Polish | T-080 to T-084 | 5 |
| **Total** | | **84 tasks** |

### Complexity Distribution

| Complexity | Count | Description |
|------------|-------|-------------|
| S (Small) | 18 | Single file, simple logic, < 2 hours |
| M (Medium) | 46 | Multiple files, moderate logic, 2-4 hours |
| L (Large) | 16 | Complex subsystem, 4-8 hours |
| XL | 4 | Cross-cutting, 8+ hours |

### Parallelization Opportunities

- All language analyzers (T-027 through T-037) can be built simultaneously
- All query handlers (T-051 through T-066) can be built simultaneously
- MCP tool wrappers (T-068 through T-070) can be built simultaneously
- P0 and P1 infrastructure can be built while analyzers are designed

---

## Appendix A: Environment Variables

```bash
# .env.example

# === Neo4j ===
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password

# === Qdrant ===
QDRANT_URL=http://localhost:6334

# === Embeddings ===
EMBEDDING_PROVIDER=ollama     # ollama | openai
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=nomic-embed-text
OPENAI_API_KEY=
OPENAI_MODEL=text-embedding-3-small

# === Repositories ===
REPOSITORIES_PATH=~/repos

# === Logging ===
LOG_LEVEL=info                # trace | debug | info | warn | error

# === MCP Server ===
MCP_SERVER_PORT=3000
MCP_TRANSPORT=stdio           # stdio | http

# === Retriever ===
RETRIEVER_PORT=3001
MAX_VECTOR_HITS=20
MAX_GRAPH_HOPS=1
MAX_TOTAL_RESULTS=30
MAX_TOKENS=8000

# === Indexer ===
INDEXER_PORT=3002
INDEXER_CONCURRENCY=4
MAX_FILE_SIZE_MB=10

# === Optional ===
REDIS_URL=redis://localhost:6379
POSTGRES_URL=postgres://codeindexer:password@localhost:5432/codeindexer
```

---

## Appendix B: Key Design Decisions Log

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| TypeScript for core services | Shared types with MCP SDK, Node.js stdio transport | Python (better ML but worse MCP), Go (faster but less MCP support) |
| Neo4j over other graph DBs | Mature, Cypher query language, APOC library, GDS plugin | ArangoDB, JanusGraph, custom in Postgres |
| Qdrant over other vector DBs | Fast filtered search, payload indexing, Rust, single binary | Pinecone (cloud), Weaviate (heavier), Milvus (complex) |
| Analyzers as external processes | Language-specific runtimes (.NET, PHP, Python) can't run in Node.js | WASM compilation (immature), pure-JS parsers (not official) |
| pnpm workspaces over Nx/Turborepo | Simpler, sufficient for this project size | Nx (more features but more complexity) |
| tsyringe over InversifyJS | Lighter, decorator-based, maintained by Microsoft | InversifyJS (more features but heavier) |
| In-memory symbol store during indexing | Indexing is a batch operation, no need for durable intermediate state | Redis, SQLite (unnecessary overhead) |
| Ollama as default embedding provider | Local-first, no API costs, good enough quality | Only OpenAI (lock-in), sentence-transformers directly |

---

*This architecture document is the source of truth. All implementation tasks derive from it. When in doubt during implementation, return here.*
