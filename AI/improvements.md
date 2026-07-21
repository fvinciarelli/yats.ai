# Improvements & Technical Debt

## Missing Features

### C# Roslyn Analyzer (T-030 to T-032)
- **Status:** Placeholder only (`packages/analyzers/analyzer-csharp/src/index.ts` is a stub)
- **What's needed:** A .NET 8 console project that accepts `--file <path>`, parses with Roslyn, outputs JSON. Then a Node.js wrapper like `PhpAnalyzer`.
- **Estimated effort:** 2-3 coding sessions

### Integration Test Suite (T-083)
- **Status:** No end-to-end tests exist
- **What's needed:** Test fixtures (small repos in each language), Docker Compose test environment, full pipeline: index → search → verify results
- **Estimated effort:** 3-4 coding sessions

## Technical Debt

### 1. No retry/circuit breaker (T-080)
- **Current state:** Basic retry in `Neo4jConnection.connect()` (5 attempts, exponential backoff) and `OpenAIEmbeddingGenerator` (rate-limit retry)
- **Missing:** Generic retry wrapper, circuit breaker pattern (open circuit after N failures)
- **Risk:** Repeated failures to Neo4j/Qdrant could spiral into timeout storms

### 2. No metrics/observability (T-081)
- **Current state:** Structured JSON logging only
- **Missing:** Prometheus metrics (`/metrics` endpoint), request tracing (request IDs), latency histograms
- **Risk:** Hard to debug production issues without metrics

### 3. Token estimation is crude
- **Current state:** `chars / 3.5` heuristic in `TokenBudgetService`
- **Better approach:** Use `tiktoken` or a model-specific tokenizer
- **Risk:** Budget may be off by 30-50% for code with dense symbols

### 4. No Neo4j query parameterization validation
- **Current state:** Cypher queries use parameterized inputs (safe from injection), but there's no validation that required parameters exist
- **Risk:** A missing parameter causes a confusing Neo4j error rather than a clear validation error

### 5. `SimpleGitAdapter` uses `execSync`
- **Current state:** Blocking synchronous git operations
- **Better approach:** Use `simple-git` npm package (async) or `node:child_process.exec`
- **Risk:** Blocks the event loop during git operations (acceptable for CLI, problematic for server)

### 6. MCP server has no HTTP transport
- **Current state:** Stdio-only transport
- **Missing:** HTTP/SSE transport for remote MCP connections
- **Note:** Stdio is the standard MCP transport. HTTP is optional per spec.

### 7. No input sanitization on MCP tools
- **Current state:** Tool arguments are passed directly to services
- **Missing:** Schema validation (zod is installed but unused), input length limits, path traversal checks on file tools
- **Risk:** Malicious MCP client could attempt path traversal (partially mitigated by `LocalFileSystem.validatePath()`)

### 8. Neo4j `expandGraph` doesn't return relationships
- **Current state:** `expandGraph()` returns only nodes, not edges
- **Missing:** Full subgraph with relationships for visualization/traversal
- **Impact:** MCP clients can see connected symbols but not HOW they're connected

## Reliability Risks

### 1. Single point of failure: Neo4j
- If Neo4j is down, the entire platform is unusable (both indexing and retrieval)
- No read-replica or fallback

### 2. Single point of failure: Qdrant
- If Qdrant is down, semantic search fails
- Graph-only search could be a fallback but isn't implemented

### 3. No persistent queue for indexing
- If the indexer crashes mid-index, there's no resume capability
- Large repositories must be re-indexed from scratch

### 4. Subprocess bridge reliability
- PHP and Python analyzers depend on `php` and `python3` being on PATH
- No health check to verify bridge availability before indexing
- Bridge process crashes are caught but are silent (just skip the file)

## Possible Refactors

### 1. Extract Cypher queries to `.cypher` files
- Currently: queries are inline string templates in `Neo4jGraphRepository`
- Better: Load from `.cypher` files (like `001-schema.cypher`). Easier to review, test, and syntax-highlight.

### 2. Unify analyzer subprocess pattern
- Currently: `PhpAnalyzer` and `PythonAnalyzer` each have their own spawn logic
- Better: Extract a `SubprocessAnalyzer` base class that handles spawn, stdout collection, JSON parsing, error handling

### 3. Replace custom logger with pino
- Currently: ~80-line custom `ConsoleLogger`
- Better: pino (planned in ARCHITECTURE.md). Structured logging, log levels, transports, child loggers.

### 4. Add `Result<T, E>` pattern for error handling
- Currently: Mixed error handling (exceptions + result objects + error arrays)
- Better: Consistent `Result<T, Error>` return type across services

### 5. Add MCP tool tests
- Currently: No tests for MCP tool handlers
- Better: Mock `Retriever`/`GraphRepository` and verify each tool handler returns the correct format

## Missing Tests

| Area | Test Count | Needed |
|------|-----------|--------|
| Domain (hash, id-gen) | 16 tests | ✅ Adequate |
| TypeScript Analyzer | 9 tests | ✅ Adequate for now |
| PHP Analyzer | 0 tests | ❌ Need fixture tests |
| Python Analyzer | 0 tests | ❌ Need fixture tests |
| Tree-sitter Analyzer | 0 tests | ❌ Need fixture tests |
| IndexerService | 0 tests | ❌ End-to-end with mock repos |
| RetrieverService | 0 tests | ❌ Integration with mock Neo4j/Qdrant |
| MCP Server | 0 tests | ❌ JSON-RPC protocol tests |
| MCP Tools | 0 tests | ❌ Each tool handler |
| Middleware | 0 tests | ❌ Error handler, rate limiter |

## Architecture Drift from ARCHITECTURE.md

| Feature | ARCHITECTURE.md | Implemented? |
|---------|----------------|-------------|
| Redis cache | Optional service | Yes (docker-compose profile) |
| Postgres metadata | Optional service | Yes (docker-compose profile) |
| HTTP API adapters | Listed in layers | No (stdio-only) |
| CQRS command/query handlers | Separate handler files | Merged (tools + services) |
| Prometheus metrics | Mentioned | No |
| pino logger | Specified | No (custom logger) |
| `simple-git` npm package | Specified | No (`execSync` wrapper) |

[← Back to README](./README.md)
