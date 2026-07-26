# Components

## Domain Components (`@yats/shared`)

### SymbolKind
- **File:** `domain/enums.ts`
- **Responsibility:** Discriminator for all code elements across languages
- **Values:** 39 enum members (see [domain.md](./domain.md))
- **Usage:** Every `Symbol.kind` field

### RelationshipKind
- **File:** `domain/enums.ts`
- **Responsibility:** Discriminator for all graph edges
- **Values:** 21 enum members
- **Usage:** Every `Relationship.kind` field

### SymbolId / RepositoryName
- **File:** `domain/value-objects.ts`
- **Responsibility:** Branded string types with validation
- **Factories:** `createSymbolId(repo, path, symbolPath)`, `createRepositoryName(name)`
- **Parser:** `parseSymbolId(id)` → `{ repo, path, symbolPath }`

### Logger
- **File:** `utils/logger.ts`
- **Responsibility:** Structured JSON logging
- **API:** `createLogger(name: string) → Logger { trace, debug, info, warn, error, child }`
- **Config:** `LOG_LEVEL` env var

### Content Hasher
- **File:** `utils/hash.ts`
- **Responsibility:** SHA256 hashing (used for change detection)
- **API:** `hashContent(text: string) → string` (64-char hex)

---

## Infrastructure Components (`@yats/infra`)

### Neo4jConnection
- **File:** `neo4j/neo4j-connection.ts`
- **Responsibility:** Manages Neo4j driver lifecycle, connection pool, retry with exponential backoff
- **Dependencies:** `neo4j-driver`
- **Config:** `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`
- **Key API:**
  - `connect()` — 5 retries, 1s→16s backoff
  - `getSession(mode)` — returns a Neo4j session from pool
  - `read(cypher, params)` / `write(cypher, params)` — transactional queries
  - `writeBatch(ops)` — multiple writes in one transaction
  - `runMigrations()` — applies `001-schema.cypher`
  - `healthCheck()` / `close()`

### Neo4jGraphRepository
- **File:** `neo4j/neo4j-graph-repository.ts`
- **Responsibility:** Full implementation of `GraphRepository` interface
- **Dependencies:** `Neo4jConnection`
- **Key API:** See [domain.md](./domain.md) — 20+ methods for CRUD + graph traversal

### QdrantConnection
- **File:** `qdrant/qdrant-connection.ts`
- **Responsibility:** Manages Qdrant client, creates collections with payload indexes
- **Dependencies:** `@qdrant/js-client-rest`
- **Config:** `QDRANT_URL`
- **Key API:**
  - `getClient()` → `QdrantClient`
  - `initialize(vectorSize?)` — creates `code` and `documentation` collections
  - `healthCheck()`

### QdrantVectorRepository
- **File:** `qdrant/qdrant-vector-repository.ts`
- **Responsibility:** Full implementation of `VectorRepository` interface
- **Dependencies:** `QdrantConnection`
- **Key API:** `upsertVectors`, `deleteVectors`, `search`, `searchWithFilters`, `clearCollection`

### OllamaEmbeddingGenerator
- **File:** `embeddings/ollama-embedding-generator.ts`
- **Responsibility:** Generate embeddings via Ollama API (nomic-embed-text, 768d)
- **Config:** `OLLAMA_URL`, `OLLAMA_MODEL`
- **Key API:** `embed(text)`, `embedBatch(texts)`, `embedCode(code, lang)`, `embedDocumentation(text)`, `isAvailable()`

### OpenAIEmbeddingGenerator
- **File:** `embeddings/openai-embedding-generator.ts`
- **Responsibility:** Generate embeddings via OpenAI API (text-embedding-3-small, 1536d)
- **Config:** `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`
- **Key API:** Same as Ollama + rate-limit retry with exponential backoff

### LocalFileSystem
- **File:** `storage/local-file-system.ts`
- **Responsibility:** File operations with path traversal protection
- **Key API:** `readFile`, `writeFile`, `updateFile(edits)`, `createFile`, `deleteFile`, `listFiles`, `exists`, `resolvePath`

### MemorySymbolStore
- **File:** `storage/memory-symbol-store.ts`
- **Responsibility:** Transient in-memory store for symbols during indexing
- **Lifecycle:** Created fresh per indexing run
- **Key API:** `add(symbol)`, `addRelationship(rel)`, `getAll()`, `getRelationships()`, `clear()`

### SimpleGitAdapter
- **File:** `git/simple-git-adapter.ts`
- **Responsibility:** Wraps `git` CLI via `execSync`
- **Key API:** `getCurrentCommit(repoPath)`, `getChangedFiles(repoPath, sinceCommit)`, `getFileAtCommit(repoPath, path, commit)`

### DI Container
- **File:** `di/container.ts`
- **Responsibility:** Tsyringe-based dependency injection
- **Key API:** `initializeConnections()`, `shutdownConnections()`, exported `container`
- **Tokens:** `TOKENS` object in `di/tokens.ts`

