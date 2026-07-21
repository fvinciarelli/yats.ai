# Architectural Decisions

## Decision 1: TypeScript as primary language

**Decision:** All core services (MCP server, retriever, indexer, CLI) are TypeScript.

**Rationale:**
- MCP SDK reference implementation is TypeScript
- Node.js stdio is natural for MCP transport
- Shared types between all services without serialization
- One `tsconfig.json` to rule them all

**Trade-off:** Language analyzers need subprocess bridges for .NET, PHP, Python parsers.

---

## Decision 2: Subprocess bridges for analyzers (not WASM)

**Decision:** Language analyzers that require non-JS runtimes (Roslyn for C#, PHP-Parser for PHP, LibCST for Python) run as subprocesses. The Node.js side spawns them, passes file paths via CLI args, and receives JSON on stdout.

**Rationale:**
- Roslyn, PHP-Parser, LibCST are mature, official, and well-maintained
- WASM compilation of these is immature or non-existent
- Subprocess isolation means a crash in one parser doesn't crash the indexer
- JSON is the universal interchange format

**Trade-off:** Subprocess overhead (spawn on each file analysis). Could be mitigated with long-running processes in the future.

---

## Decision 3: Two databases (Neo4j + Qdrant)

**Decision:** Use Neo4j for graph relationships and Qdrant for vector similarity search.

**Rationale:**
- Graph databases (Neo4j) are optimal for multi-hop traversal (callers, callees, inheritance chains)
- Vector databases (Qdrant) are optimal for semantic similarity search
- No single database does both well
- Both run as Docker containers locally

**Trade-off:** Two databases to maintain, coordinate, and keep in sync. The retriever bridges them.

---

## Decision 4: Symbol ID format `{repo}::{path}::{symbolPath}`

**Decision:** Every symbol has a globally unique ID composed of repository name, file path, and symbol path, separated by `::`.

**Rationale:**
- `::` is highly unlikely to appear in file paths or symbol names (unlike `/`, `.`, `#`)
- Parsable: `parseSymbolId(id)` decomposes into components
- Enables cross-repository references without ID collision
- Neo4j can index on `id` for O(1) lookups

---

## Decision 5: Content hash for change detection

**Decision:** Every symbol has a `contentHash: string` (SHA256 of `sourceSnippet`). The `SymbolDiffer` compares old vs new hashes to detect modifications.

**Rationale:**
- Deterministic, fast, collision-resistant
- Avoids expensive AST-level diffing
- Enables incremental indexing: only re-embed modified symbols
- Git's model of content-addressed storage was the inspiration

**Trade-off:** A whitespace change triggers a "modification" even if semantics are identical. Acceptable for indexing purposes.

---

## Decision 6: Token budget in the retriever, not the LLM

**Decision:** The `RetrieverService` applies token budgeting before returning results to the LLM. The LLM receives pre-trimmed context.

**Rationale:**
- LLMs should not have to decide what context to discard
- Centralized control: one token estimation algorithm, one budget policy
- The retriever knows more about the data (e.g., which symbols are more important)

---

## Decision 7: No NestJS, no Express for internal services

**Decision:** The MCP server communicates over stdio (not HTTP). The retriever and indexer are libraries/CLI commands, not HTTP services.

**Rationale:**
- MCP protocol specifies stdio transport (JSON-RPC over stdin/stdout)
- No need for HTTP overhead when everything runs on the same machine
- Docker Compose handles service orchestration, not an HTTP API gateway
- CLI is the primary human interface

**Note:** The Dockerfiles include health check endpoints via a small inline HTTP server, but this is only for container health checks, not for inter-service communication.

---

## Decision 8: pnpm workspaces over Nx/Turborepo

**Decision:** pnpm workspaces for monorepo management.

**Rationale:**
- Simpler configuration (just `pnpm-workspace.yaml`)
- `workspace:*` protocol for clean internal dependency management
- No build caching needed (TypeScript compilation is fast enough for this project size)
- pnpm is already used as the package manager

---

## Decision 9: Factory-based DI (not decorator-based)

**Decision:** All tsyringe registrations use `useFactory` callbacks, not `@injectable()` decorators.

**Rationale:**
- Decorators require `reflect-metadata` import and experimental TS flags
- Factory functions enable conditional binding (e.g., Ollama vs OpenAI based on env var)
- Explicit construction makes dependencies visible at the registration site
- Easier to debug: all wiring is in one file (`di/container.ts`)

---

## Decision 10: Regex fallback for all analyzers

**Decision:** Every analyzer has a regex-based fallback that works without the native parser subprocess.

**Rationale:**
- Users may not have PHP, Python, or .NET installed
- The fallback extracts basic symbols (classes, functions, imports) using regex patterns
- Less accurate than native parsers but better than nothing
- Enables the platform to be immediately useful with just Node.js

---

## Decision 11: Convention-based architectural detection (not manual annotation)

**Decision:** Architectural roles (Controller, Service, DTO, etc.) are detected by naming patterns and framework decorators, not by requiring developers to annotate their code.

**Rationale:**
- Works with existing codebases without modification
- Language-agnostic patterns (`*Controller`, `*Service`, `*DTO`)
- Framework-specific patterns (`@Controller()` for NestJS, `@app.get()` for FastAPI)
- Zero configuration for the end user

[← Back to README](./README.md)
