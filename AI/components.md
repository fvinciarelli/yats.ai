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
- **Error handling:** EPIPE errors (client disconnects) are caught via `res.on("error")` on every request and on SSE sessions, preventing server crashes during long operations
- **Handles:** `initialize`, `tools/list`, `tools/call`, `shutdown`, `ping`

### MCP Tools
- **File:** `tools/all-tools.ts`
- **Responsibility:** 20 tool definitions + handler factory (read-only search & query, plus async indexing and deletion)
- **Tools:** `search_code`, `search_documentation`, `find_symbol`, `find_references`, `find_callers`, `find_callees`, `find_implementations`, `find_inheritors`, `find_tests`, `find_routes`, `find_configuration`, `expand_graph`, `related_symbols`, `list_symbols`, `repository_summary`, `architecture_summary`, `search_similar`, `list_repositories`, `index_repository`, `delete_repository`

#### `index_repository` (delegates to CLI)
- Does NOT index directly — returns instructions for the AI agent to run `yats index <path>` on the user's machine
- The `yats` CLI walks local files and sends them to the YATS server via HTTP, so no Docker volume mounts are needed
- Agent instructions include: what to tell the user, docs skip option (`--skip-docs`, ~30s per 200 .md files), polling with `repository_summary`, and stop condition (relationships stable)
- Parameter `skipDocs` (boolean): passed as `--skip-docs` to the CLI; skips documentation indexing

#### `delete_repository`
- Deletes all indexed data for a repository without touching source files
- Two-step confirmation: first call without `confirm` returns a warning with repo stats; call with `confirm: true` to execute
- Accepts `repository` (name) or `path` (resolved to repo name)

### MCP Middleware
- **Files:** `middleware/error-handler.ts`, `middleware/rate-limiter.ts`, `middleware/logger.ts`
- **Error handler:** Catches exceptions → JSON-RPC error response
- **Rate limiter:** Sliding window, 60 calls/min default
- **Logger:** Logs every tool call with timing

### Dev CLI
- **Package:** `@yats/dev-cli`
- **File:** `src/index.ts`
- **Responsibility:** Local development MCP server with direct database access
- **Commands:** `yats-dev start [--http] [--port N]`, `yats-dev stop`
- **Dependencies:** Full workspace (Neo4j, Qdrant, analyzers, etc.) — NOT published to npm

### YATS Toolkit
- **Package:** `yats-toolkit` (published to npm)
- **Files:** `bin/setup.js` (entry), `src/*.js` (commands)
- **Responsibility:** User-facing CLI. All commands are thin HTTP clients that call the YATS MCP server.
- **Commands:** `setup`, `index`, `search`, `list`, `summary`, `clear`, `status`, `stop`, `bridge`, `benchmark`
- **Key API:** `npx yats-toolkit` — one-command setup wizard
- **Bridge:** `yats bridge` — MCP stdio ↔ HTTP proxy (for Copilot, Claude Desktop)
- **Benchmark:** `yats benchmark` — AI agent token comparison (zero deps, Node built-ins only)
- **Dependencies:** None (Node.js built-ins only)

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

## Benchmark & Adapters (`packages/yats-toolkit/benchmark/`)

### Benchmark Wizard (`run.sh`)
- **Responsibility:** Interactive wizard to run AI agent benchmarks
- **Agents:** Cursor, Claude CLI, Copilot CLI, Codex, Gemini CLI
- **Flow:** Select agent → language → repo → workdir → auto-clone from `targets/repos.json` → auto-index in YATS → run questions from repo directory
- **Metrics:** Tokens (input/output) for Cursor/Claude/Codex/Gemini; nanoAiu for Copilot
- **Output:** JSONL logs + summary JSON in `results/`

### MCP Bridge stdio — benchmark (`adapters/mcp-bridge-stdio.cjs`)
- **Responsibility:** Standalone copy used by the benchmark wizard for isolated testing
- **Deps:** Zero (Node.js built-ins: http, https, readline)
- **Protocol:** MCP JSON-RPC over stdin/stdout
- **Features:** Auto-inject repository, structuredContent for Gemini, tool forwarding

### YATS Bridge — production (`src/bridge.js`, command: `yats bridge`)
- **Responsibility:** MCP stdio server for production use by AI agents
- **Deps:** Zero (Node.js built-ins)
- **Protocol:** MCP JSON-RPC over stdin/stdout, forwarding to YATS via Streamable HTTP
- **Features:** Auto-inject repository from `YATS_DEFAULT_REPO` or cwd basename, structuredContent for Gemini CLI, pending queue for async responses
- **Usage:** `yats bridge [--port N] [--url http://...]`
- **Agent configs:** Copilot (`type: local`), Gemini (`.gemini/settings.json`), Codex (`.codex/config.toml`), Claude Desktop

### MCP Bridge HTTP (`adapters/mcp-openai-bridge.cjs`)
- **Responsibility:** OpenAI-compatible HTTP proxy with MCP tool injection
- **Deps:** Zero (Node.js built-ins)
- **Features:** Tool interception, limit enforcement (max 3 calls), model mapping
- **Usage:** Any OpenAI-compatible client (`--api-base http://localhost:8000/v1/`)

## Agent Instructions (`docs/agents_instructions/`)

### SKILL.md (Claude Code)
- **Responsibility:** YATS skill with auto-invocation for code questions
- **Location:** `.claude/skills/yats/SKILL.md`
- **Content:** Workflow (search_code → find_symbol → expand_graph), golden rule

### AGENTS.md (Codex CLI)
- **Responsibility:** Orientation file loaded at session start
- **Location:** `AGENTS.md` in repo root
- **Content:** MCP tool list, max 3 calls rule, anti-subagent instruction

### config.toml (Codex CLI MCP)
- **Responsibility:** MCP stdio bridge configuration
- **Key setting:** `multi_agent = false` (forces direct MCP usage, no subagents)

### .cursorrules (Cursor)
- **Responsibility:** Project rules for YATS MCP usage
- **Location:** `.cursor/rules/yats.mdc` or `.cursorrules`

### GEMINI.md (Gemini CLI)
- **Responsibility:** Instructions for Gemini CLI to use YATS MCP tools
- **Location:** `GEMINI.md` in repo root
- **Content:** Tool list, golden rule (YATS first, files second), 3-step workflow

### .gemini/settings.json (Gemini CLI MCP)
- **Responsibility:** MCP stdio bridge configuration for Gemini
- **Key settings:** `command: node`, `args: [bridge.cjs, --stdio]`, `trust: true`
- **Env required:** `GEMINI_CLI_TRUST_WORKSPACE=true`

[← Back to README](./README.md)
