# Domain Model

## Ubiquitous Language

| Term | Definition |
|------|-----------|
| **Symbol** | Any named code element: class, function, method, variable, etc. |
| **Relationship** | A directed edge between two symbols (e.g., CALLS, INHERITS, IMPORTS) |
| **Repository** | A codebase being indexed; identified by name |
| **Symbol Kind** | Classification of a symbol (class, method, controller, service, etc.) |
| **Relationship Kind** | Classification of an edge (CALLS, CONTAINS, IMPLEMENTS, etc.) |
| **Embedding** | A 768-dim (Ollama) or 1536-dim (OpenAI) vector representing a symbol |
| **Graph Expansion** | Multi-hop traversal from seed symbols through Neo4j relationships |
| **Hybrid Retrieval** | Combining vector similarity search with graph expansion |
| **Token Budget** | Maximum token count for results returned to the LLM |
| **Language Analyzer** | A parser plugin that extracts symbols from source code |
| **Source Snippet** | First portion of source code used for embedding generation |
| **Content Hash** | SHA256 of sourceSnippet; used for change detection |
| **Convention Detection** | Inferring architectural roles (Controller, Service, etc.) from naming patterns |

## Core Entities

### Symbol

The universal representation of any code element across all languages.

```
Symbol {
  id:           "myrepo::src/Payment.ts::PaymentService.processPayment"  ← globally unique
  name:         "processPayment"
  kind:         SymbolKind.METHOD
  location:     SourceLocation { repository, relativePath, startLine, endLine, startColumn, endColumn }
  language:     Language.TYPESCRIPT
  namespace:    "src/Payment"
  parentClass:  "PaymentService" | null
  signature:    "async processPayment(amount: Money): Promise<PaymentResult>"
  docComment:   "/** Processes a payment using Stripe */"
  sourceSnippet: "<first 80 lines of implementation>"
  contentHash:  "a3f2b1c9..."
  metadata:     { framework: "nestjs", isAbstract: false }
}
```

### Relationship

A directed edge between two symbols.

```
Relationship {
  id:              "srcId--[CALLS]-->tgtId"  ← format: {sourceId}--[{kind}]-->{targetId}
  sourceSymbolId:  "myrepo::src/A.ts::A.foo"
  targetSymbolId:  "myrepo::src/B.ts::B.bar"
  kind:            RelationshipKind.CALLS
  metadata:        { lineNumber: 42 }
}
```

### SourceLocation

Pinpoints a symbol to a file and line range.

```
SourceLocation {
  repository:    "myrepo"
  relativePath:  "src/services/PaymentService.ts"
  startLine:     42      ← 1-indexed
  endLine:       58
  startColumn:   0       ← 0-indexed
  endColumn:     80
}
```

## Value Objects

### SymbolId

- **Format:** `{repository}::{relativePath}::{symbolPath}`
- **Factory:** `createSymbolId(repo, path, symbolPath)` — validates and brands
- **Parser:** `parseSymbolId(id)` — decomposes into `{ repository, relativePath, symbolPath }`
- **Validation:** Must match `/^.+::.+::.+$/`

### RepositoryName

- **Format:** `/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/`
- **Factory:** `createRepositoryName(name)` — validates and brands

## Enums

### SymbolKind (39 values)

**Structural:** `NAMESPACE`, `MODULE`, `PACKAGE`
**Types:** `CLASS`, `INTERFACE`, `ENUM`, `STRUCT`, `RECORD`, `TYPE_ALIAS`
**Callables:** `FUNCTION`, `METHOD`, `CONSTRUCTOR`, `LAMBDA`
**Data:** `PROPERTY`, `FIELD`, `CONSTANT`, `VARIABLE`, `PARAMETER`
**Decorators:** `ANNOTATION`, `ATTRIBUTE`, `DECORATOR`
**Architectural:** `CONTROLLER`, `SERVICE`, `REPOSITORY`, `DTO`, `ENTITY`, `COMMAND`, `QUERY`, `EVENT`, `MIDDLEWARE`, `GUARD`, `INTERCEPTOR`, `PROVIDER`, `FACTORY`, `CONFIG`, `MIGRATION`, `TEST`, `FIXTURE`, `ROUTE`, `HOOK`, `COMPONENT`

