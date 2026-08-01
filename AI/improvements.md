# Improvements & Technical Debt

## Missing Features

### ✅ C# Roslyn Analyzer (T-030 to T-032) — fixed 2026-07-30
- **Status:** ✅ Complete. Full Roslyn bridge with `CSharpSyntaxWalker` + Node.js wrapper + regex fallback.
- **Bridge:** .NET 8 console app at `src/csharp-bridge/`. Extracts: classes, interfaces, enums (with members), structs, records, methods, constructors, destructors, properties, fields, constants, events, delegates, using directives. Produces CONTAINS, CALLS, INHERITS, IMPLEMENTS, IMPORTS relationships. SHA256 content hashes. Generic type params in signatures. Supports `--stdin` for HTTP-based indexing.
- **Node.js wrapper:** `CSharpAnalyzer` spawns bridge with proper kind mapping (UPPERCASE → SymbolKind enum). Content hash computed in bridge + fallback. Regex fallback when dotnet not available. Uses `--no-build` to prevent dotnet from consuming stdin. Fixed `bridgeDir` to resolve correctly when imported from `dist/` vs `src/`.
- **Tests:** 16 tests covering bridge + fallback (CONTAINS, CALLS, fields, enums, events, delegates, records, method scoping).
- **E2E verified:** eShopOnWeb — 1,227 symbols, 2,045 relationships indexed successfully.
- **Integration:** Registered in `dev-cli` via `AnalyzerFactory`. Extensions `.cs`, `.csx`. Docker image built and published to `ghcr.io/fvinciarelli/yats:latest`.

### Integration Test Suite (T-083) 🟡
- **Status:** Foundation built. Test fixtures for all 5 languages exist at `test/fixtures/`. Integration tests for analyzers (19 tests) and incremental indexing with git (5 tests) pass. MCP server protocol + validation tests (12 tests) pass.
- **Still needed:** Docker Compose test environment, full pipeline: index → search → verify results with real Neo4j/Qdrant, RetrieverService integration tests
- **Estimated effort:** 2-3 more coding sessions

### Release pipeline & versionado (🆕 2026-07-29)
- **Status:** No hay releases, tags, ni CI/CD de publicación. El repo evoluciona sin versionado.
- **Problema:** YATS se consume en 3 canales distintos que deben estar sincronizados:
  - `yats-toolkit` (npm) → `npx yats-toolkit`
  - Docker images (server) → `docker compose up`
  - `connect/` (instrucciones + configs para agents) → copiar archivos al repo del usuario
- **Estrategia propuesta:** Un solo tag de repo (`v0.2.0`) que orquesta todo:
  - npm: `yats-toolkit@0.2.0`
  - docker: `fvinciarelli/yats-server:0.2.0`
  - `connect/` versionado implícitamente por el tag (accesible vía GitHub raw URL)
- **Esquema de versionado:** SemVer laxo en 0.x (todo puede romper), estricto a partir de 1.0.0
- **Qué falta:**
  1. `.github/workflows/release.yml` — CI que se dispare con tags, corra tests, publique npm + docker, genere GitHub Release
  2. `CHANGELOG.md` — mantenerlo al día
  3. Versionar `docker-compose.yml` para que use tags en vez de `build: .`
  4. Decidir si paquetes internos (`@yats/shared`, `@yats/indexing`, etc.) se publican o quedan privados
- **Estimated effort:** 1-2 coding sessions

## Technical Debt

### 1. No retry/circuit breaker (T-080)
- **Current state:** Basic retry in `Neo4jConnection.connect()` (5 attempts, exponential backoff) and `OpenAIEmbeddingGenerator` (rate-limit retry)
- **Missing:** Generic retry wrapper, circuit breaker pattern (open circuit after N failures)
- **Risk:** Repeated failures to Neo4j/Qdrant could spiral into timeout storms

### 2. No metrics/observability (T-081)
- **Current state:** Structured JSON logging only
- **Missing:** Prometheus metrics (`/metrics` endpoint), request tracing (request IDs), latency histograms
- **Risk:** Hard to debug production issues without metrics

