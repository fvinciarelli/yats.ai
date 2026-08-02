# Cut your AI coding costs by more than 50%

**YATS** — Yet Another Token Saver — indexes your codebase into a knowledge graph. Your agent queries the graph instead of reading files one by one. Less tokens, better answers.

[![npm version](https://img.shields.io/npm/v/yats-toolkit)](https://www.npmjs.com/package/yats-toolkit)

---

## Your agent is slow. It's not its fault.

Every time your agent needs to understand your code, it does the same brute-force ritual: grep for keywords, read file after file, guess how things connect. That's not intelligence — that's a token bonfire. And you're paying for every spark.

```
100,000 tokens to answer "how does auth work here?"
15 files read
Zero understanding of relationships
```

### YATS gives your agent a map, not a pile of paper

We index your entire codebase into a **knowledge graph**: every function, class, interface, and relationship across TypeScript, C#, Python, PHP, and Go. When your agent needs answers, it queries the graph — not the raw files.

**The best part: you don't index manually.** When your agent connects to YATS and starts working in a directory, it checks if that project is indexed. If not, it indexes it *automatically*. No extra step. No remembering to run a command.

```
Agent enters your project
  → "Is this indexed?" → No
  → Indexes it automatically
  → Done. Every query now hits the graph.

3,000 tokens. Two tool calls. Exactly right.
```

> You *can* index manually via `yats index ~/my-project` if you want. But your agent handles it.

---

## Your codebase, understood

Not grep. Not regex. Actual parsers that understand your code like an IDE does.

```
TypeScript → Compiler API (full AST)
C#         → Roslyn (.NET 8 bridge)
Python     → LibCST + Jedi
PHP        → nikic/php-parser
Go         → Native bridge
Everything → Tree-sitter fallback
```

Rust, Java, Kotlin, Ruby — more to come.

---

## Quick Start

```bash
npx yats-toolkit
```

Or install globally:

```bash
npm install -g yats-toolkit
yats
```

The wizard asks which embedding provider to use (Ollama local + free, or OpenAI/Mistral/Voyage), which directories to pre-index, and writes the MCP config automatically.

**That's it. No other dependencies.** YATS pulls a Docker image with Neo4j, Qdrant, and the MCP server — everything runs in containers. No Python, no Java, no .NET SDK to install. Just Docker.

→ **[Website & full docs](https://fvinciarelli.github.io/yats.ai/)**

```bash
# CLI reference
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
yats watch <path>                 # Auto-reindex on file changes
```

---

## Your agent, supercharged

Instead of reading 15 files, your agent calls:

| What the agent needs | Tool it calls |
|---|---|
| "How does auth work?" | `search_code("authentication flow")` |
| "Who calls this?" | `find_callers("PaymentService.process")` |
| "Show me the API" | `find_routes` |
| "Architecture overview?" | `architecture_summary` |
| "Where are the tests?" | `find_tests("UserService")` |
| "What's connected?" | `expand_graph(symbolId)` |

### All 22 tools

| Category | Tools |
|---|---|
| **Search** | `search_code`, `search_documentation`, `search_similar` |
| **Navigation** | `find_symbol`, `find_references`, `find_callers`, `find_callees` |
| **Inheritance** | `find_implementations`, `find_inheritors` |
| **Graph** | `expand_graph`, `related_symbols` |
| **Discovery** | `list_symbols`, `find_routes`, `find_configuration`, `find_tests` |
| **Repository** | `list_repositories`, `index_repository`, `delete_repository` |
| **Analysis** | `repository_summary`, `architecture_summary` |
| **Live sync** | `index_file`, `remove_file`, `reindex` |

---

## The right instructions make the difference

YATS saves you **even more tokens** when your agent is properly instructed to use the graph instead of reading files. Copy two files into your repo — each agent gets custom instructions that teach it to call `search_code` before `grep`, to expand the graph instead of guessing relationships.

👉 **[`connect/`](./connect/)** — pick your agent, copy two files, done.

| Agent | Copy these | Into |
|---|---|---|
| **Claude Code** | `SKILL.md` + `mcp.json` | [`.claude/skills/yats/` + `.mcp.json`](./connect/claude/) |
| **Gemini CLI** | `GEMINI.md` + `mcp.json` | [repo root + `.gemini/settings.json`](./connect/gemini/) |
| **Copilot CLI** | `instructions.md` + `mcp.json` | [`.github/` + `.copilot/`](./connect/copilot/) |
| **Codex CLI** | `AGENTS.md` + `config.toml` | [repo root + `.codex/`](./connect/codex/) |
| **Cursor** | `rules.mdc` + `mcp.json` | [`.cursor/rules/` + `.cursor/`](./connect/cursor/) |

That's it. Ask your agent: *"How does authentication work in this project?"* and YATS answers from the knowledge graph.

---

## Don't trust us. Reproduce it yourself.

Every benchmark we publish comes with the **full tooling to replicate it** — same questions, same repos, same methodology. No cherry-picking. No black boxes.

**And it works on your own code too.** Unlike benchmarks that only test popular open-source repos (which LLMs might already know from training), YATS lets you measure savings on *your* private projects.

```bash
yats benchmark

1. Pick your agent — Cursor, Claude, Copilot, Codex, or Gemini
2. Pick a language and repo — or point it at your own project
3. The wizard indexes it automatically
4. Your agent answers the same questions twice — with and without YATS
5. You get a side-by-side comparison: tokens, credits, cost
```

### Our results (that you can verify)

Same questions. Same repos. Fresh sessions. Every token counted.

| Agent | Repo indexed | Language | Without YATS | With YATS | You save |
|---|---|---|---|---|---|
| Codex | lab_hub (API backend) | Go | 100,000 tokens | 27,000 tokens | **73%** |
| Copilot | lab_hub (API backend) | Go | 1.19 credits | 0.40 credits | **66%** |
| Claude | lab_hub (API backend) | Go | 862k tokens · $0.21 | 541k tokens · $0.11 | **37%** tokens · **49%** cost |
| Gemini | Django (web framework) | Python | 115,122 tokens | 63,851 tokens | **45%** |

Run `yats benchmark` and get your own row in this table.

→ [Full benchmark suite and raw data](./packages/yats-toolkit/benchmark/)

---

## Stays in sync while you work

YATS doesn't just index once and go stale. When you or your agent edits a file, the index updates in seconds.

| | |
|---|---|
| 🔄 **Auto-reindex on query** | Every search checks if your repo changed since the last index. If git shows new commits, YATS incrementally re-indexes only what changed — before answering. |
| 📝 **Index a single file** | Call `index_file` and only that file gets re-analyzed, embedded, and stored. Under a second. |
| 🗑 **Remove on delete** | Call `remove_file` and its symbols disappear from the graph instantly. No dead references. |
| 👀 **Live watcher** | `yats watch ~/my-project` — every file change triggers an automatic re-index. |

---

## Your keys, or none at all

Indexing generates embeddings. You choose who runs that computation.

| | |
|---|---|
| 🆓 **Ollama — zero cost** | Runs locally on your machine. No API keys, no network calls, no bills. The `nomic-embed-text` model is pulled automatically. Indexing costs you nothing — ever. |
| 🔑 **Bring your own key** | Prefer a hosted model? Plug in your OpenAI, Mistral, or Voyage AI key. You pay your provider directly — YATS adds zero markup. |

Switch anytime with `EMBEDDING_PROVIDER`. Ollama for free local dev, OpenAI for production throughput. No lock-in.

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

## Fair pricing, based on your team size

Same product. Same features. No support or SLA at any tier. Just an annual flat fee.

| Developers | Annual license | |
|---|---|---|
| < 25 | **Free** | [Get started](https://www.npmjs.com/package/yats-toolkit) |
| 25 – 74 | €150/year | [Buy license](https://buy.stripe.com/test_00w14m1SV52v1cmaTJ1Nu00) |
| 75 – 199 | €350/year | [Buy license](https://buy.stripe.com/test_14A14mcxz8eH4oy7Hx1Nu01) |
| 200 – 499 | €600/year | [Buy license](https://buy.stripe.com/test_3cIdR8aprbqT7AK9PF1Nu02) |
| 500+ | [Contact us](mailto:vinciarellifranco@gmail.com) | |

Annual subscription with auto-renewal. Cancel anytime. · [Full license terms](LICENSE)

---

## Requirements

- **Docker** with Compose plugin
- ~2GB disk (or ~3GB with Ollama local embeddings)
- Internet connection for first pull (fully local after that with Ollama)

---

## Links

- **npm:** [yats-toolkit](https://www.npmjs.com/package/yats-toolkit)
- **Website:** [fvinciarelli.github.io/yats.ai](https://fvinciarelli.github.io/yats.ai/)
- **License:** [LICENSE](LICENSE)
- **Contact:** [vinciarellifranco@gmail.com](mailto:vinciarellifranco@gmail.com)