### RelationshipKind (21 values)

**Structural:** `CONTAINS`, `DECLARES`, `BELONGS_TO`
**OOP:** `INHERITS`, `IMPLEMENTS`, `OVERRIDES`
**Dependencies:** `IMPORTS`, `EXPORTS`, `DEPENDS_ON`, `CALLS`, `REFERENCES`, `INSTANTIATES`
**Data Flow:** `RETURNS`, `ACCEPTS`, `PUBLISHES`, `SUBSCRIBES`
**Testing:** `TESTS`, `CONFIGURES`
**Decorators:** `DECORATES`
**Architectural:** `ROUTES_TO`, `HANDLES`

### Language (4 active, 5 reserved)

`CSHARP`, `PHP`, `PYTHON`, `TYPESCRIPT` — active
`GO`, `RUST`, `JAVA`, `KOTLIN`, `RUBY` — reserved in comments

## Services

### RetrieverService

- **Port:** `Retriever` interface
- **Purpose:** Orchestrates the hybrid retrieval pipeline
- **Input:** `RetrievalQuery { query, repository, options? }`
- **Output:** `RetrievalResult { context: RankedContextItem[], tokenCount, durationMs }`
- **Pipeline:** embed → Qdrant → Neo4j expand → merge → dedup → rank → compress → token budget

### IndexerService

- **Port:** `Indexer` interface
- **Purpose:** Orchestrates the full indexing pipeline
- **Input:** Repository path
- **Output:** `IndexResult { symbolsFound, relationshipsFound, vectorsCreated, errors, duration }`
- **Pipeline:** walk → detect → analyze → embed → store Neo4j + Qdrant → index docs

### IncrementalIndexerService

- **Purpose:** Indexes only changed files since a git commit
- **Uses:** `GitAdapter.getChangedFiles()`, `SymbolDiffer`
- **File states:** added → full index, modified → delete old + index new, deleted → remove

### SymbolDiffer

- **Purpose:** Compares old vs new symbol sets
- **Detection:** contentHash comparison (SHA256)
- **Output:** `SymbolDelta { added[], modified[], deleted[], unchanged[] }`

## Repositories

### GraphRepository (Neo4j)

- **Write:** `upsertSymbol(s)`, `upsertRelationship(s)`, `deleteSymbol(s)`, `clearRepository`
- **Read:** `findSymbol`, `findSymbolByName`, `findReferences`, `findCallers`, `findCallees`, `findImplementations`, `findInheritors`, `findTests`, `findRoutes`, `findConfiguration`
- **Traversal:** `expandGraph(seedIds, hops, relTypes)`, `relatedSymbols(id)`
- **Summary:** `repositorySummary(repo)`, `listSymbols(repo, kind, limit, offset)`

### VectorRepository (Qdrant)

- **Collections:** `code`, `documentation`
- **Write:** `upsertVectors(points)`, `deleteVectors(ids)`, `clearCollection(name)`
- **Read:** `search(collection, vector, options)`, `searchWithFilters(collection, vector, filters, options)`
- **Filters:** language, repository, kind, namespace, className

## Commands vs Queries (CQRS-lite)

| Aspect | Commands (Indexing) | Queries (Retrieval) |
|--------|--------------------|--------------------|
| Package | `@code-indexer/indexing` | `@code-indexer/retrieval` |
| Interface | `Indexer` | `Retriever`, `GraphRepository` |
| Side effect | Writes to Neo4j + Qdrant | Read-only |
| Optimization | Batch processing, concurrency | Ranking, compression, budget |

[← Back to README](./README.md)