### 3. Token estimation — won't fix (2026-08-01)
- **Assessment:** The `chars/3.5` heuristic measures structured JSON output (names, kinds, truncated snippets), not raw source code. Accurate enough for this format. Model-specific tokenizers would only help for one provider and add dependency weight for negligible gain.
- **Decision:** Won't fix.

### ✅ TokenBudgetService: `break` en vez de `continue` (🆕 encontrado 2026-07-29 → ✅ fixed 2026-07-30)
- **Was:** `fitWithinBudget()` usaba `break` cuando un item no entraba en el presupuesto y no tenía signature de fallback. Esto cortaba todo el loop y descartaba items subsiguientes que sí entrarían.
- **Fix:** Cambiado `break` por `continue` para saltar solo el item problemático, no todos los que vienen después.
- **Location:** `packages/retrieval/src/application/services/token-budget.service.ts` ~línea 38
- **Test:** Actualizado test `"skips items when neither snippet nor signature fits, continues with next"` — ahora verifica que el segundo item sí se incluye.

### 5. No Neo4j query parameterization validation
- **Current state:** Cypher queries use parameterized inputs (safe from injection), but there's no validation that required parameters exist
- **Risk:** A missing parameter causes a confusing Neo4j error rather than a clear validation error

### 6. `SimpleGitAdapter` uses `execSync`
- **Current state:** Blocking synchronous git operations
- **Better approach:** Use `simple-git` npm package (async) or `node:child_process.exec`
- **Risk:** Blocks the event loop during git operations (acceptable for CLI, problematic for server)

### 7. MCP server HTTP transport — ✅ DONE
- **Current state:** Supports stdio, HTTP+SSE, and Streamable HTTP (`/mcp`)
- **Endpoints:** `/mcp` (Streamable HTTP), `/mcp/sse` (SSE), `/mcp/message` (SSE messages), `/health`, `/index`, `/index/file`

### ✅ No input sanitization on MCP tools — fixed 2026-08-01
- **Was:** Tool arguments were passed directly to services. Zod was installed but unused.
- **Fix:** `middleware/validation.ts` — Zod schemas for all 23 tools. `safePath` blocks system roots (`/`, `/home`, `/etc`, etc.), path traversal (`..`), Windows roots. Integrated in `server.ts` via `validateArgs()` — runs before every handler. Friendly error messages with actionable guidance when agent sends bad paths.
- **Location:** `packages/mcp-server/src/middleware/validation.ts`, `packages/mcp-server/src/server.ts`

### ✅ Neo4j `expandGraph` now returns relationships — fixed 2026-08-01
- **Was:** `expandGraph()` returned only nodes, not edges. MCP clients could see connected symbols but not HOW they're connected.
- **Fix:** Cypher query now uses `UNWIND relationships(path) AS rel` and returns both nodes and edges with `sourceId`, `targetId`, and `kind`.
- **Location:** `packages/infra/src/neo4j/neo4j-graph-repository.ts`

### 🟡 10. MCP bridge auto-injects default repo (investigated 2026-07-31, NOT a server bug)
- **Current state:** `yats bridge` auto-injects `repository` from `YATS_DEFAULT_REPO` or `cwd` basename when tools don't provide one. The server-side `RetrieverService` correctly filters by repository — confirmed via direct Neo4j queries.
- **Observed:** Some MCP clients (pi adapter) may pass `repository` in a format the tool doesn't recognize, causing the bridge to fall back to the default repo. The server-side filtering is correct.
- **Mitigation:** Set `YATS_DEFAULT_REPO` explicitly, or use `path` instead of `repository` in tool calls. Bridge code at `packages/yats-toolkit/src/bridge.js` line 41-48.

## Recently Fixed

