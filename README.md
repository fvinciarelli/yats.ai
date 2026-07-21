# YATS — Yet Another Token Saver

> Index your code. Talk to your AI. Save tokens.

YATS builds a knowledge graph of your codebase and exposes it as MCP tools. Your AI agent gets precise, relevant context without you pasting files or writing prompts.

## How it works

```
You ask your AI:  "how does auth work in this project?"
                        │
                        ▼
               AI agent calls YATS MCP tools
                        │
                        ▼
               YATS searches the knowledge graph
               (Neo4j + Qdrant → precise results)
                        │
                        ▼
               AI agent responds with accurate,
               context-aware answers
```

- **Auto-indexes** your code on first search (no manual setup)
- **Incremental updates** — only re-indexes what changed
- **24 MCP tools** — search, find references, callers, routes, architecture, and more
- **Runs locally** — your code never leaves your machine

## Quick Start

```bash
# One command
npx yats-setup
```

That's it. The wizard will ask you a couple of questions, start Docker services, and give you the config to paste into your AI agent.

### Requirements

- **Docker** (with compose plugin)

That's the only dependency.

### AI Agent Configuration

Add this to your agent's MCP config:

```json
{
  "mcpServers": {
    "yats": {
      "url": "http://localhost:3000/mcp/sse"
    }
  }
}
```

| Agent | Where to configure |
|---|---|
| **Claude Desktop** | Settings → Developer → MCP Servers → Edit Config |
| **Cursor** | Settings → MCP → Add new MCP server |
| **Zed** | `~/.zed/settings.json` → `{"mcp": {"yats": {...}}}` |
| **Continue.dev** | `~/.continue/config.json` → `"mcpServers": {...}` |

## Embedding Providers

| Provider | Setup | Privacy | Speed |
|---|---|---|---|
| **Ollama** (default) | Runs locally in Docker | ✅ Your code stays on your machine | Good |
| **OpenAI** | Needs API key | ⚠️ Code sent to OpenAI | Fast |
| **Mistral** | Needs API key | ⚠️ Code sent to Mistral | Fast |
| **Voyage AI** | Needs API key | ⚠️ Code sent to Voyage | Fast |

Choose during setup. Ollama requires no API key and keeps everything local.

## MCP Tools

### Code Search & Discovery

| Tool | Description |
|---|---|
| `search_code` | Semantic search across your entire codebase |
| `search_documentation` | Search READMEs, architecture docs, ADRs |
| `find_symbol` | Find a specific symbol by name |
| `search_similar` | Find code similar to a given symbol |

### Graph Traversal

| Tool | Description |
|---|---|
| `find_references` | Everywhere a symbol is referenced |
| `find_callers` | Who calls this function? |
| `find_callees` | What does this function call? |
| `find_implementations` | All implementations of an interface |
| `find_inheritors` | All subclasses of a class |
| `related_symbols` | Directly related symbols (1-hop) |
| `expand_graph` | Multi-hop graph exploration |
| `find_tests` | Tests for a symbol |

### Architecture & Structure

| Tool | Description |
|---|---|
| `find_routes` | HTTP endpoints / API routes |
| `find_configuration` | Config keys, env vars, settings |
| `list_symbols` | List symbols filtered by kind |
| `repository_summary` | Symbol counts by kind and language |
| `architecture_summary` | Controllers, services, entities overview |

### File Operations

| Tool | Description |
|---|---|
| `read_file` | Read files from the repository |
| `write_file` | Write content to a file |
| `update_file` | Precise text replacements |
| `delete_file` | Delete a file |
| `create_file` | Create a new file |

### Repository Management

| Tool | Description |
|---|---|
| `list_repositories` | List all indexed repos |
| `index_repository` | Manually trigger indexing |

## Supported Languages

| Language | Analyzer | Status |
|---|---|---|
| TypeScript / JavaScript | TS Compiler API | ✅ Full support |
| PHP | PHP-Parser bridge | ✅ Full support |
| Python | LibCST + Jedi bridge | ✅ Full support |
| C# | Roslyn bridge | 🚧 Coming soon |
| All | Tree-sitter fallback | ✅ Basic support |

## Architecture

```
┌─────────────┐     MCP (HTTP+SSE)     ┌──────────────────────┐
│  AI Agent   │ ◄───────────────────► │  YATS Server (:3000) │
└─────────────┘                        │  ┌────────────────┐  │
                                       │  │ Neo4j (graph)  │  │
                                       │  │ Qdrant (vectors)│  │
                                       │  │ Ollama/OpenAI  │  │
                                       │  └────────────────┘  │
                                       └──────────────────────┘
```

YATS uses two databases for different purposes:
- **Neo4j** — graph relationships (traversal, callers, inheritance)
- **Qdrant** — vector similarity search (semantic code search)

## Development

```bash
# Clone
git clone https://github.com/fvinciarelli/yats
cd yats

# Install & build
pnpm install
pnpm build

# Start infrastructure
docker compose -f docker/docker-compose.yml up -d neo4j qdrant

# Run MCP server (stdio)
pnpm --filter @yats/cli exec yats serve

# Run MCP server (HTTP+SSE)
pnpm --filter @yats/cli exec yats serve --http --port 3000

# Index a repo
pnpm --filter @yats/cli exec yats index /path/to/repo

# Search
pnpm --filter @yats/cli exec yats search "authentication" --repo my-repo

# Run tests
pnpm test
```

### Project structure

```
yats/
├── packages/
│   ├── shared/          Domain models, interfaces, DTOs
│   ├── infra/           Neo4j, Qdrant, embeddings, DI
│   ├── indexing/        Indexing pipeline
│   ├── retrieval/       Hybrid search pipeline
│   ├── mcp-server/      MCP JSON-RPC server (stdio + HTTP)
│   ├── cli/             CLI interface
│   ├── setup/           Thin client wizard (yats-setup)
│   └── analyzers/       Language analyzers
│       ├── analyzer-interface/
│       ├── analyzer-typescript/
│       ├── analyzer-php/
│       ├── analyzer-python/
│       ├── analyzer-csharp/
│       └── analyzer-treesitter/
├── docker/              Dockerfiles & compose
└── AI/                  Architecture docs
```

## License

Business Source License 1.1 — free for individuals and small teams. Companies with 5+ employees need a commercial license. See [LICENSE](LICENSE) for details.

## Links

- **Website:** [yats.site](https://yats.site)
- **GitHub:** [fvinciarelli/yats](https://github.com/fvinciarelli/yats)
- **npm:** `yats-setup`
