# YATS — Roadmap / Planned Work

Planned improvements agreed with the user. Not yet implemented — do not start without confirmation.

## P1 — Commit-based `yats watch` (redesign)

**Problem:** the current watch re-indexes on every file save (`fs.watch`), so the index
tracks the *working tree*, not the repository state. If you edit files, run tests, never
commit, and `git checkout` back to main, the index is left describing code that no longer
exists. The graph must always reflect the **last commit**, not the last save.

**Design:**

```
yats watch <path>
   |
   |-- Startup: read HEAD + last indexed commit (server already stores it:
   |   getLastIndexedCommit / setLastIndexedCommit)
   |
   |-- Loop: poll `git rev-parse HEAD` every ~2s (cheap, local)
   |
   |-- HEAD changed (new commit OR branch checkout):
   |     |-- git diff --name-status <lastIndexedCommit>..HEAD
   |     |     added/modified  -> POST /index/file (host reads + sends content)
   |     |     deleted/renamed -> POST /index/remove
   |     |-- POST /index/complete   (cross-file relationship resolution)
   |     |-- register new commit as indexed
   |
   |-- Saving files WITHOUT committing -> does NOT touch the index
```

**Properties:**
- Index is always = last commit. `git checkout main` after uncommitted experiments
  removes the files that "disappeared" from the diff → graph of main. Exactly what
  the user asked for.
- Zero embeddings wasted on intermediate states.
- `git` runs on the **host** (the Docker container has no git/sh; watch runs on the host).

**Open questions (confirmed by user):**
- Commit is the only trigger by default; optional `--live` flag restores save-based
  indexing for agents working on uncommitted code (default: off).
- `yats index` (full) should also record the indexed commit so watch starts from there
  (e.g. `/index/complete` accepts an optional `commit`; or a `POST /index/commit` endpoint).

## P2 — Preserve incoming edges when re-indexing a file (server)

**Problem:** re-indexing a file deletes its symbols with `DETACH DELETE`, which also
removes **incoming** edges (e.g. re-indexing `base.py` kills `JiraStrategy -> TicketSource`
because `jira.py` is not re-indexed at that moment). The graph degrades with any
incremental flow (watch, commit-based or not).

**Design:**
- When re-indexing a file, update symbols **in-place** (`MERGE` already exists) instead of
  `DETACH DELETE` of the whole file:
  - delete only the file's *outgoing* edges (`deleteRelationships`),
  - keep nodes + incoming edges when the symbol still exists (same deterministic ID),
  - only delete nodes for symbols that no longer exist in the new analysis.
- Renames still lose incoming edges (old ID is gone; caller cannot be re-resolved without
  re-indexing the caller) — acceptable, documented.

## P3 — Eliminate the "0 relationships" window during (re)indexing

**Observed (2026-08-22, by an AI agent using the current pipeline):** during `yats index`,
`repository_summary` reports 0 relationships (old edges die file-by-file via `DETACH DELETE`
while new ones sit in the pending buffer), then jumps to the full count after the flush
(`/index/complete` or the 3s debounce). The agent concluded "wait ~30s after indexing" —
that is an observation, not a contract: the window lasts the whole indexing run (minutes on
large repos), and if the CLI dies mid-run the flush never fires and the repo is left with 0
relationships until the next full index. The "wait until relationships stops increasing"
polling guidance is misleading with this pipeline (it drops to 0, then jumps).

**Design options (updated with UX approach):**
- **Indexing-state flag + notice (user proposal, preferred):** the server tracks
  per-repo indexing state and, when a graph tool is queried mid-index, returns an
  explicit notice instead of confusing partial numbers:

  ```
  ⏳ Repository "X" is currently being indexed (N relationships pending resolution).
  The relationship graph is only complete once indexing finishes.
  Wait ~30s, then query repository_summary again.
  ```

  Implementation sketch:
  - `IndexerService` tracks `lastActivityAt` per repo (updated on `registerRepository`
    and every `indexFileContent`); `isIndexing(repo)` = pending buffer > 0 ||
    timer pending || now - lastActivityAt < 15s.
  - `repository_summary` returns the notice (+ partial symbol count) while indexing;
    graph tools (`find_callers`, `expand_graph`, ...) prepend the notice to results;
    semantic search keeps working (partial symbols are still useful).
  - Edge case: CLI killed mid-run → the 3s debounce flush still fires (timer is
    server-side), repo returns to idle with whatever made it into the buffer.
