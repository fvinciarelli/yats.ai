# YATS — Yet Another Token Saver

> **Cut your AI coding costs by 37%.** YATS indexes your codebase into a knowledge graph so AI agents find answers in milliseconds instead of reading dozens of files.

[![npm version](https://img.shields.io/npm/v/yats-toolkit)](https://www.npmjs.com/package/yats-toolkit)

---

## How it works

```
Your code → Analyzers parse it → Neo4j graph + Qdrant vectors → MCP tools → Your AI agent queries instantly
```

1. **`npx yats-toolkit`** — one command. Pulls Docker, starts Neo4j + Qdrant + MCP server.
2. **`yats index ~/my-project`** — parses your code, builds a knowledge graph with every function, class, interface, call, and relationship.
3. **Ask your agent about your code.** It queries YATS instead of reading files one by one.

---

## What your agent can do

Instead of reading 20 files to find how middleware works, your agent calls:

```
search_code("middleware registration order")
find_symbol("MiddlewareManager")
find_callers("MiddlewareManager.process")
find_implementations("MiddlewareInterface")
```

| Agent action | Without YATS | With YATS |
|---|---|---|
| "How does auth work?" | Greps for "auth", reads 15 files, guesses | `search_code` → 3 results → `find_callers` → done in 2 turns |
| "Who calls `PaymentService`?" | Greps, misses indirect calls | `find_callers` → all callers including transitive |
| "Show me all API routes" | Reads controllers one by one | `find_routes` → all routes in one call |
| "Architecture overview" | Reads README, main files, hopes it's current | `architecture_summary` → services, controllers, DTOs, relationships |
| "Find tests for `UserService`" | Guesses file names, greps | `find_tests` → exact matches |

---

## Quick Start

```bash
npx yats-toolkit
```

The wizard asks which embedding provider to use (Ollama local + free, or OpenAI/Mistral/Voyage), which directories to pre-index, and writes the MCP config automatically.

**Then configure your AI agent:**

```json
{
  "mcpServers": {
    "yats": { "url": "http://localhost:5555/mcp" }
  }
}
```

| Agent | Config file |
|---|---|
| Cursor | `.cursor/mcp.json` |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| VS Code Copilot | `.vscode/mcp.json` |
| Continue.dev | `~/.continue/config.json` |
| Zed | `.zed/mcp.json` |
| Codex | `~/.codex/config.toml` |

That's it. Ask your agent: *"How does authentication work in this project?"* and YATS answers from the knowledge graph.

---

## MCP Tools (20)

| Category | Tools |
|---|---|
| **Search** | `search_code`, `search_documentation`, `search_similar` |
| **Navigation** | `find_symbol`, `find_references`, `find_callers`, `find_callees` |
| **Inheritance** | `find_implementations`, `find_inheritors` |
| **Graph** | `expand_graph`, `related_symbols` |
| **Discovery** | `list_symbols`, `find_routes`, `find_configuration`, `find_tests` |
| **Repository** | `list_repositories`, `index_repository`, `delete_repository` |
| **Analysis** | `repository_summary`, `architecture_summary` |

---

## CLI Reference

```bash
yats setup                        # One-time setup wizard
yats index <path> [--skip-docs]  # Index a repository
yats search <query>               # Search indexed code
yats list                         # List indexed repositories
yats summary <repo>               # Show symbol/relationship counts
yats clear <repo>                 # Delete indexed data (needs confirmation)
yats status                       # Check what's indexed and running
yats stop                         # Stop all services
yats bridge                       # MCP stdio ↔ HTTP proxy (for CLI-only agents)
yats benchmark                    # AI agent token comparison
```

---

## Languages

TypeScript, JavaScript, Python, Go, C#, PHP — plus universal fallback via Tree-sitter.

---

## Benchmarks

Run your own token savings comparison:

```bash
yats benchmark
```

Interactive wizard that:
1. Picks an AI agent (Claude CLI or Codex)
2. Picks a repo (auto-clones if needed)
3. Asks your codebase question
4. Runs it **without YATS** (agent reads files directly) and **with YATS** (agent queries the graph)
5. Shows side-by-side token, cost, file read, and bash comparison
6. Saves results to `benchmark/results/`

---

## Architecture

```
packages/
├── shared/              Domain types, interfaces, DTOs — zero external deps
├── infra/               Neo4j, Qdrant, Ollama/OpenAI adapters
├── indexing/            Walk → analyze → embed → store pipeline
├── retrieval/           Hybrid search: vector + graph + ranking
├── mcp-server/          JSON-RPC over stdio, HTTP+SSE, Streamable HTTP
├── dev-cli/             Local dev server (yats-dev start/stop)
├── yats-toolkit/        User-facing CLI — setup, index, search, benchmark
└── analyzers/           TypeScript (compiler API), Go (subprocess), C# (Roslyn), Python (libcst), PHP, Tree-sitter
```

- **Graph:** Neo4j 5 (symbols, calls, imports, inheritance — full relationship graph)
- **Vectors:** Qdrant (768d embeddings for semantic search)
- **Embeddings:** Ollama (local), OpenAI, Mistral, or Voyage AI
- **Protocol:** MCP JSON-RPC (stdio, HTTP+SSE, Streamable HTTP)
- **Deployment:** Single `docker compose up` — Neo4j + Qdrant + Ollama + YATS server

---

## Requirements

- **Docker** with Compose plugin
- ~2GB disk (or ~3GB with Ollama local embeddings)
- Internet connection for first pull (fully local after that with Ollama)

---

## License

**Free for individuals and organizations with fewer than 25 developers.** Commercial licenses grant the same rights — no support or SLA is included at any tier.

| Developers | Annual license (EUR, flat per org) |
|---|---|
| < 25 | **Free** |
| 25 – 149 | €150 |
| 150 – 499 | €400 |
| 500 – 999 | €800 |
| 1,000+ | Contact us |

[Full license](LICENSE) · vinciarellifranco@gmail.com

---

## Links

- **npm:** [yats-toolkit](https://www.npmjs.com/package/yats-toolkit)
- **GitHub:** [fvinciarelli/yats](https://github.com/fvinciarelli/yats)
