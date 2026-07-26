# YATS Toolkit

**Give your AI agent superpowers over your codebase.**

YATS indexes your repositories into a knowledge graph so AI coding agents (Claude, Cursor, Copilot) can search, navigate, and understand your code — without burning thousands of tokens reading files one by one.

```bash
npx yats-toolkit
```

## What it does

| | Without YATS | With YATS |
|---|---|---|
| Find implementations of an interface | Agent reads dozens of files | `find_implementations("PaymentGateway")` → instant |
| Trace call chains | Manual grep, guesswork | `find_callers` → `find_callees` → complete graph |
| Understand architecture | Read README, hope it's updated | `architecture_summary` → services, controllers, DTOs |
| Search code semantically | Text grep only | `search_code("JWT token validation")` → vector + graph results |

## How it works

```
Your code → Analyzer (AST) → Symbols + Relationships
                                  ↓
                     Neo4j (knowledge graph) + Qdrant (vectors)
                                  ↓
                     MCP Server → AI agent queries, not reads
```

1. **Index** your repos (`yats index ~/my-project`)
2. **Configure** your AI agent with the MCP endpoint
3. **Ask** questions about your code — YATS answers in < 50ms

## Quick Start

```bash
# One command
npx yats-toolkit

# The wizard will:
# 1. Pull the YATS Docker image from ghcr.io
# 2. Start Neo4j + Qdrant + YATS MCP server
# 3. Configure everything automatically
```

After setup, add repos:
```bash
yats index ~/work/backend
yats index ~/work/frontend
```

## MCP Configuration

Add this to your AI agent's MCP config:

```json
{
  "mcpServers": {
    "yats": {
      "url": "http://localhost:5555/mcp"
    }
  }
}
```

| Agent | Config location |
|---|---|
| Cursor | `.cursor/mcp.json` |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| VS Code Copilot | `.vscode/mcp.json` |
| Continue.dev | `~/.continue/config.json` |
| Zed | `.zed/mcp.json` |

## Available Tools (20)

| Category | Tools |
|---|---|
| Search | `search_code`, `search_documentation`, `search_similar` |
| Navigation | `find_symbol`, `find_references`, `find_callers`, `find_callees` |
| Inheritance | `find_implementations`, `find_inheritors` |
| Graph | `expand_graph`, `related_symbols` |
| Discovery | `list_symbols`, `find_routes`, `find_configuration`, `find_tests` |
| Repository | `list_repositories`, `index_repository`, `delete_repository` |
| Analysis | `repository_summary`, `architecture_summary` |

## Commands

```bash
yats setup           # Run the setup wizard
yats index <path>    # Index a repository
yats status          # Check what's indexed
yats stop            # Stop all YATS services
yats bridge          # MCP stdio ↔ HTTP proxy (for CLI-only agents)
```

## Requirements

- **Docker** with Compose plugin
- ~2GB free disk space
- Internet connection (first pull only, then runs fully local with Ollama)

## Languages Supported

TypeScript, JavaScript, Python, Go, C#, PHP — plus universal fallback via Tree-sitter.

## Architecture

Built on a layered monorepo (pnpm workspaces):

```
packages/
├── shared/          Domain models, ports, DTOs
├── infra/           Neo4j, Qdrant, embeddings (OpenAI, Ollama, Mistral, Voyage)
├── indexing/        Pipeline: walk → analyze → embed → store
├── retrieval/       Hybrid: vector + graph → rank → dedup → compress
├── mcp-server/      20 MCP tools over stdio, HTTP+SSE, Streamable HTTP
├── cli/             CLI: index, search, serve, clear
├── setup/           One-command installer (this package)
└── analyzers/       Per-language AST analyzers (TS, Python, Go, C#, PHP, Tree-sitter)
```

## License

MIT © Franco Vinciarelli