- Report pending+stored relationships in `repository_summary` (server knows its buffer size)
  so the count never falsely drops to 0, and/or expose a `pending` field.
- Fix the root cause via P2 (in-place symbol updates + final flush) — removes the window
  entirely.
- Make `/index/complete` idempotent + run it even when the CLI is interrupted
  (e.g. `yats index` trap on SIGINT/SIGTERM).

## P4 — Respect doc-indexing config on the per-file path (`yats index`)

**Problem:** the `yats index` CLI (per-file path via `/index/file`) ignores the
`.env` doc settings and the docs option is invisible to agents:

- `INDEX_DOCS=false` in `.env` is **not respected**: `indexFileContent` routes
  files to the doc pipeline purely by extension (`isDocumentationFile`), and
  `indexDocFileContent` never checks `INDEX_DOCS`. Only the full `indexRepository`
  pipeline honors it (`process.env.INDEX_DOCS !== "false"`). Docs are always
  indexed when the extension is in `DOC_EXTENSIONS`.
- The CLI has a `--skip-docs` flag (`bin/setup.js`) but it is **undocumented**:
  the help output and usage header only show `yats index <path>`, so agents
  never know it exists and never ask.
- `--skip-docs` only skips `.md` files — narrower than `DOC_EXTENSIONS`
  (`.md,.mdx,.rst,.txt,.adoc,.org,.wiki,.readme`).
- The CLI reads no `.env` at all (only `YATS_URL`); its ignored-dirs list is
  hardcoded and does not include `IGNORED_DIRS` from `.env`.

**Design:**
- Make `indexDocFileContent` (and the doc route in `indexFileContent`) respect
  `INDEX_DOCS=false` server-side, so per-file ingestion matches the full
  pipeline.
- Document `--skip-docs` in the CLI help + usage header; optionally broaden it
  to skip any file matching `DOC_EXTENSIONS` instead of only `.md`.
- Optional: have the CLI read `DOC_EXTENSIONS`/`SKIP_EXTENSIONS`/`IGNORED_DIRS`
  from `~/.yats/.env` so `yats index` filters files consistently with the server.

## P5 — `find_routes` (and route detection coverage)

**Problem:** the tool exists but is of limited use:

- **Coverage gap:** route symbols are only produced by the C# (ASP.NET
  attributes), Python (Flask) and TypeScript (NestJS decorators) analyzers.
  The **Go analyzer detects no routes** and TS without NestJS (Express, plain
  fetch) is not covered. On `lab_hub` (Go backend + non-NestJS TS frontend)
  `find_routes` returns **0 routes** despite dozens of real endpoints — agents
  must fall back to `search_code` on handlers.
- **Dead filter args:** the schema declares `method` and `path` (partial match)
  but the handler ignores both — it calls `findRoutes(rootPath)` with no
  filters.
- **Hardcoded LIMIT 100** in the Neo4j query; the schema's `limit` arg is unused.
- **Schema inconsistency:** `required: ["repository"]` while sibling tools
  accept `path` (the handler resolves both via `ensureRepoIndexed`, but
  schema-driven clients will pass `repository`).

**Design:**
- Add route detection to the Go analyzer (mux/gin/chi registrations, e.g.
  `HandleFunc`, `GET("/...")` patterns).
- Broaden the TS analyzer beyond NestJS (Express `app.get/post/...`, router
  patterns).
- Implement `method`/`path` filters + `limit` in the handler and the Neo4j
  query (with parameterized filters); drop the hardcoded 100.
- Relax the schema: `path` as an alternative to `repository`, consistent with
  the other repo tools.

## Status