---

## Application Components

### IndexerService
- **Package:** `@yats/indexing`
- **File:** `application/services/indexer.service.ts`
- **Responsibility:** Full indexing pipeline orchestrator
- **Dependencies:** `GraphRepository`, `VectorRepository`, `EmbeddingGenerator`, `FileSystem`, `AnalyzerFactory`
- **Key API:** `indexRepository(path, options?) → IndexResult`, `indexFile(repo, path)`, `indexDocumentation(path) → number`, `incrementalIndex(path, commit) → IndexResult`, `ensureIndexed(path, options?)`
- **Options:** `{ skipDocs?: boolean }` — skips documentation indexing when `true`

### GlobalSymbolTable
- **File:** `application/services/global-symbol-table.ts`
- **Responsibility:** Resolves cross-file symbol references by name matching
- **Key API:** `index(entries)`, `resolveCallTarget(targetId, sourceId) → string`, `resolveImportTarget(targetId, sourceId, metadata) → string`
- **Resolution flow:** Maps `byName` (simple name → Set<fullId>), `byNamespace` (namespace → Set<fullId>), and `pathToNamespace`/`namespaceToPath`. `resolveRelationships()` rewrites target IDs for CALLS, IMPORTS, IMPLEMENTS, and INHERITS relationships.
- **Exact-match preference in MCP tools:** `resolveSymbolId` prefers exact name matches over CONTAINS matches to avoid picking the wrong symbol (e.g. `GraphRepository` vs `Neo4jGraphRepository`).

### IncrementalIndexerService
- **File:** `application/services/incremental-indexer.service.ts`
- **Responsibility:** Indexes only changed files since a git commit
- **Dependencies:** `GitAdapter` + same as IndexerService
- **Key API:** `indexSince(repoPath, repoName, sinceCommit) → IndexResult`

### SymbolDiffer
- **File:** `application/services/symbol-differ.service.ts`
- **Responsibility:** Compares old vs new symbol sets via contentHash
- **Key API:** `diff(oldSymbols, newSymbols) → SymbolDelta { added[], modified[], deleted[], unchanged[] }`

### FileWalker
- **File:** `infrastructure/file-walker.ts`
- **Responsibility:** Recursive directory walker with `.gitignore` support
- **Key API:** `walk(rootPath, options) → WalkedFile[]`

### FileWatcherService
- **File:** `infrastructure/file-watcher.ts`
- **Responsibility:** `fs.watch`-based directory monitoring with debounce
- **Key API:** `watch(repoPath, callback) → cleanup function`

### LanguageDetector
- **File:** `infrastructure/language-detector.ts`
- **Responsibility:** Maps file extensions + shebangs to `Language` enum
- **Key API:** `detectLanguage(filePath, content?) → Language | null`

---

### RetrieverService
- **Package:** `@yats/retrieval`
- **File:** `application/services/retriever.service.ts`
- **Responsibility:** Hybrid retrieval pipeline (embed → Qdrant → Neo4j → merge → dedup → rank → compress → budget)
- **Dependencies:** `GraphRepository`, `VectorRepository`, `EmbeddingGenerator`
- **Key API:** `retrieve(query: RetrievalQuery) → RetrievalResult`

### RankerService
- **File:** `application/services/ranker.service.ts`
- **Responsibility:** Composite scoring: vector score + kind boost + source boost + docComment + snippet length
- **Kind boosts:** SERVICE/CONTROLLER +0.2, ENTITY/REPOSITORY +0.15, COMMAND/QUERY/EVENT +0.1
- **Strategies:** `relevance`, `diversity`

### DeduplicatorService
- **File:** `application/services/deduplicator.service.ts`
- **Responsibility:** Symbol ID dedup + per-file limit (3 per file)
- **Key API:** `deduplicate(items, options) → RankedContextItem[]`

### TokenBudgetService
- **File:** `application/services/token-budget.service.ts`
- **Responsibility:** Token estimation (chars/3.5) + budget fitting with signature fallback
- **Key API:** `estimateTokens(text) → number`, `fitWithinBudget(items, maxTokens) → RankedContextItem[]`

### ContextCompressorService
- **File:** `application/services/context-compressor.service.ts`
- **Responsibility:** Snippet truncation (50 lines), import stripping, test filtering
- **Key API:** `compress(items, options) → RankedContextItem[]`

---

## Adapter Components

### McpServer
- **Package:** `@yats/mcp-server`
- **File:** `server.ts`
- **Responsibility:** MCP JSON-RPC server over stdio, HTTP+SSE, and Streamable HTTP
- **Key API:** `start({ transport?, port? })` — blocks until shutdown
- **Endpoints:** `/mcp` (Streamable HTTP; GET with `Accept: text/event-stream` opens SSE session), `/mcp/sse` (SSE), `/mcp/message` (SSE messages), `/health`
- **Handles:** `initialize`, `tools/list`, `tools/call`, `shutdown`, `ping`

