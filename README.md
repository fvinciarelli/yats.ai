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

---

## Connect your AI agent

👉 **Go to [`connect/`](./connect/)** — pick your agent, copy two files into your repo, done.

| Agent | Transport | Files to copy |
|-------|-----------|---------------|
| **Claude Code** | stdio bridge | [`SKILL.md`](./connect/claude/SKILL.md) → `.claude/skills/yats/` · [`mcp.json`](./connect/claude/mcp.json) → `.mcp.json` |
| **Gemini CLI** | stdio bridge | [`GEMINI.md`](./connect/gemini/GEMINI.md) → repo root · [`mcp.json`](./connect/gemini/mcp.json) → `.gemini/settings.json` |
| **Copilot CLI** | stdio bridge | [`instructions.md`](./connect/copilot/instructions.md) → `.github/` · [`mcp.json`](./connect/copilot/mcp.json) → `.copilot/` |
| **Codex CLI** | stdio bridge | [`AGENTS.md`](./connect/codex/AGENTS.md) → repo root · [`config.toml`](./connect/codex/config.toml) → `.codex/` |
| **Cursor** | HTTP | [`rules.mdc`](./connect/cursor/rules.mdc) → `.cursor/rules/` · [`mcp.json`](./connect/cursor/mcp.json) → `.cursor/` |

Each agent folder has a **README** explaining what each file does and exactly where to place it.

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

We measure YATS transparently. Every test is reproducible — same questions, same repos, public raw data.

### What we compare

| | Without YATS | With YATS |
|---|---|---|
| **Agent config** | Default — reads files with grep/Read | MCP connected to YATS + behavior instructions ([`connect/`](./connect/)) |
| **How the agent works** | Greps codebase, reads files one by one, guesses relationships | Calls `search_code` → `find_symbol` → `expand_graph` — answers from the knowledge graph |

Each agent answers the **same question twice**, on a **fresh session** each time. We count every token — system prompts, tool calls, sub-agents, everything.

### Why two kinds of repos

We test against **popular repos** (FastAPI, Django, NestJS) that the agent might know from training, and **non-popular repos** (lab_hub, internal projects) that force the agent to actually read and understand the code — not answer from memory.

### Results

| Agent | Repo | Model | Without YATS | With YATS | Savings |
|-------|------|-------|-------------|-----------|---------|
| Codex | lab_hub (Go) | gpt-4.1-mini | 100,000 tokens | 27,000 tokens | **73%** |
| Copilot | lab_hub (Go) | GPT-based | 1.19 credits | 0.40 credits | **66%** |
| Claude | lab_hub (Go) | claude-haiku-4-5 | 862,307 tokens | 540,917 tokens | **37%** |
| Gemini | Django (Python) | gemini-flash-latest | 115,122 tokens | 63,851 tokens | **45%** |

**Savings range: 37% – 73%.** Lower savings happen when the agent double-checks YATS results by reading files anyway (Copilot, Claude). Higher savings when the agent trusts MCP tools directly (Codex).

All results, raw agent logs, questions, and configs: [`packages/yats-toolkit/benchmark/results/`](./packages/yats-toolkit/benchmark/results/)

### Run your own

```bash
yats benchmark
```

Interactive wizard. In 5 steps:

1. **Pick your agent** — Cursor, Claude, Copilot, Codex, or Gemini
2. **Pick a language and repo** — the wizard auto-clones it from GitHub
3. **Pick a working directory** — where the agent will "see" the code (just like your IDE)
4. **YATS auto-indexes the repo** — symbols, calls, inheritance, embeddings
5. **The agent answers each question twice** — without YATS (grep + file reads) and with YATS (MCP tools). Fresh session each time.

At the end you get a table comparing tokens, credits, or AI units side by side.

**No agent installed?** Each one takes 2 minutes to set up. Pick yours:

- [Claude Code](./connect/claude/) — `npm install -g @anthropic-ai/claude-code`
- [Gemini CLI](./connect/gemini/) — `npm install -g @google/gemini-cli`
- [Copilot CLI](./connect/copilot/) — `npm install -g @github/copilot`
- [Codex CLI](./connect/codex/) — see [codex](https://github.com/openai/codex)
- [Cursor](./connect/cursor/) — `cursor-agent` from [cursor.com](https://cursor.com)

**Just want to browse results?** Raw logs, questions, and configs: [`benchmark/results/`](./packages/yats-toolkit/benchmark/results/)

You don't have to trust our numbers.

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
