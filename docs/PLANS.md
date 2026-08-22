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

## Status

- P1: approved as plan by user (2026-08-22). Not started.
- P2: approved as plan by user (2026-08-22). Not started.
- P3: **implemented in v0.4.2** (indexing-state flag + notice in graph tools;
  `repository_summary` returns `indexing`/`pendingRelationships`/`notice`;
  graph tools prepend the notice; state clears ~15s after last activity).
