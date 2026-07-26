# YATS Toolkit

> Give your AI agent superpowers over your codebase.

YATS indexes your repositories into a knowledge graph so AI coding agents (Claude, Cursor, Copilot) can search, navigate, and understand your code — without burning tokens reading files one by one.

[![npm version](https://img.shields.io/npm/v/yats-toolkit)](https://www.npmjs.com/package/yats-toolkit)

## Quick Start

```bash
npx yats-toolkit
```

The wizard pulls the Docker image, starts the MCP server, and asks which directories you want to index. After setup, paste the config into your AI agent and start asking questions about your code.

## Add Repositories

Three ways:

**During setup** — the wizard offers to pre-index directories.

**From the terminal:**
```bash
yats index ~/work/backend
yats index ~/work/frontend
```

**From your AI agent** — just ask it to index a repo. The agent uses the `index_repository` MCP tool.

## AI Agent Configuration

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

## MCP Tools (20)

| Category | Tools |
|---|---|
| Search | `search_code`, `search_documentation`, `search_similar` |
| Navigation | `find_symbol`, `find_references`, `find_callers`, `find_callees` |
| Inheritance | `find_implementations`, `find_inheritors` |
| Graph | `expand_graph`, `related_symbols` |
| Discovery | `list_symbols`, `find_routes`, `find_configuration`, `find_tests` |
| Repository | `list_repositories`, `index_repository`, `delete_repository` |
| Analysis | `repository_summary`, `architecture_summary` |

## CLI Reference

```bash
yats setup                        # One-time setup wizard
yats index <path> [--skip-docs]  # Index a repository
yats status                       # Check indexed repos
yats stop                         # Stop services
yats bridge                       # Stdio proxy for Copilot/Claude
```

## Requirements

- **Docker** with Compose plugin
- Internet connection (first pull only, then fully local with Ollama)

## Languages

TypeScript, JavaScript, Python, Go, C#, PHP — plus universal fallback via Tree-sitter.

## Architecture

See the [GitHub repository](https://github.com/fvinciarelli/yats) for full architecture and source code.

## License

Free for individuals and organizations with fewer than 10 developers.
Companies with 50+ developers need a commercial license — [see tiers](LICENSE).

## Links

- **npm:** [yats-toolkit](https://www.npmjs.com/package/yats-toolkit)
- **GitHub:** [fvinciarelli/yats](https://github.com/fvinciarelli/yats)
