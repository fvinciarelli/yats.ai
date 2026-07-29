# Build & Run

## Prerequisites

- **Docker** + **Docker Compose** v2 (primary way to run)
- **Node.js** >= 22.0.0 (for development)
- **pnpm** >= 9.0.0 (`npm install -g pnpm@9`)
- **TypeScript** (installed locally per package, not globally)

## Quick Start (Docker — recommended)

```bash
# 1. Start everything (Neo4j, Qdrant, Ollama, YATS MCP server)
docker compose -f docker/docker-compose.yml up -d

# 2. Index a repository
curl -X POST http://localhost:5555/index -d '{"path": "/repos/my-project"}'

# 3. The MCP server is now available at:
#    Streamable HTTP: http://localhost:5555/mcp
#    SSE:            http://localhost:5555/mcp/sse
#    Health:         http://localhost:5555/health
```

## Quick Start (Development — local Node.js)

```bash
# 1. Install dependencies
pnpm install

# 2. Build all packages
pnpm build

# 3. Start infrastructure only
docker compose -f docker/docker-compose.yml up -d neo4j qdrant

# 4. Pull Ollama model (if using Ollama)
docker exec -it $(docker ps -qf name=ollama) ollama pull nomic-embed-text

# 5. Index a repository
npx yats index /path/to/your/repo

# 6. Search
npx yats search "authentication" --repo <repo-name>

# 7. Start MCP server (stdio)
npx yats serve

# 8. Start MCP server (HTTP+SSE on port 5555)
npx yats serve --http
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
pnpm --filter @yats/infra build

# Run tests for a package
pnpm --filter @yats/shared test

# Add a dependency
pnpm --filter @yats/indexing add some-package
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
| `REPOSITORIES_PATH` | `/repos` | Path to repositories root |
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error` |
| `INDEXER_CONCURRENCY` | `4` | Parallel files during indexing |
| `MAX_FILE_SIZE_MB` | `10` | Skip files larger than this |
| `YATS_PORT` | `5555` | HTTP port for MCP server |

## Docker

### Start everything (recommended)
```bash
docker compose -f docker/docker-compose.yml up -d
```

### Start with specific profiles
```bash
# With Ollama (local embeddings)
docker compose -f docker/docker-compose.yml --profile ollama up -d

# Everything including Ollama
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
# YATS health
curl http://localhost:5555/health

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
node --inspect-brk --import tsx packages/dev-cli/src/index.ts start
```

### Log levels
```bash
LOG_LEVEL=debug npx yats index /path/to/repo
LOG_LEVEL=trace npx yats search "query"
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

## Benchmark

Run AI agent benchmarks to measure token savings with YATS:

```bash
cd packages/yats-toolkit/benchmark

# Interactive wizard
./run.sh

# Or manual
bash agents/run-agent.sh codex questions/go/lab_hub/01-protocol-translation.md
```

### Codex + MCP stdio setup
```bash
# 1. Copy config to repo
cp connect/codex/config.toml .codex/config.toml

# 2. Copy AGENTS.md to repo root
cp connect/codex/AGENTS.md ./AGENTS.md

# 3. Run benchmark
codex exec --json "your question about the code"
```

### Results (2026-07-29)
- **Codex + YATS:** 73% token reduction (100k → 27k)
- 1 MCP `find_symbol` replaces 5 bash commands
- Full report: `benchmark/results/codex-mcp-stdio-benchmark.md`

[← Back to README](./README.md)
