#!/usr/bin/env node
/**
 * yats watch <path> [--live] — keeps the YATS index in sync with the
 * repository's *commits*, not the working tree (P1).
 *
 * Usage:
 *   yats watch <path>          # commit-based (default)
 *   yats watch <path> --live   # also index on every file save
 *
 * Commit-based mode:
 *   - Polls `git rev-parse HEAD` every YATS_WATCH_POLL_MS (default 2000ms).
 *   - When HEAD changes (new commit OR branch checkout), diffs
 *     <lastIndexedCommit>..HEAD and streams only the changed files.
 *   - Saving files WITHOUT committing does NOT touch the index — the graph
 *     always reflects the last commit.
 *   - On startup, if the repo has no recorded indexed commit, it runs a full
 *     `yats index` first so it never starts from a half-indexed state.
 *
 * --live mode restores save-based indexing (fs.watch + debounce) on top of
 * the commit loop, for agents working on uncommitted code. Without a git
 * repository, --live is the only mode available.
 *
 * Zero dependencies — Node built-ins only. git runs on the host (the server
 * may live in a container without git).
 */

import {
  watch as fsWatch,
  statSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { resolve, relative, join, dirname } from "node:path";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import indexRepo, {
  IGNORED,
  loadYatsEnv,
  mergeRepoConfig,
  resolveRepoConfig,
  shouldSkipFile,
} from "./indexer.js";
import { canonicalRepoPath } from "./repo-path.js";

// ============================================================
// Config
// ============================================================

const DEFAULT_URL = "http://localhost:5555";
const POLL_MS = parseInt(process.env.YATS_WATCH_POLL_MS ?? "2000", 10);
const DEBOUNCE_MS = parseInt(process.env.YATS_WATCH_DEBOUNCE_MS ?? "500", 10);
const SKIP_PATTERNS = [
  /node_modules/,
  /\.git\//,
  /vendor\//,
  /__pycache__/,
  /\.next\//,
  /dist\//,
  /\.yarn\//,
];

// ============================================================
// Single-instance lock — one watcher per repo
// ============================================================

/** Root of YATS host state (`YATS_HOME` overrides it, used by tests). */
function yatsHome() {
  return process.env.YATS_HOME ?? join(homedir(), ".yats");
}

/**
 * Lock file for a repo. Keyed by the resolved path so `yats watch .`,
 * `yats watch /abs/path` and an IDE task pointing at the same folder share it.
 */
export function watchLockPath(repoPath) {
  const key = createHash("sha1").update(resolve(repoPath)).digest("hex").slice(0, 12);
  return join(yatsHome(), "run", `watch-${key}.json`);
}

/** True when `pid` is a live process (EPERM means it exists but isn't ours). */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

/**
 * Take the per-repo watcher lock.
 *
 * Any number of triggers (IDE folderOpen task, terminal command, git hook)
 * may launch `yats watch` for the same folder; only the first one wins and the
 * rest exit as a no-op. Locks left behind by a dead PID are replaced.
 */
export function acquireWatchLock(repoPath) {
  const lockPath = watchLockPath(repoPath);
  mkdirSync(dirname(lockPath), { recursive: true });

  if (existsSync(lockPath)) {
    try {
      const held = JSON.parse(readFileSync(lockPath, "utf-8"));
      if (pidAlive(held.pid)) {
        return { acquired: false, pid: held.pid, repoPath: held.repoPath ?? repoPath, lockPath };
      }
    } catch {
      /* corrupt or unreadable lock — treat it as stale */
    }
  }

  writeFileSync(
    lockPath,
    JSON.stringify(
      { pid: process.pid, repoPath: resolve(repoPath), startedAt: new Date().toISOString() },
      null,
      2,
    ) + "\n",
  );
  return { acquired: true, lockPath };
}

/** Release the lock, but only when this process owns it. */
export function releaseWatchLock(repoPath) {
  const lockPath = watchLockPath(repoPath);
  try {
    const held = JSON.parse(readFileSync(lockPath, "utf-8"));
    if (held.pid === process.pid) unlinkSync(lockPath);
  } catch {
    /* nothing to release */
  }
}

// ============================================================
// git helpers (host side — the server container has no git)
// ============================================================

function git(cwd, cmd) {
  return execSync(`git ${cmd}`, { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
}

function isGitRepo(repoPath) {
  try {
    git(repoPath, "rev-parse --git-dir");
    return true;
  } catch {
    return false;
  }
}

/** Current HEAD, or null for an unborn branch (no commits yet). */
function headCommit(repoPath) {
  try {
    return git(repoPath, "rev-parse HEAD");
  } catch {
    return null;
  }
}

/**
 * Parse `git diff --name-status` output.
 * Handles the rename format (`R100\told\tnew`) and quoted paths.
 */
export function parseNameStatus(output) {
  const changes = { added: [], modified: [], deleted: [], renamed: [] };

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const [status, ...rest] = line.split("\t");
    if (!status) continue;

    const unquote = (p) =>
      p && p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p;

    if (status.startsWith("R") && rest.length >= 2) {
      changes.renamed.push({ from: unquote(rest[0]), to: unquote(rest[1]) });
    } else if (status.startsWith("A")) {
      changes.added.push(unquote(rest[0]));
    } else if (status.startsWith("M")) {
      changes.modified.push(unquote(rest[0]));
    } else if (status.startsWith("D")) {
      changes.deleted.push(unquote(rest[0]));
    }
  }

  return changes;
}

// ============================================================
// HTTP helpers
// ============================================================

function post(baseUrl, path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getRecordedCommit(baseUrl, repoName) {
  const res = await fetch(
    `${baseUrl}/index/commit?repository=${encodeURIComponent(repoName)}`,
  );
  if (!res.ok) return null;
  try {
    const data = await res.json();
    return data.commit ?? null;
  } catch {
    return null;
  }
}

function shouldSkipPath(relPath, extraIgnoredDirs = []) {
  if (!relPath || relPath.startsWith(".")) return true;
  const segments = relPath.split("/");
  return (
    segments.some((seg) => IGNORED.has(seg) || extraIgnoredDirs.includes(seg)) ||
    SKIP_PATTERNS.some((p) => p.test(relPath))
  );
}

/**
 * Build the per-file filter from the effective config (machine + repo).
 * Doc/code filtering is delegated to indexer.shouldSkipFile (P4/P6) so
 * `yats watch` and `yats index` behave identically.
 */
function makeFileFilter(effective) {
  return (relPath) =>
    shouldSkipPath(relPath, effective.ignoredDirs ?? []) ||
    shouldSkipFile(relPath, {
      ...effective,
      skipDocs: effective.indexDocs === false,
    });
}

async function indexFile(baseUrl, repoPath, repoName, relPath, skipFn) {
  if (skipFn(relPath)) return;
  const fullPath = resolve(repoPath, relPath);
  let content;
  try {
    content = readFileSync(fullPath, "utf-8");
  } catch {
    return; // deleted between diff and read — next commit will catch it
  }
  if (content.includes("\0") || content.length > 1_000_000) return; // binary/huge

  console.log(`  ↻ Indexing: ${relPath}`);
  try {
    const res = await post(baseUrl, "/index/file", {
      repoName,
      filePath: relPath,
      content,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log(`  ✓ Done: ${relPath}`);
  } catch (err) {
    console.error(`  ✗ Failed: ${relPath} — ${err.message}`);
  }
}

async function removeFile(baseUrl, repoName, relPath, skipFn) {
  if (skipFn(relPath)) return;
  console.log(`  ↻ Removing from index: ${relPath}`);
  try {
    const res = await post(baseUrl, "/index/remove", {
      repository: repoName,
      path: relPath,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log(`  ✓ Removed: ${relPath}`);
  } catch (err) {
    console.error(`  ✗ Failed: ${relPath} — ${err.message}`);
  }
}

// ============================================================
// Commit diff application
// ============================================================

/**
 * Bring the index from `from` to `to` by streaming only the changed files.
 * Exported for tests (baseUrl and the effective config are injectable).
 */
export async function applyDiff(repoPath, repoName, from, to, baseUrl = DEFAULT_URL, effective = {}) {
  let output;
  try {
    output = git(repoPath, `diff --name-status ${from}..${to}`);
  } catch (err) {
    // E.g. the recorded commit was garbage-collected — full re-index is the
    // only safe path.
    console.log(`  ⚠ Cannot diff ${from.slice(0, 8)}..${to.slice(0, 8)} — full re-index...`);
    await indexRepo([repoPath]);
    return;
  }

  const skipFn = makeFileFilter(effective);
  const changes = parseNameStatus(output);
  const total =
    changes.added.length + changes.modified.length +
    changes.deleted.length + changes.renamed.length;
  console.log(
    `  ${total} changed file(s): +${changes.added.length} ` +
    `~${changes.modified.length} -${changes.deleted.length} ` +
    `⟲${changes.renamed.length}`,
  );

  for (const p of changes.deleted) await removeFile(baseUrl, repoName, p, skipFn);
  for (const r of changes.renamed) await removeFile(baseUrl, repoName, r.from, skipFn);
  for (const p of [...changes.added, ...changes.modified]) {
    await indexFile(baseUrl, repoPath, repoName, p, skipFn);
  }
  for (const r of changes.renamed) {
    await indexFile(baseUrl, repoPath, repoName, r.to, skipFn);
  }

  // Flush cross-file relationships and record the new commit. Both are
  // non-fatal: the server also flushes on its debounce timer, and watch
  // re-syncs on the next poll if the commit was not recorded.
  try {
    await post(baseUrl, "/index/complete", { repository: repoName });
  } catch {
    /* non-fatal */
  }
  try {
    await post(baseUrl, "/index/commit", { repository: repoName, commit: to });
  } catch {
    /* non-fatal */
  }
  console.log(`  ✓ Index synced to commit ${to.slice(0, 8)}`);
}

// ============================================================
// Live mode — save-based indexing (fs.watch + debounce)
// ============================================================

function startLiveWatch(repoPath, repoName, baseUrl, effective) {
  const pending = new Map();
  const skipFn = makeFileFilter(effective);

  fsWatch(repoPath, { recursive: true }, (_eventType, filename) => {
    if (!filename || SKIP_PATTERNS.some((p) => p.test(filename))) return;
    if (filename.startsWith(".")) return;

    const fullPath = resolve(repoPath, filename);
    const relPath = relative(repoPath, fullPath);
    if (shouldSkipPath(relPath)) return;

    const existing = pending.get(fullPath);
    if (existing) clearTimeout(existing);

    pending.set(
      fullPath,
      setTimeout(async () => {
        pending.delete(fullPath);
        try {
          statSync(fullPath);
          await indexFile(baseUrl, repoPath, repoName, relPath, skipFn);
        } catch {
          await removeFile(baseUrl, repoName, relPath, skipFn);
        }
      }, DEBOUNCE_MS),
    );
  });

  console.log(`   (live saves: every save re-indexes the file, debounced ${DEBOUNCE_MS}ms)`);
}

// ============================================================
// Main
// ============================================================

export default async function watchRepo(args = []) {
  const live = args.includes("--live");
  const noConfig = args.includes("--no-config");
  const baseUrl = process.env.YATS_URL ?? DEFAULT_URL;
  const cleanArgs = args.filter((a) => a !== "--live" && a !== "--repo" && a !== "--no-config");

  // Canonical path (`C:\Repo\`, `C:/Repo`, `/c/Repo`, `.` all collapse to one
  // identity) so `yats index` and `yats watch` — and the IDE task — agree on
  // the same repo.
  const repoPath = canonicalRepoPath(cleanArgs[0] ?? process.cwd());

  if (!cleanArgs[0] || cleanArgs[0] === "--help" || cleanArgs[0] === "-h") {
    console.log("Usage: yats watch <path> [--live] [--no-config]");
    console.log("");
    console.log("Keeps the YATS index in sync with the repository's commits.");
    console.log("Saving files without committing does NOT touch the index —");
    console.log("the graph always reflects the last commit.");
    console.log("");
    console.log("  --live        also re-index on every file save (uncommitted code)");
    console.log("  --no-config   ignore the repo's .yats/config.json");
    console.log("");
    console.log("  yats watch ~/my-project");
    console.log("  yats watch ~/my-project --live");
    process.exit(1);
  }

  // One watcher per repo: IDE tasks, terminals and hooks may all try to start
  // this, but a second process would re-index the same files (double embeddings
  // cost) and race on the same files.
  const lock = acquireWatchLock(repoPath);
  if (!lock.acquired) {
    console.log(`👀 Already watching: ${repoPath}`);
    console.log(`   PID ${lock.pid} owns this repo — this invocation is a no-op.`);
    return;
  }
  const releaseLock = () => releaseWatchLock(repoPath);
  process.on("exit", releaseLock);
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      releaseLock();
      process.exit(0);
    });
  }

  // Server reachability
  try {
    await fetch(`${baseUrl}/health`);
  } catch {
    console.error(`Cannot reach YATS at ${baseUrl}. Is it running?`);
    process.exit(1);
  }

  // Register before watching: the server owns the identity and answers with the
  // rootPath already stored for this folder, so a legacy index keeps working
  // (and gets a warning) instead of being duplicated under a new spelling.
  let repoName = repoPath;
  try {
    const res = await post(baseUrl, "/index", { path: repoPath });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      // Never watch a repo the server could not register: files would be
      // indexed without a Repository node and queries would not find them.
      console.error(`Cannot register repository: ${data?.error ?? `HTTP ${res.status}`}`);
      releaseLock();
      process.exit(1);
    }
    if (data?.warning) console.log(`\n  ⚠ ${data.warning}\n`);
    // Older servers answer with the basename — only trust full paths.
    const answered = typeof data?.repository === "string" ? data.repository : "";
    if (answered && (answered.includes("/") || answered.includes("\\"))) {
      repoName = answered;
    }
  } catch {
    /* non-fatal: watching still works, it just re-registers on the next run */
  }

  // P6 — same config resolution as `yats index`: a malformed
  // .yats/config.json stops the run instead of watching with wrong filters.
  const repoConfig = resolveRepoConfig(repoPath, noConfig);
  const effective = mergeRepoConfig(loadYatsEnv(), repoConfig);

  console.log(`👀 Watching: ${repoPath}`);
  console.log(`   Repo: ${repoName}`);
  console.log(`   Server: ${baseUrl}`);
  console.log(`   Mode: ${live ? "commits + live saves" : "commits only"}`);
  console.log("");

  const gitOk = isGitRepo(repoPath);

  if (live) {
    startLiveWatch(repoPath, repoName, baseUrl, effective);
  }

  if (!gitOk) {
    if (live) {
      console.log("   (not a git repository — live saves only)");
      process.stdin.resume();
      process.on("SIGINT", () => {
        console.log("\n👋 Stopped watching.");
        process.exit(0);
      });
      return;
    }
    console.error(
      "Not a git repository — commit-based watch requires git.\n" +
      "Use `yats watch <path> --live` to index on every save instead.",
    );
    process.exit(1);
  }

  // ============================================================
  // Commit-based loop
  // ============================================================

  let recorded = await getRecordedCommit(baseUrl, repoName);
  let head = headCommit(repoPath);

  if (recorded == null || recorded.length === 0) {
    if (head) {
      console.log("   No recorded index commit — running a full index first...");
      await indexRepo([repoPath]);
      recorded = headCommit(repoPath);
    } else {
      console.log("   Repo has no commits yet — waiting for the first commit...");
      recorded = null;
    }
  } else if (head && recorded !== head) {
    console.log(
      `   Indexed commit ${recorded.slice(0, 8)} ≠ HEAD ${head.slice(0, 8)} — syncing...`,
    );
    await applyDiff(repoPath, repoName, recorded, head, baseUrl, effective);
    recorded = head;
  }

  if (recorded) {
    console.log(`   ✓ In sync with commit ${recorded.slice(0, 8)}`);
  }
  console.log(`   (polling HEAD every ${POLL_MS}ms — commits trigger re-index)`);
  console.log("");

  while (true) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    head = headCommit(repoPath);
    if (!head || head === recorded) continue;

    console.log(`\n  ⬆ HEAD moved ${recorded ? recorded.slice(0, 8) + " → " : ""}${head.slice(0, 8)}`);
    if (recorded) {
      await applyDiff(repoPath, repoName, recorded, head, baseUrl, effective);
    } else {
      // First commit after an unborn HEAD — nothing to diff from: full index.
      await indexRepo([repoPath]);
    }
    recorded = head;
    console.log("");
  }
}
