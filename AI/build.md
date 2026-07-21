# Build & Run

## Prerequisites

- **Node.js** >= 22.0.0
- **pnpm** >= 9.0.0  (`npm install -g pnpm@9`)
- **Docker** (for Neo4j, Qdrant, Ollama)
- **Docker Compose** v2
- **TypeScript** (installed locally per package, not globally)

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Build all packages
pnpm build

# 3. Run tests
node --import tsx --test packages/shared/src/utils/*.test.ts
node --import tsx --test packages/analyzers/analyzer-typescript/src/*.test.ts

# 4. Start infrastructure
docker compose -f docker/docker-compose.yml up -d neo4j qdrant

# 5. Index a repository
pnpm --filter @code-indexer/cli exec code-indexer index /path/to/your/repo

# 6. Search
pnpm --filter @code-indexer/cli exec code-indexer search "authentication" --repo <repo-name>

# 7. Start MCP server
pnpm --filter @code-indexer/cli exec code-indexer serve
```

## Build Commands

| Command | Description |
|---------|------------|
| `pnpm install` | Install all dependencies (workspace-aware) |
| `pnpm build` | Compile all packages (`tsc`) |
| `pnpm typecheck` | Type-check without emitting |
| `pnpm lint` | Run ESLint across all packages |
| `pnpm format` | Run Prettier |
| `pnpm test` | Run all tests (recursive) |
| `pnpm clean` | Remove all `dist/` directories |

## Single Package

```bash
# Build a specific package
pnpm --filter @code-indexer/infra build

# Run tests for a package
pnpm --filter @code-indexer/shared test

# Add a dependency
pnpm --filter @code-indexer/indexing add some-package
```

## Environment Variables

Copy `.env.example` to `.env` and adjust:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `NEO4J_URI` | `bolt://localhost:7687` | Neo4j connection |
| `NEO4J_USER` | `neo4j` | Neo4j username |
| `NEO4J_PASSWORD` | `password` | Neo4j password |
| `QDRANT_URL` | `http://localhost:6334` | Qdrant gRPC endpoint |
| `EMBEDDING_PROVIDER` | `ollama` | `ollama` or `openai` |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API URL |
| `OLLAMA_MODEL` | `nomic-embed-text` | Ollama model name |
| `OPENAI_API_KEY` | — | Required if `EMBEDDING_PROVIDER=openai` |
| `OPENAI_MODEL` | `text-embedding-3-small` | OpenAI model |
| `REPOSITORIES_PATH` | `~/repos` | Path to repositories root |
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error` |
| `INDEXER_CONCURRENCY` | `4` | Parallel files during indexing |
| `MAX_FILE_SIZE_MB` | `10` | Skip files larger than this |

## Docker

### Start infrastructure only
```bash
docker compose -f docker/docker-compose.yml up -d neo4j qdrant
```

### Start with Ollama (local embeddings)
```bash
docker compose -f docker/docker-compose.yml --profile ollama up -d
```

### Start everything
```bash
docker compose -f docker/docker-compose.yml --profile full up -d
```

### Development mode
```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml up -d
```

### Pull Ollama model manually
```bash
docker exec -it $(docker ps -qf name=ollama) ollama pull nomic-embed-text
```

### Verify services
```bash
# Neo4j browser: http://localhost:7474
# Neo4j bolt: bolt://localhost:7687
curl http://localhost:7474

# Qdrant health
curl http://localhost:6333/health

# Ollama tags
curl http://localhost:11434/api/tags
```

## Debugging

### Node.js inspector
For the MCP server or CLI, add `--inspect-brk`:
```bash
node --inspect-brk --import tsx packages/cli/src/index.ts serve
```

### Log levels
```bash
LOG_LEVEL=debug pnpm --filter @code-indexer/cli exec code-indexer index /path/to/repo
LOG_LEVEL=trace pnpm --filter @code-indexer/cli exec code-indexer search "query"
```

### Neo4j inspection
```cypher
// In Neo4j browser (http://localhost:7474):
MATCH (s:Symbol) RETURN s LIMIT 25;
CALL db.schema.visualization();
CALL db.labels();
```

### Qdrant inspection
```bash
curl http://localhost:6333/collections
curl http://localhost:6333/collections/code
```

## Test Patterns

Tests use Node.js native test runner:

```bash
# Run a single test file
node --import tsx --test packages/shared/src/utils/hash.test.ts

# Run all tests in a directory
node --import tsx --test packages/shared/src/utils/*.test.ts

# Run with debug output
node --inspect --import tsx --test packages/shared/src/utils/*.test.ts
```

## CI/CD

Not configured yet. Recommended approach:
1. `pnpm install --frozen-lockfile`
2. `pnpm build`
3. `pnpm typecheck`
4. `node --import tsx --test packages/**/src/**/*.test.ts`
5. Build Docker images: `docker build -f docker/mcp-server/Dockerfile .`

[← Back to README](./README.md)
