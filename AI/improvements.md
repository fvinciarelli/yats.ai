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

### 6. MCP server HTTP transport — ✅ DONE
- **Current state:** Supports stdio, HTTP+SSE, and Streamable HTTP (`/mcp`)
- **Endpoints:** `/mcp` (Streamable HTTP), `/mcp/sse` (SSE), `/mcp/message` (SSE messages), `/health`, `/index`, `/index/file`

### 7. No input sanitization on MCP tools
- **Current state:** Tool arguments are passed directly to services
- **Missing:** Schema validation (zod is installed but unused), input length limits, path traversal checks on file tools
- **Risk:** Malicious MCP client could attempt path traversal (partially mitigated by `LocalFileSystem.validatePath()`)

### 8. Neo4j `expandGraph` doesn't return relationships
- **Current state:** `expandGraph()` returns only nodes, not edges
- **Missing:** Full subgraph with relationships for visualization/traversal
- **Impact:** MCP clients can see connected symbols but not HOW they're connected

## Recently Fixed

### ✅ Package restructure: `setup` → `yats-toolkit`, `cli` → `dev-cli`
- **Was:** Three fragmented packages: `packages/setup` (thin HTTP scripts), `packages/cli` (fat CLI with direct DB), `packages/bridge` (duplicate bridge). Binaries conflicted (both `yats`). Users confused about which package to install.
- **Fix:** 
  - `packages/yats-toolkit`: Unified user-facing CLI published to npm. All commands as thin HTTP clients (zero dependencies): `setup`, `index`, `search`, `list`, `summary`, `clear`, `status`, `stop`, `bridge`, `benchmark`.
  - `packages/dev-cli`: Local development server only (`yats-dev start/stop`). NOT published.
  - `packages/bridge`: Removed (duplicate, now inside yats-toolkit as `yats bridge`).
  - Benchmark moved from `cli` to `yats-toolkit`, rewritten without `@yats/shared`/Commander/Chalk — pure Node.js built-ins.

### ✅ New thin commands in yats-toolkit
- **New:** `yats search`, `yats list`, `yats summary`, `yats clear` — all thin HTTP clients that call the corresponding MCP tool on the server.

### ✅ LICENSE rewritten
- **Was:** Basic MIT-style with vague commercial tiers
- **Now:** Full professional license: no support at any tier, no warranty, no liability (data loss, code, revenue, business interruption, indirect damages), clear developer-count tiers, "AS IS".

---

## Recently Fixed (from previous sessions)

### ✅ IMPLEMENTS and INHERITS cross-file resolution
- **Was:** `resolveRelationships` in `GlobalSymbolTable` only handled CALLS and IMPORTS. IMPLEMENTS and INHERITS kept wrong target IDs (scoped to the current file), so Neo4j edges never matched their target interfaces/classes.
- **Fix:** Added IMPLEMENTS and INHERITS to `resolveRelationships`, reusing `resolveCallTarget` logic (extract simple name, look up globally, filter by different file/namespace).

### ✅ `extractHeritage` skipped by member processing errors
- **Was:** In `TypeScriptAnalyzer.processNode`, `extractHeritage` was called AFTER `processClassMember`. If a class member triggered an error (e.g. invalid symbol ID from chained methods like `rows.filter(...)`), heritage extraction was skipped.
- **Fix:** Moved `extractHeritage` before the member processing loop.

### ✅ MCP `find_implementations` returning empty results
- **Was:** `resolveSymbolId` used the first result from `findSymbolByName`, which uses CONTAINS matching. Searching "GraphRepository" returned "Neo4jGraphRepository" first, so the tool looked for implementations of a class instead of the interface.
- **Fix:** `resolveSymbolId` now prefers exact name matches over CONTAINS matches.

### ✅ Streamable HTTP SSE support on `/mcp`
- **Was:** GET `/mcp` returned `{"status":"ok"}` JSON regardless of the `Accept` header. MCP clients (like pi-mcp-adapter) using Streamable HTTP transport expect GET with `Accept: text/event-stream` to open an SSE session.
- **Fix:** GET `/mcp` now checks the `Accept` header; if it includes `text/event-stream`, it opens an SSE session via `handleSseConnect`.

### ✅ Async `index_repository` MCP tool
- **Was:** `index_repository` waited for the full indexing pipeline (walk → analyze → embed → store) before responding, causing MCP timeouts for large repos.
- **Fix:** The tool now launches indexing in the background and returns immediately with `status: "indexing_started"` plus `agentInstructions` for polling progress via `repository_summary`.

