# Changelog

All notable changes to YATS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Per-repo config — `.yats/config.json` (P6).** Each repository can now control
  its own indexing: `indexDocs` (false = skip all docs for this repo),
  `docExtensions` (replaces the machine's list), `docPatterns` (whitelist of doc
  files to send, prefix match), `ignoredDirs` and `skipExtensions` (added to the
  machine's lists). Rule: a repo can only narrow, never widen, the machine config.
  A **malformed config stops the run** before reading any file — with a message
  written for the AI agent running `yats index`: what is wrong, why indexing
  stopped, and the three ways out (fix the file and re-run, delete it to use
  machine defaults, or `--no-config`). In a TTY it asks to open `$EDITOR` and
  retries in a loop. `yats watch` applies the same config. Design: see
  `docs/SPIKE-per-repo-config.md`.

### Fixed
- **Hardcoded env vars in the compose templates.** `INDEX_DOCS`, `DOC_MAX_FILES`
  and `EMBEDDING_BATCH_SIZE` are now `${VAR:-default}` interpolations (setup
  template, repo dev compose, deployed compose), so `~/.yats/.env` can override
  them without re-running `yats setup`. The repo's dev compose now also passes
  the doc env block (`INDEX_DOCS`, `DOC_MAX_FILES`, `DOC_EXTENSIONS`,
  `SKIP_EXTENSIONS`, `IGNORED_DIRS`) for parity with deployed setups.

## [0.5.0] - 2026-09-21

### Added
- **Doc config respected on the per-file path (P4).** `INDEX_DOCS=false` now
  drops documentation files sent via `/index/file` (both the doc route in
  `indexFileContent` and `indexDocFileContent` itself guard), matching the full
  pipeline. `yats index --skip-docs` is documented in the CLI help and now skips
  every `DOC_EXTENSIONS` file (was only `.md`); the CLI also reads
  `DOC_EXTENSIONS`/`SKIP_EXTENSIONS`/`IGNORED_DIRS` from `~/.yats/.env` so it
  filters files consistently with the server.
- **`find_routes` coverage + working filters (P5).**
  - The **Go bridge** now detects routes: stdlib `http.HandleFunc`, gorilla/mux
    `r.HandleFunc`/`r.Handle`, gin `r.GET(...)`, chi `r.Get(...)`.
  - The **TS analyzer** detects Express/plain-router patterns (`app.get('/x',
    handler)`, `router.post(...)`, `this.app.get`) and NestJS routes are now
    emitted per method with the controller prefix (`@Controller('users')` +
    `@Get(':id')` → `users/:id`).
  - Routes carry `httpMethod`/`routePath` metadata (FastAPI, Flask
    `@app.route` with `methods=[...]`, NestJS, Express, Go), stored as
    queryable node properties.
  - `method`/`routePath`/`limit` filters are implemented in the handler and the
    Neo4j query (parameterized; the hardcoded LIMIT 100 is gone). The schema
    accepts `path` as an alternative to `repository`; the route path filter is
    `routePath` (the old `path` filter conflicted with the repository path
    convention). `find_routes` output includes `method` + `path` per route.
- **Commit-based `yats watch` (P1).** The watcher no longer tracks the working tree
  — it polls `git rev-parse HEAD` every ~2s on the host and, when HEAD changes
  (new commit or branch checkout), streams only `git diff --name-status
  <lastIndexed>..HEAD`: added/modified files via `/index/file`, deleted/renamed via
  `/index/remove`, then finalizes cross-file relationships (`/index/complete`) and
  records the new commit. Saving files without committing does not touch the index,
  so the graph always reflects the last commit — `git checkout main` after dirty
  experiments leaves the index describing main. `yats index` also records its
  indexed commit now, so `watch` starts diffing from there; on startup without a
  recorded commit it runs a full index first. `--live` restores save-based
  indexing on top of the commit loop (the only mode for non-git directories).
  - New endpoints: `GET /index/commit?repository=<path>` and `POST /index/commit
    {repository, commit}` (records the commit on the Repository node, which
    already existed via `getLastIndexedCommit`/`setLastIndexedCommit`).
  - `YATS_WATCH_POLL_MS` tunes the poll interval (default 2000ms).

### Fixed
- **`ensureIndexed` read the last indexed commit by basename** while it was stored by
  full root path, so server-side incremental detection never triggered. Now reads
  by the repository path, consistent with the commit-tracking key used by
  `yats index` / `yats watch`.
- In-place symbol updates on re-index (P2). Re-indexing a file used to delete all of
  its symbols with `DETACH DELETE`, which also destroyed *incoming* edges — re-indexing
  `base.py` killed `JiraStrategy -> TicketSource` because `jira.py` was not re-indexed at
  that moment, degrading the graph with every incremental run. Now surviving symbols
  (same deterministic ID) keep their node and incoming edges; only their outgoing edges
  are regenerated from the new analysis. Symbols that disappeared are deleted, and stale
  buffered relationships for the file are dropped so the pending flush cannot resurrect
  dead edges. Applies to the per-file path (`/index/file`) and the git-based incremental
  path. Renames still lose incoming edges (documented limitation).
  - `GraphRepository.deleteRelationships` now takes a batch of IDs and deletes **outgoing**
    edges only (was a single-ID undirected delete); added `listSymbolIdsByFile`.
  - Fixed the incremental path's 1000-symbol pagination cap when removing a deleted file's
    symbols (could miss the file on larger repos).

## [0.4.2] - 2026-08-22

### Added
- **Indexing-in-progress notice (P3).** The server now tracks per-repository indexing state
  (pending relationship buffer + recent file activity). While a repo is mid-index, graph
  tools tell the agent instead of showing confusing partial data:
  - `repository_summary` returns `indexing: true`, `pendingRelationships`, and a `notice`
    explaining that the relationship graph is only complete once indexing finishes.
  - `find_callers`, `find_callees`, `find_references`, `find_implementations`,
    `find_inheritors`, `find_tests`, `expand_graph`, `related_symbols` prepend the notice
    to their results (the JSON payload stays intact and parseable).
  - The state clears ~15s after the last file activity, so the notice disappears once
    indexing settles. Semantic search is unaffected (partial symbols are still useful).

## [0.4.1] - 2026-08-22

### Fixed
- `repository_summary` counted every relationship twice — the Cypher query used an undirected pattern (`-[r]-()`), which matches each directed edge once per direction. Now uses `-[r]->()`, so `totalRelationships` reflects the real edge count.

## [0.4.0] - 2026-08-22

### Removed
- **Server-side indexing is gone.** The MCP tools `index_repository`, `reindex`, `index_file`, and `remove_file` were removed. The server never walks the host filesystem (it may run in a container without access to host paths), so indexing happens exclusively through the thin host CLI (`yats index <path>`, `yats watch <path>`, `yats remove`), which streams files over HTTP. Search tools now return the exact `yats index` command to run when a repo isn't indexed yet — no more silent "0 symbols indexed" successes.
- `POST /index` is now a lightweight repo registration (metadata only); the CLI streams files via `/index/file` and finalizes via `/index/complete`.

### Fixed
- **`yats watch <path>` crashed with ENOENT** — the CLI dispatcher never passed arguments to the watch command (`case "watch"` imported the module without args), so `watch.js` read `process.argv[2]` (= the subcommand "watch") as the repo path and tried to stat `CWD/watch`. `watch` now follows the same pattern as every other subcommand (`m.default(args)`) and handles `--help`/`-h`. It also sends **repository-relative** file paths to the server (previously absolute), so watch-reindexed symbols keep the same IDs as the ones from `yats index` instead of duplicating them.
- **Cross-file relationships now actually work.** The per-file ingestion path (`yats index`, `yats watch`) stored relationships raw, so any edge pointing to a symbol in another file (cross-file CALLS, INHERITS, IMPORTS) was silently dropped by Neo4j — only same-file CALLS/CONTAINS/DECORATES survived. Relationships are now buffered per repository and flushed (debounced 3s, or immediately via `POST /index/complete`) with cross-file resolution against the full repo symbol table (`GlobalSymbolTable`). `find_callers`/`find_callees`/`expand_graph` now return cross-file edges.
- Python bridge: `self.x()`/`cls.x()` calls now emit callee IDs qualified with the current class, so same-file method→method CALLS edges survive.
- `resolveCallTarget` rewrites same-file method calls when there is exactly one unambiguous candidate repo-wide (raw target lacked the class qualifier).

### Added
- `POST /index/complete` HTTP endpoint — flushes pending relationships immediately; the `yats index` CLI calls it after sending all files.
- `GraphRepository.listAllSymbols(repository)` — lightweight symbol rows for cross-file resolution (also replaces the 5000-symbol cap in `removeFileSymbols`).

## [0.3.4] - 2026-08-18

### Fixed
- Documentation indexing now routes doc files to the documentation pipeline from the per-file content sent over the network (instead of reading the server filesystem), fixing `search_documentation` returning empty results.
- Benchmark `.env` loader ignores empty values so placeholder keys in `~/.yats/.env` don't shadow real keys from other `.env` files.

### Changed
- Benchmark: claude runs with the raw question prompt (matching end-user behavior); other agents keep the neutral "do not modify files" guard.
- Benchmark: agent instruction files (SKILL.md, AGENTS.md, rules.mdc, GEMINI.md, instructions.md) are inlined, making the benchmark self-contained and reproducible from npm.

### Added
- `DOC_EXTENSIONS`, `SKIP_EXTENSIONS`, `IGNORED_DIRS` in `~/.yats/.env` (user-configurable file filtering).
- Benchmark extracts and shows the agent's final answer (on screen + saved in `results.json`).
- Benchmark spinner stays on a single line and shows live tool activity.

## [0.3.3] - 2026-08-18

### Fixed
- `yats setup` now writes the benchmark agent keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`) into `~/.yats/.env` as empty values so users see exactly what to fill in for `yats benchmark`; existing values are preserved.

## [0.3.2] - 2026-08-17

### Added
- Embedding model selection per provider in `yats setup` (models stored in `.env` as `EMBEDDING_<PROVIDER>_MODEL`).
- Dynamic vector dimensions per embedding model (no more hardcoded 768/1024/1536).
- Dimension-change detection: Qdrant startup warns when the collection dimension doesn't match the model, and search tools return rebuild instructions.
- `rebuild_vectors` MCP tool + `yats reindex --rebuild-vectors` CLI (re-embeds all symbols; warns about API costs and asks for confirmation).
- Infra tests: generator dimension maps, `extractVectorSize`, and a `.env`-gated Qdrant E2E test (`YATS_E2E=1`).

## [0.3.1] - 2026-08-17

### Fixed
- Setup persists keys to `~/.yats/.env` (canonical) instead of embedding them in `docker-compose.yml`; compose now reads them via interpolation.
- Embedding keys use an `EMBEDDING_*` prefix so they can differ from benchmark agent keys for the same provider.
- Benchmark reads keys from `~/.yats/.env` and refuses to run an agent whose key is missing (clear message + exit).
- Copilot auth no longer copies `~/.copilot/config.json` silently — explicit consent is asked at start.

## [0.3.0] - 2026-08-17

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
- Indexer fully reindexes when a repo is indexed at a new rootPath (previously it deduped by name and never updated the stored path, causing "always reindexes" loops).
- Benchmark instructs agents to answer inline without writing files (Claude was generating .md artifacts during baseline runs).
- Benchmark drains agent stderr (removes a pipe deadlock risk) and detects "already indexed" by exact rootPath instead of substring.
- Benchmark shows live agent activity next to the spinner during runs.

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

[Unreleased]: https://github.com/fvinciarelli/yats.ai/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/fvinciarelli/yats.ai/releases/tag/v0.3.2
[0.3.1]: https://github.com/fvinciarelli/yats.ai/releases/tag/v0.3.1
[0.3.0]: https://github.com/fvinciarelli/yats.ai/releases/tag/v0.3.0
[0.1.14]: https://github.com/fvinciarelli/yats.ai/releases/tag/v0.1.14
[0.1.0]: https://github.com/fvinciarelli/yats.ai/releases/tag/v0.1.0
