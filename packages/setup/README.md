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
Your code → Analyzer → Knowledge graph → MCP Server → AI agent queries
```

1. **Index** your repos — during setup, via CLI, or just ask your AI agent
2. **Configure** your AI agent with the MCP endpoint
3. **Ask** questions about your code — YATS answers instantly

## Quick Start

```bash
# One command
npx yats-toolkit

# The wizard will:
# 1. Pull the YATS Docker image
# 2. Start the YATS MCP server
# 3. Optionally pre-index directories you select
# 4. Configure everything automatically
```

### Adding repositories

You can add repos in three ways:

**During setup** — the wizard asks if you want to pre-index any directories.

**From the terminal:**
```bash
yats index ~/work/backend
yats index ~/work/frontend
```

**From your AI agent** — just ask it to index a repo:
```
"index /home/user/my-project"
```
The agent will use the `index_repository` MCP tool, which tells it to run `yats index` and then polls until complete.

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

See the [GitHub repository](https://github.com/fvinciarelli/yats) for the full architecture and source code.

## CLI Reference

```bash
yats setup
```
Runs the one-time setup wizard. Detects if YATS is already running, asks for embedding provider (Ollama/OpenAI/Mistral/Voyage), API keys if needed, batch size, docs indexing preference, optional pre-index directories, and MCP port. Generates `~/.yats/docker-compose.yml` and starts all services.

```bash
yats index <path> [--skip-docs]
```
Indexes a repository. Walks the directory locally and sends each file to the YATS server. Use `--skip-docs` to skip documentation files for faster indexing (~30s saved per 200 .md files with cloud embeddings).

```bash
yats status
```
Checks which repositories are indexed and shows a summary (symbol count, relationship count).

```bash
yats stop
```
Stops all YATS Docker services without removing data.

```bash
yats bridge
```
Starts an MCP stdio ↔ HTTP proxy. Useful for AI agents that only support stdio transport (Copilot, Claude Desktop). Connects to the YATS server at `localhost:5555` by default.

```bash
yats benchmark
```
Runs an interactive AI agent benchmark. Compares token usage answering the same
codebase questions with and without YATS. Supports Claude CLI and Codex.
Automatically clones test repos, indexes them, and saves results with averages.

## License

MIT © Franco Vinciarelli