### ✅ `delete_repository` MCP tool
- **New:** Two-step confirmation flow. First call without `confirm` returns a warning with repo stats. Second call with `confirm: true` executes the deletion (symbols, relationships, vectors, and Repository node).

### ✅ `skipDocs` option on `index_repository`
- **New:** Boolean parameter to skip documentation indexing. The tool also detects repos with >300 `.md` files and asks for confirmation before indexing docs.

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
| Redis cache | Optional service | No (removed, not needed) |
| Postgres metadata | Optional service | No (removed, not needed) |
| HTTP API adapters | Listed in layers | ✅ Done (HTTP+SSE + Streamable HTTP) |
| CQRS command/query handlers | Separate handler files | Merged (tools + services) |
| Prometheus metrics | Mentioned | No |
| pino logger | Specified | No (custom logger) |
| `simple-git` npm package | Specified | No (`execSync` wrapper) |
| Multi-service Docker | Separate Dockerfiles per service | Unified single Dockerfile + compose |
| PHP/Python analyzers | Full bridge implementations | Removed (not in current scope) |
| Go analyzer | Not planned | ✅ Done (subprocess bridge) |
| File tools (read/write/edit) | In MCP tools | Removed (search-only philosophy) |
| MCP stdio bridge for Codex | Not planned | ✅ Done (see below) |
| Agent instructions (SKILL.md, AGENTS.md) | Not planned | ✅ Done in `docs/agents_instructions/` |
| Benchmark suite | Not planned | ✅ Done in `packages/yats-toolkit/benchmark/` |

## Recently Completed

### ✅ Gemini CLI + YATS MCP stdio (2026-07-29)
- **Gemini CLI 0.53.0** connected via MCP stdio bridge (`GEMINI_CLI_TRUST_WORKSPACE=true`)
- 16 YATS tools discovered and connected
- 3 tool calls executed: `list_repositories`, `find_symbol`, `search_code`
- Minor parameter format mismatch (Gemini→YATS) — tools called but return schema errors
- Config: `.gemini/settings.json` with `command: node, args: [bridge.cjs, --stdio]`
- Instructions: `GEMINI.md` in repo root

### ✅ Copilot CLI partial integration
- Copilot CLI 1.0.75 recognizes YATS from `.github/copilot-instructions.md`
- MCP via HTTP and stdio attempted but not fully working (uses grep fallback)
- Agent instructions template created in `docs/agents_instructions/copilot/`

### ✅ Agent instructions for all 5 agents
- `docs/agents_instructions/` now covers: Claude (SKILL.md), Codex (AGENTS.md + config.toml), Cursor (.cursorrules), Copilot (copilot-instructions.md), Gemini (GEMINI.md + settings.json)

### ✅ Benchmark: Codex + YATS MCP stdio (2026-07-29)
- **Result:** 73% token reduction (100k → 27k) for symbol lookup
- Codex configured with MCP stdio bridge + `multi_agent = false`
- 1 MCP `find_symbol` call replaces 5 bash commands (rg, head)
- Full report: `packages/yats-toolkit/benchmark/results/codex-mcp-stdio-benchmark.md`

### ✅ MCP Bridge adapters
- `adapters/mcp-bridge-stdio.cjs` — stdio MCP server wrapping YATS tools. Codex spawns as subprocess.
- `adapters/mcp-openai-bridge.cjs` — HTTP proxy that injects MCP tools as OpenAI functions. Works with any OpenAI-compatible client (tested with Aider + DeepSeek).
- Both zero dependencies (Node.js built-ins only).

### ✅ Agent instructions (`docs/agents_instructions/`)
- `claude/SKILL.md` — YATS skill with auto-invocation
- `codex/AGENTS.md` + `config.toml` — orientation + MCP stdio config
- `cursor/.cursorrules` — rules for YATS tool usage
- Users can customize for their repos (repo name, max calls, domain knowledge).

### ✅ Benchmark cleanup
- Removed Aider from benchmark (not suitable for Q&A — code editor, not agent)
- Removed `codex-bridge` workaround (MCP stdio is the proper solution)
- Removed `mcpm-aider` dependency (doesn't exist on PyPI; replaced by our own bridges)
- Wizard now has 4 agents: Cursor, Claude CLI, Copilot CLI, Codex

### ✅ DeepSeek as LLM backend
- Bridge supports DeepSeek API via `YATS_BRIDGE_UPSTREAM_URL`
- Model name mapping (gpt-4o-mini → deepseek-chat)
- Tool calling confirmed working with DeepSeek

[← Back to README](./README.md)
