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

## Status

- P1: approved as plan by user (2026-08-22). Not started.
- P2: approved as plan by user (2026-08-22). Not started.
