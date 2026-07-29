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

---

## Decision 12: Single user-facing package (yats-toolkit) with zero npm dependencies

**Decision:** All user-facing commands live in one npm package (`yats-toolkit`). All commands are thin HTTP clients that call the YATS MCP server — no direct database access. The package has zero npm dependencies (Node.js built-ins only).

**Rationale:**
- Users install one thing: `npx yats-toolkit` or `npm i -g yats-toolkit`
- Zero dependencies means zero supply-chain risk, instant installs, no version conflicts
- Thin HTTP clients mean the toolkit works with any YATS server (local Docker, remote, etc.)
- The dev CLI (`@yats/dev-cli`) is separate, private, and has full workspace dependencies — it's for local development only
- Eliminated the confusion between `packages/setup`, `packages/cli`, and `packages/bridge`

**Trade-off:** Adding new functionality requires either an MCP tool on the server side (for toolkit to call) or implementing it in the toolkit directly with HTTP. Acceptable since HTTP is universal and zero-deps is a hard constraint.

## Decision 10: MCP stdio bridge for Codex (2026-07-29)

**Decision:** Codex connects to YATS via a stdio MCP bridge, not HTTP/SSE. The bridge is a thin Node.js script spawned as a subprocess by Codex.

**Rationale:**
- Codex 0.145.0 has a documented bug in its SSE MCP transport (`RunningService dropped` after 5s, documented in `benchmark/results/codex-mcp-bug.md`).
- stdio transport has no session timeout — the connection is persistent as long as the subprocess runs.
- Codex's subagent architecture (`spawn_agent`) doesn't inherit MCP tools. Setting `multi_agent = false` in `config.toml` forces direct MCP usage in the main thread.
- The bridge wraps YATS HTTP MCP, presenting it as stdio MCP. It handles `initialize`, `tools/list`, and `tools/call` (forwarding to YATS).
- Result: 73% token reduction vs file reading (100k → 27k).

**Trade-off:** stdio requires the bridge to be available as a local Node.js script. Users must configure the absolute path in `.codex/config.toml`. Acceptable since the bridge is zero-deps and ships with the toolkit.

## Decision 11: Agent instructions as reusable docs (2026-07-29)

**Decision:** Orientation files (SKILL.md, AGENTS.md, .cursorrules) live in `connect/<agent>/` as templates users copy to their repos. Each agent folder has a README explaining what each file does and where to place it.

**Trade-off:** Users must manually copy files. The `yats setup` wizard handles this automatically.

[← Back to README](./README.md)
