# Changelog

All notable changes to YATS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-08-13

### Added
- **Benchmark wizard v2** — interactive arrow-key UI with colors, model selection per agent, spinner + stage text during runs, and a run-again/exit menu.
- **5 benchmark agents** — Claude, Codex, Copilot, Gemini, and Cursor (CLI).
- **Custom repos** — benchmark your own repo via local path or git URL.
- **Configurable download directory** — the wizard asks where to clone repos (default `./repos`).
- **Smaller benchmark repos** — flask, express, koa, chi, slim (replacing django, nestjs, nextjs, terraform, laravel, symfony).

### Changed
- **MCP repo resolution** — the bridge now identifies repos by full absolute path (with name fallback); `~` and `./` resolve to absolute.
- **API keys auto-loaded** — the benchmark loads `.env` (cwd → repo root) so spawned agents inherit `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`.
- **README** — rewritten with hero narrative, ROI section, logo, and demo GIF.

### Fixed
- Gemini baseline run now sets `GEMINI_CLI_TRUST_WORKSPACE` in both with/without YATS.
- Benchmark surfaces agent errors (e.g. "Credit balance is too low") instead of showing 0 tokens.

## [0.1.14] - 2026-08-02

### Added
- Public release — CI pipeline with tests, Docker build, npm publish, and GitHub Releases.

## [0.1.0] - 2026-08-01

### Added
- **23 MCP tools:** `search_code`, `search_documentation`, `search_similar`, `find_symbol`, `find_references`, `find_callers`, `find_callees`, `find_implementations`, `find_inheritors`, `find_tests`, `find_routes`, `find_configuration`, `expand_graph`, `related_symbols`, `list_symbols`, `list_repositories`, `index_repository`, `delete_repository`, `repository_summary`, `architecture_summary`, `reindex`, `index_file`, `remove_file`.
- **Language analyzers:** TypeScript (compiler API), Go (subprocess bridge), C# (Roslyn bridge), Python (LibCST), PHP (nikic/php-parser), Tree-sitter fallback.
- **Neo4j graph** — symbols, calls, imports, inheritance, full relationship graph.
- **Qdrant vectors** — 768d embeddings for semantic code search.
- **Embedding providers:** Ollama (local, free), OpenAI, Mistral, Voyage AI.
- **MCP transports:** stdio, HTTP+SSE, Streamable HTTP.
- **`yats-toolkit` CLI** — setup wizard, index, search, status, bridge, benchmark.
- **Live index sync** — `yats watch <path>` watches files and auto-indexes changes.
- **Zod input validation** for all 23 MCP tools with friendly error messages.
- **Benchmark suite** comparing token savings across Claude, Gemini, Copilot, Codex, and Cursor (37%–73% savings).
- **Agent instructions** (`connect/`) for Claude, Gemini, Copilot, Codex, and Cursor.
- **Website** — landing page at `docs/index.html`.
- **167 tests** — domain logic, all analyzers, retrieval services, incremental indexing, MCP protocol, input validation.
- **Test fixtures** for TypeScript, Go, Python, PHP, and C#.
- **Docker Compose** one-command deployment (`docker compose up`).
- **Docker image** published to `ghcr.io/fvinciarelli/yats.ai`.

[Unreleased]: https://github.com/fvinciarelli/yats.ai/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/fvinciarelli/yats.ai/releases/tag/v0.3.0
[0.1.14]: https://github.com/fvinciarelli/yats.ai/releases/tag/v0.1.14
[0.1.0]: https://github.com/fvinciarelli/yats.ai/releases/tag/v0.1.0
