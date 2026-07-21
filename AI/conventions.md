# Conventions

## TypeScript

### Strict Mode

`tsconfig.base.json` enables all strict checks:
- `strict: true`
- `noUncheckedIndexedAccess: true`
- `noImplicitOverride: true`
- `esModuleInterop: true`
- `module: Node16`, `moduleResolution: Node16`

### Module System

- **ESM only** (`"type": "module"` in every `package.json`)
- **Imports always use `.js` extension** (Node.js ESM resolution)
- **No `import type` forgotten** — all type-only imports use `import type { ... }`

### Barrel Exports

Every package has `src/index.ts` that re-exports all public symbols. Packages reference each other via the package name (`@code-indexer/shared`), not relative paths.

### Naming

| Element | Convention | Example |
|---------|-----------|---------|
| Interfaces | PascalCase, no `I` prefix | `GraphRepository`, `EmbeddingGenerator` |
| Classes | PascalCase | `Neo4jGraphRepository`, `RetrieverService` |
| Enums | PascalCase, singular | `SymbolKind`, `RelationshipKind` |
| Enum members | UPPER_SNAKE_CASE or lowercase | `INHERITS`, `"controller"` |
| Functions | camelCase | `createSymbolId`, `hashContent` |
| Variables | camelCase | `symbolStore`, `queryVector` |
| Files | kebab-case | `neo4j-connection.ts`, `language-detector.ts` |
| Packages | kebab-case, `@code-indexer/*` | `@code-indexer/analyzer-typescript` |
| Injection tokens | UPPER_SNAKE_CASE | `GRAPH_REPOSITORY`, `NEO4J_CONNECTION` |

### Async

- **All I/O is async** (`Promise<T>`)
- **No sync file reads** in production code (only `execSync` in `SimpleGitAdapter`)
- **No callbacks** — `async/await` exclusively
- **`Promise.allSettled`** for parallel file processing (failures don't crash the batch)

### Error Handling

- **No try/catch that swallows** — errors are logged and re-thrown or returned in result objects
- **`AnalysisResult.errors`** for non-fatal analyzer errors
- **MCP tools wrap handlers** with `withErrorHandler` middleware → JSON-RPC error response
- **Indexer catches per-file** — one broken file doesn't stop the entire index

### Validation

- **Value objects** (`SymbolId`, `RepositoryName`) validate in factory functions
- **No runtime validation** on plain interfaces (TypeScript types are compile-time only)
- **No schema library** used yet (zod is in MCP server dependencies but unused)

### Logging

- **Custom `createLogger(name)`** in `@code-indexer/shared`
- **Structured JSON output** — each log line is a JSON object with `level`, `name`, `time`, `msg`
- **No external logger** (pino was planned but not implemented — the custom logger is ~80 lines)
- **Log levels:** `trace`, `debug`, `info`, `warn`, `error`
- **Configured via** `LOG_LEVEL` env var (default: `info`)

### Dependency Injection

- **Library:** tsyringe
- **Registration:** Factory functions (not decorators)
- **Tokens:** `Symbol.for("TokenName")` in `packages/infra/src/di/tokens.ts`
- **Lifecycle:**
  - `registerSingleton()` for `Neo4jConnection`, `QdrantConnection`, `SimpleGitAdapter`
  - `register()` with `useFactory` for everything else
- **Conditional binding:** `EMBEDDING_PROVIDER=ollama|openai` switches the `EmbeddingGenerator` implementation

### Testing

- **Runner:** Node.js native test runner (`node --import tsx --test`)
- **Assertions:** `node:assert/strict`
- **Test files:** Co-located with source (`foo.test.ts` next to `foo.ts`)
- **Naming:** `describe` + `it` blocks
- **No mocking library** — mocks are hand-rolled
- **Tests exist for:** `hashContent`, `createSymbolId`/`parseSymbolId`, `createRepositoryName`, `TypeScriptAnalyzer`

### File Organization

- **Domain:** One file per concept (`enums.ts`, `models.ts`, `value-objects.ts`)
- **Ports:** One file per interface (`graph-repository.interface.ts`)
- **Services:** One class per file (`ranker.service.ts`)
- **DTOs:** One file per concern (`search-query.dto.ts`)
- **No index files for subdirectories** (only top-level barrel per package)

### Monorepo

- **Workspace manager:** pnpm 9
- **Workspace config:** `pnpm-workspace.yaml`
- **Shared TS config:** `tsconfig.base.json` extended by all packages
- **Build:** `pnpm -r run build` (recursive tsc)
- **Dependencies:** `workspace:*` protocol for internal packages

### Docker

- **Base image:** `node:22-alpine`
- **Multi-stage builds** for MCP server (build → prune → run)
- **No root user** — `USER codeindexer`
- **Health checks** via `wget` on `/health` endpoint

[← Back to README](./README.md)