### MCP Tools
- **File:** `tools/all-tools.ts`
- **Responsibility:** 20 tool definitions + handler factory (read-only search & query, plus async indexing and deletion)
- **Tools:** `search_code`, `search_documentation`, `find_symbol`, `find_references`, `find_callers`, `find_callees`, `find_implementations`, `find_inheritors`, `find_tests`, `find_routes`, `find_configuration`, `expand_graph`, `related_symbols`, `list_symbols`, `repository_summary`, `architecture_summary`, `search_similar`, `list_repositories`, `index_repository`, `delete_repository`

#### `index_repository` (async)
- Runs indexing in the background and returns immediately with `status: "indexing_started"`
- Includes `agentInstructions` telling the AI agent how to poll progress via `repository_summary`
- Parameter `skipDocs` (boolean): skips documentation indexing
- Docs warning: if `skipDocs` is not set and the repo has >300 `.md` files, returns a warning asking the agent to confirm the doc indexing decision
- Resolution of `IMPLEMENTS` and `INHERITS` relationships uses `resolveCallTarget` in `GlobalSymbolTable` for cross-file reference resolution
- Symbol name resolution in tools uses exact-match preference (fixes `CONTAINS` matching returning wrong symbols)

#### `delete_repository`
- Deletes all indexed data for a repository without touching source files
- Two-step confirmation: first call without `confirm` returns a warning with repo stats; call with `confirm: true` to execute
- Accepts `repository` (name) or `path` (resolved to repo name)

### MCP Middleware
- **Files:** `middleware/error-handler.ts`, `middleware/rate-limiter.ts`, `middleware/logger.ts`
- **Error handler:** Catches exceptions → JSON-RPC error response
- **Rate limiter:** Sliding window, 60 calls/min default
- **Logger:** Logs every tool call with timing

### CLI
- **Package:** `@yats/cli`
- **File:** `src/index.ts`
- **Responsibility:** Commander-based CLI entry point
- **Commands:** `list`, `index`, `search`, `serve`, `summary`, `clear`

### Bridge
- **Package:** `packages/bridge`
- **File:** `src/bridge.js`
- **Responsibility:** Thin proxy that translates stdio MCP ↔ HTTP+SSE
- **Key API:** `npx yats-bridge [--port 5555] [--url http://...]`
- **Usage:** For MCP clients that only speak stdio, bridge connects to the HTTP YATS server

### Setup Wizard
- **Package:** `packages/setup`
- **File:** `src/setup.js`
- **Responsibility:** One-command setup: detects Docker, writes compose file, starts services
- **Key API:** `npx yats-setup` or `curl -fsSL https://get.yats.site | bash`

---

## Analyzer Components

### AbstractAnalyzer
- **Package:** `@yats/analyzer-interface`
- **File:** `analyzer.ts`
- **Responsibility:** Base class with `createSymbol`, `createRelationship`, `makeId`, `warning`, `error` helpers

### AnalyzerFactory
- **File:** `factory.ts`
- **Responsibility:** Registry of analyzers, dispatches by language
- **Key API:** `register(analyzer)`, `getAnalyzer(language)`, `getAnalyzerForFile(path)`

### TypeScriptAnalyzer
- **Package:** `@yats/analyzer-typescript`
- **Responsibility:** Full TS Compiler API analyzer
- **Extracts:** Classes, interfaces, enums, type aliases, methods, properties, constructors, getters/setters, decorators, functions, variables, imports, exports
- **Relationships:** CONTAINS, INHERITS, IMPLEMENTS, CALLS, IMPORTS, EXPORTS, DECORATES
- **Conventions:** NestJS (Controller, Injectable, Module), TypeORM (Entity), naming suffixes

### GoAnalyzer
- **Package:** `@yats/analyzer-go`
- **Responsibility:** Go analyzer via subprocess bridge
- **Bridge:** Go binary spawned as subprocess, returns JSON
- **Responsibility:** PHP analyzer via PHP-Parser bridge subprocess
- **Fallback:** Regex-based when PHP not available
- **Conventions:** Symfony, Laravel, Doctrine, naming suffixes

### CSharpAnalyzer
- **Package:** `@yats/analyzer-csharp`
- **Responsibility:** Python analyzer via LibCST + Jedi bridge subprocess
- **Fallback:** Regex-based when LibCST not available
- **Conventions:** FastAPI, Flask, Django, SQLAlchemy, Pydantic

### TreeSitterAnalyzer
- **Package:** `@yats/analyzer-treesitter`
- **Responsibility:** Universal fallback for TypeScript and Go
- **Strategies:** tree-sitter AST + query files, then regex fallback

[← Back to README](./README.md)