### ✅ Tests: 125 tests en 10 archivos nuevos (2026-07-29)
- **Antes:** 20 tests en 3 archivos (solo shared/utils y analyzer-typescript)
- **Ahora:** 125 tests en 13 archivos cubriendo shared (logger, enums), todos los analyzers (Go, Python, PHP, C#, TreeSitter), y retrieval (ranker, deduplicator, token-budget)
- **Nuevos tests:** `logger.test.ts`, `enums.test.ts`, `go-analyzer.test.ts`, `python-analyzer.test.ts`, `php-parser-analyzer.test.ts`, `csharp-analyzer.test.ts`, `treesitter-analyzer.test.ts`, `ranker.service.test.ts`, `deduplicator.service.test.ts`, `token-budget.service.test.ts`
- **Script agregado:** `analyzer-go/package.json` no tenía script `test` — agregado.
- **TODOs:** Fase 2 pendiente (indexing, mcp-server, infra, dev-cli). Ver sección Missing Tests.

### ✅ `yats-toolkit` es JS puro — inconsistencia detectada (2026-07-29)
- **Current state:** `packages/yats-toolkit/src/` son 10 archivos `.js` planos. El resto del proyecto (146 archivos) es TypeScript estricto.
- **Risk:** Sin type checking en el CLI que enfrenta al usuario. Sin autocompletado para quien contribuye.
- **Fix:** Migrar a TypeScript (bajo esfuerzo, solo agregar tipos).

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

## Recently Fixed (2026-08-01 — session: docs, website, integration tests, live sync)

### ✅ `incrementalIndex()` stub wired — fixed 2026-08-01
- **Was:** `IndexerService.incrementalIndex()` was a stub calling full `indexRepository()` instead of delegating to `IncrementalIndexerService.indexSince()` which was fully implemented.
- **Fix:** Now delegates to a new `IncrementalIndexerService` instance. Falls back to full reindex only when `gitAdapter` is unavailable.
- **Location:** `packages/indexing/src/application/services/indexer.service.ts`

### ✅ `removeFileSymbols()` implemented — fixed 2026-08-01
- **Was:** Private method was a stub that just logged. Deleted files left dead symbols in Neo4j + Qdrant.
- **Fix:** Now queries `listSymbols` for file path, filters matching symbols, deletes from both Neo4j (`deleteSymbols`) and Qdrant (`deleteVectors`).
- **Location:** `packages/indexing/src/application/services/indexer.service.ts`

### ✅ MCP tools: `reindex`, `index_file`, `remove_file` — added 2026-08-01
- **New tools (20 → 23):**
  - `reindex` — explicit reindex trigger via `ensureIndexed()`, reports status + summary
  - `index_file` — single file reindex after agent edit, under 1 second
  - `remove_file` — removes all symbols for a deleted file, reports count
- **Location:** `packages/mcp-server/src/tools/all-tools.ts`

### ✅ `yats watch` CLI + live sync — added 2026-08-01
- **New:** `yats watch <path>` — host-side file watcher (zero deps, `fs.watch` + HTTP POSTs). Detects file changes, calls `/index/file` for modifications and `/index/remove` for deletions. Debounced 500ms.
- **New:** `/index/remove` HTTP endpoint on MCP server.
- **Updated:** `index_repository` MCP tool now suggests `yats watch` after indexing completes, with agent instructions for interactive vs autonomous mode.
- **Location:** `packages/yats-toolkit/src/watch.js`, `packages/mcp-server/src/server.ts`

### ✅ Test fixtures + integration tests — added 2026-08-01
- **Fixtures:** `test/fixtures/{typescript,go,python,php,csharp}/` — 6 realistic code files with classes, methods, interfaces, relationships
- **Tests (36 new):**
  - 19 analyzer integration tests (5 languages: symbol + relationship extraction)
  - 5 incremental indexing tests with git (add/modify/delete detection + indexSince)
  - 8 MCP JSON-RPC protocol tests (initialize, tools/list, tools/call, errors)
  - 4 MCP validation tests (system paths, traversal, valid paths)
- **Total test count:** 131 → 167 (16 test files)

### ✅ Documentation + website — 2026-08-01
- `AI/glossary.md` — Roslyn entry fixed
- `AI/components.md` — CSharpAnalyzer + GoAnalyzer descriptions fixed, tool count updated
- `ARCHITECTURE.md` — Status header, summary table, individual tasks (C#, PHP, Python, T-043) updated
- `docs/index.html` — Full landing page (navbar, hero, benchmarks, live sync, tutorials, BYOK, pricing, footer)
- `SESSION_ANALYSIS.md` — Clean tracking of done vs pending

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

## Recently Fixed (2026-07-30/31 — subprocess bridge stdin fixes)

### ✅ All subprocess bridges now support stdin for HTTP-based indexing
- **Was:** C# (`dotnet run`), Go (`go run`), and PHP (`php`) bridges all read source files from disk via `--file <path>`. The `yats-toolkit` CLI sends file content via HTTP POST to the server, so the file path doesn't exist on disk for the server. Bridges failed silently and fell back to regex-based analysis, losing CONTAINS, CALLS, struct fields, properties, conventions, and other native parser features.
- **Fix:** All three bridges now support `--stdin` flag: when set, read source code from stdin instead of disk. Node.js wrappers pipe `content` via `proc.stdin.write()`. C# also uses `--no-build` to prevent `dotnet run` from consuming stdin during compilation. Go uses pre-compiled binary (`YATS_GO_BRIDGE` env var) for speed.
- **E2E verified:**
  - C# eShopOnWeb: 1,227 symbols, 2,045 rels (was 768/102 with fallback)
  - Go lab_hub: 2,967 symbols, 1,435 rels (was 2,134/1,062 with fallback)
  - PHP Slim: 1,066 symbols, 4,602 rels (was 0 — PhpAnalyzer not registered)

### ✅ Go bridge: relationship kinds UPPERCASE + stdin support
- **Was:** Go bridge produced lowercase relationship kinds (`"calls"`, `"contains"`, `"imports"`) that didn't match `RelationshipKind` enum values (`"CALLS"`, `"CONTAINS"`, `"IMPORTS"`).
- **Fix:** All relationship kinds now UPPERCASE. `--stdin` flag added to read source from stdin.
- **E2E verified:** lab_hub re-indexed — struct properties (836), variables (336), and CALLS relationships now properly extracted.

### ✅ PHP bridge: stdin, NullableType, metadata, registration fixes
- **Was:** Multiple issues prevented PHP from working:
  1. `PhpAnalyzer` not registered in `dev-cli` (missing import + dependency)
  2. Bridge crashed on `NullableType::toString()` — php-parser v5 incompatibility
  3. Relationship metadata serialized as array `[]` instead of object `{}`, causing Neo4j type error
  4. Classes defined after processing code, triggering autoloader before definition
  5. `composer.json` name format rejected by Composer 2.x schema validation
- **Fix:** Registered `PhpAnalyzer` in dev-cli with `@yats/analyzer-php` dependency. Added `typeToString()` helper for NullableType/UnionType/IntersectionType. Changed all `'metadata' => []` to `'metadata' => (object)[]`. Moved processing code into `processFiles()` function called at end of file. Fixed composer name to `yats/php-bridge`.
- **E2E verified:** Slim (slimphp/Slim) — 1,066 symbols, 4,602 rels (CALLS, CONTAINS, INHERITS, IMPLEMENTS).

### ✅ Benchmark: C# repos updated
- **Was:** `targets/repos.json` had `aspnetcore` (too large) and `AutoMapper`.
- **Now:** MediatR (CQRS/Mediator), eShopOnWeb (MS clean architecture reference), Carter (Minimal APIs framework).
- **Questions:** 2 per repo in `benchmark/questions/csharp/`
- **Published:** `yats-toolkit@0.1.13` with benchmark data included.

### ✅ Docker image: ghcr.io/fvinciarelli/yats:latest rebuilt
- Includes all subprocess bridge fixes, stdin support, and PhpAnalyzer registration.

---

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
| Domain (hash, id-gen, logger, enums) | 39 tests (4 files) | ✅ Adequate |
| TypeScript Analyzer | 9 tests (1 file) | ✅ Adequate for now |
| Go Analyzer | 10 tests (1 file) | ✅ Regex fallback covered |
| Python Analyzer | 10 tests (1 file) | ✅ Regex fallback covered |
| PHP Analyzer | 12 tests (1 file) | ✅ Regex fallback covered |
| C# Analyzer | 16 tests (1 file) | ✅ Bridge + regex fallback covered |
| Tree-sitter Analyzer | 9 tests (1 file) | ✅ Regex fallback covered |
| RankerService | 8 tests (1 file) | ✅ Pure logic covered |
| DeduplicatorService | 7 tests (1 file) | ✅ Pure logic covered |
| TokenBudgetService | 11 tests (1 file) | ✅ Pure logic covered |
| **SUBTOTAL (with tests)** | **167 tests (16 files)** | ✅ Fase 1+2a completa |
| IndexerService | ✅ 24 tests (2 files) | ✅ Integration + incremental git covered |
| RetrieverService | 0 tests | ❌ Integration with mock Neo4j/Qdrant |
| MCP Server | ✅ 12 tests (1 file) | ✅ JSON-RPC protocol + validation covered |
| MCP Tools (23 handlers) | ✅ 12 tests (1 file) | ✅ Protocol-level covered, individual handler mocks pending |
| Middleware (rate-limiter) | 0 tests | ❌ Error handler, rate limiter |
| Analyzer bridges (Go/Python/PHP/C#) | 0 tests | ❌ Integration tests with real subprocesses |
| Language detector | 0 tests | ❌ Extension → language mapping |
| File walker | 0 tests | ❌ Directory traversal logic |
| GlobalSymbolTable | 0 tests | ❌ Cross-file symbol resolution |
| dev-cli | 0 tests | ❌ Start/stop commands |

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
| PHP/Python analyzers | Full bridge implementations | ✅ Done (PHP: nikic/php-parser, Python: LibCST + Jedi) |
| Go analyzer | Not planned | ✅ Done (subprocess bridge) |
| File tools (read/write/edit) | In MCP tools | Removed (search-only philosophy) |
| MCP stdio bridge for Codex | Not planned | ✅ Done (see below) |
| Agent instructions (SKILL.md, AGENTS.md) | Not planned | ✅ Done in `connect/` |
| Benchmark suite | Not planned | ✅ Done in `packages/yats-toolkit/benchmark/` |
| MCP input validation | Not planned | ✅ Done — Zod schemas for 23 tools |
| Live index sync (file watcher) | Not planned | ✅ Done — `yats watch` + `/index/remove` |
| Integration test suite | T-083 planned | 🟡 Foundation done (36 tests) |

## Recently Completed

### ✅ Bridge de producción reescrito (2026-07-29)
- **Was:** `yats bridge` usaba SSE (`/mcp/sse` + `/mcp/message`) con manejo de sesiones complejo y esperaba un evento `endpoint` que el servidor no emitía. Era un proxy ciego sin transformaciones.
- **Now:** Reescrito con el código probado del benchmark (`mcp-bridge-stdio.cjs`). Usa Streamable HTTP (`POST /mcp`), sin sesiones. Auto-inyecta `repository` desde `YATS_DEFAULT_REPO` o el `cwd`. Añade `structuredContent` para compatibilidad con Gemini CLI. Maneja `initialize`, `tools/list`, `tools/call`, `shutdown`. Cola de operaciones pendientes para no cortar respuestas asíncronas. Cero dependencias.

### ✅ Benchmark: Gemini CLI integrado (2026-07-29)
- Gemini CLI 0.53.0 conectado vía MCP stdio bridge (`GEMINI_CLI_TRUST_WORKSPACE=true`)
- Añadido como 5º agente en `run.sh` y `run-agent.sh`
- `extract_tokens()` soporta `stats.input_tokens`/`output_tokens` de Gemini
- MCP tools funcionan correctamente tras añadir `structuredContent` al bridge
- Archivos de configuración en `connect/gemini/` (GEMINI.md + mcp.json)
- **Resultado parcial:** 45% ahorro (115k → 64k tokens) — limitado por rate limit de API gratuita

### ✅ Benchmark: Copilot medido correctamente (2026-07-29)
- **Descubrimiento:** Copilot CLI 1.0.75 NO reporta tokens en su JSONL (`--output-format json`). La métrica real es `totalNanoAiu` (nano AI units) del evento `session.usage_checkpoint`.
- Los "tokens" del output de texto son poco confiables. El benchmark ahora captura nanoAiu para Copilot.
- Copilot se conecta vía stdio bridge (no HTTP) — corregido en `run.sh` y `run-agent.sh`.
- Copilot verificaba doble (MCP + archivo), comportamiento documentado.

### ✅ Benchmark: clone + cd + index automático (2026-07-29)
- `run.sh` ahora pregunta directorio de trabajo (default `~/yats-bench-repos`)
- Clona el repo desde `targets/repos.json` si no existe (`git clone --depth 1`)
- Lo indexa en YATS (`yats index <dir>`) con el nombre correcto (basename del dir)
- `run-agent.sh` hace `cd` al repo antes de ejecutar el agente
- Exporta `YATS_BENCH_REPO_DIR` y `YATS_BENCH_REPO_NAME` para que el bridge inyecte el repo correcto
- El agente trabaja exactamente como si el usuario hubiera abierto el IDE en ese repo

### ✅ MCP transport unificado (2026-07-29)
- **stdio bridge:** Gemini, Copilot, Codex (proceso local, más confiable)
- **HTTP directo:** Claude, Cursor (URL `http://localhost:5555/mcp`)
- `run.sh` genera la config MCP correcta según el agente
- `run-agent.sh` convierte formatos según lo que espera cada agente

### ✅ Gemini CLI + YATS MCP stdio (anterior, 2026-07-29)
- **Gemini CLI 0.53.0** connected via MCP stdio bridge (`GEMINI_CLI_TRUST_WORKSPACE=true`)
- 16 YATS tools discovered and connected
- 3 tool calls executed: `list_repositories`, `find_symbol`, `search_code`
- Minor parameter format mismatch (Gemini→YATS) — fixed with `structuredContent` in bridge
- Config and instructions now in `connect/gemini/`

### ✅ Copilot CLI integration (2026-07-29)
- Copilot CLI 1.0.75 conecta vía MCP stdio bridge (no HTTP)
- YATS tools descubiertas y usadas correctamente (`search_code`, `find_symbol`)
- Hace doble verificación (MCP + lectura de archivo) — comportamiento documentado
- Métrica real es `nanoAiu`, no tokens del output de texto

### ✅ Agent instructions for all 5 agents
- `connect/` now covers: Claude (SKILL.md + mcp.json), Codex (AGENTS.md + config.toml), Cursor (rules.mdc + mcp.json), Copilot (instructions.md + mcp.json), Gemini (GEMINI.md + mcp.json)

### ✅ Benchmark: Codex + YATS MCP stdio (2026-07-29)
- **Result:** 73% token reduction (100k → 27k) for symbol lookup
- Codex configured with MCP stdio bridge + `multi_agent = false`
- 1 MCP `find_symbol` call replaces 5 bash commands (rg, head)
- Full report: `packages/yats-toolkit/benchmark/results/codex-mcp-stdio-benchmark.md`

### ✅ MCP Bridge adapters
- `src/bridge.js` (`yats bridge`) — MCP stdio server para producción. Auto-inyecta repo, `structuredContent`, zero deps. Usado por Copilot, Gemini, Codex, Claude Desktop.
- `adapters/mcp-bridge-stdio.cjs` — copia del benchmark, usada por `run.sh` para pruebas aisladas.
- `adapters/mcp-openai-bridge.cjs` — HTTP proxy que inyecta MCP tools como OpenAI functions.

### ✅ Agent instructions (`connect/`)
- `connect/` — pick your agent, copy two files. Covers Claude, Gemini, Copilot, Codex, Cursor.
- Each agent folder has: instructions file (behavior) + config file (connection) + README explaining both.

### ✅ Benchmark wizard: 5 agentes (2026-07-29)
- Agentes: Cursor, Claude CLI, Copilot CLI, Codex, Gemini CLI
- Auto-clone, auto-index, ejecución desde directorio del repo
- Métricas: tokens (todos) + nanoAiu (Copilot) + cost (Claude, cuando disponible)
- Captura modelo usado por cada agente
- Resultados: Codex 73%, Copilot 66% (créditos), Claude 37% + 49% cost, Gemini 45% (parcial)

### ✅ DeepSeek as LLM backend
- Bridge supports DeepSeek API via `YATS_BRIDGE_UPSTREAM_URL`
- Model name mapping (gpt-4o-mini → deepseek-chat)
- Tool calling confirmed working with DeepSeek

[← Back to README](./README.md)