- P6: **Implemented (2026-09-21):** per-repo config via `.yats/config.json`
  (design in `docs/SPIKE-per-repo-config.md`). A malformed config **stops the
  run** (never index with broken filters): TTY asks to open `$EDITOR` and
  retries in a loop; non-TTY (an AI agent running `yats index`) exits 1 with
  a message written for the agent — what is wrong, why it stopped, and the
  three ways out (fix + re-run, delete the file, `--no-config`). `yats watch`
  applies the same config and stops the same way. Also fixed the hardcoded
  env vars: `INDEX_DOCS`, `DOC_MAX_FILES` and `EMBEDDING_BATCH_SIZE` are now
  `${VAR:-default}` interpolations in the setup template, the repo's dev
  compose, and the deployed compose.
- P1: approved as plan by user (2026-08-22). **Implemented (2026-09-21):**
  `yats watch` is now commit-based — it polls `git rev-parse HEAD` every ~2s
  (`YATS_WATCH_POLL_MS`) on the host and, when HEAD changes (new commit or
  branch checkout), streams only `git diff --name-status <lastIndexed>..HEAD`
  (added/modified via `/index/file`, deleted/renamed via `/index/remove`),
  then finalizes (`/index/complete`) and records the new commit
  (`POST /index/commit`). Saves without committing do not touch the index.
  `yats index` also records its commit now, so watch starts diffing from
  there; on startup without a recorded commit it runs a full index first.
  `--live` restores save-based indexing on top of the commit loop (the only
  mode available for non-git directories). Renames still lose incoming edges
  (documented limitation, see P2).
- P2: approved as plan by user (2026-08-22). **Implemented (2026-09-21):** in-place
  symbol updates on re-index — surviving symbols keep their node and incoming
  edges (only outgoing edges are regenerated); disappeared symbols are deleted;
  stale buffered relationships for the file are dropped so the pending flush
  cannot resurrect dead edges. Applies to both the per-file path
  (`IndexerService.indexFileContent`) and the git-based incremental path
  (`IncrementalIndexerService.reindexFile`). Renames still lose incoming edges
  (documented limitation).
- P3: **implemented in v0.4.2** (indexing-state flag + notice in graph tools;
  `repository_summary` returns `indexing`/`pendingRelationships`/`notice`;
  graph tools prepend the notice; state clears ~15s after last activity).
- P4: added as plan (2026-08-25). **Implemented (2026-09-21):** the per-file
  path now respects `INDEX_DOCS=false` server-side (`indexFileContent` drops
  doc files, `indexDocFileContent` guards too); `--skip-docs` is documented in
  the CLI help and now skips every `DOC_EXTENSIONS` file (was only `.md`); the
  CLI reads `DOC_EXTENSIONS`/`SKIP_EXTENSIONS`/`IGNORED_DIRS` from
  `~/.yats/.env` so it filters files consistently with the server.
- P5: added as plan (2026-08-25). **Implemented (2026-09-21):**
  - Route detection coverage: the **Go bridge** now detects routes (stdlib
    `http.HandleFunc`, gorilla/mux `r.HandleFunc`/`r.Handle`, gin `r.GET(...)`,
    chi `r.Get(...)`), and the **TS analyzer** detects Express/plain-router
    patterns (`app.get('/x', handler)`, `router.post(...)`, `this.app.get`)
    beyond NestJS.
  - Routes carry `httpMethod` + `routePath` metadata (TS NestJS per-method
    routes incl. controller prefix, FastAPI + Flask `@app.route` with
    `methods=[...]`, Go bridge) and it is stored as queryable node properties
    (`httpMethod`/`routePath`).
  - `find_routes` filters now work: `method`/`routePath`/`limit` are
    parameterized in the Neo4j query (hardcoded LIMIT 100 dropped; `limit`
    honored), and the zod schema + handler pass them through. The schema now
    accepts `path` as an alternative to `repository` (consistent with sibling
    tools); the route path filter is `routePath` (the old schema's `path`
    filter conflicted with the repository path convention).
  - `find_routes` output includes `method` + `path` per route.
  - Known heuristics: gin vs chi by verb casing (GET vs Get); gorilla method
    chains (`Methods("GET").Path(...)`) and gin `Group()` prefixes are not
    captured.
