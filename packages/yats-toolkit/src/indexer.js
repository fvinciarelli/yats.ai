/**
 * yats index <path> [--skip-docs] [--no-config] — Index a repository by
 * sending files to YATS server. Reads each file from the host and POSTs it
 * via HTTP.
 *
 * --skip-docs: skip documentation files (DOC_EXTENSIONS, default .md/.mdx/
 * .rst/.txt/.adoc/.org/.wiki/.readme) instead of only .md files.
 * --no-config: ignore the repo's .yats/config.json and use machine defaults.
 *
 * Per-repo config (`.yats/config.json`, all keys optional):
 *
 *   {
 *     "indexDocs": false,                        // skip ALL docs for this repo
 *     "docExtensions": [".md"],                 // REPLACES the machine's DOC_EXTENSIONS
 *     "docPatterns": ["docs/", "README.md"],     // whitelist: only these doc files are sent
 *     "ignoredDirs": ["sandbox"],                // ADDED to the machine's IGNORED_DIRS
 *     "skipExtensions": [".snap"]                // ADDED to the machine's SKIP_EXTENSIONS
 *   }
 */
import { readFileSync, statSync, readdirSync, readSync } from "node:fs";
import { join, relative } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const YATS_URL = process.env.YATS_URL || "http://localhost:5555";

const CONFIG_SCHEMA_HINT = `{
  "indexDocs": false,
  "docExtensions": [".md"],
  "docPatterns": ["docs/", "README.md"],
  "ignoredDirs": ["sandbox"],
  "skipExtensions": [".snap"]
}`;

export const IGNORED = new Set([
  "node_modules", ".git", "dist", "build", ".next", "__pycache__",
  "vendor", "target", "bin", "obj", ".venv", "venv", ".yarn", ".pnpm",
]);

export const DEFAULT_DOC_EXTENSIONS = ".md,.mdx,.rst,.txt,.adoc,.org,.wiki,.readme";

/**
 * Read the YATS config written by `yats setup` (~/.yats/.env), so the CLI
 * filters files consistently with the server (DOC_EXTENSIONS, SKIP_EXTENSIONS,
 * IGNORED_DIRS). Accepts an explicit path for tests.
 */
export function loadYatsEnv(envPath = null) {
  const file = envPath ?? join(homedir(), ".yats", ".env");
  const env = {};
  try {
    for (const line of readFileSync(file, "utf-8").split("\n")) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2];
    }
  } catch {
    // No .env — use built-in defaults.
  }
  return env;
}

/**
 * Decide whether a repository-relative path must be skipped client-side.
 * Pure helper (exported for tests):
 *  - skipDocs: drop files whose extension is in docExtensions
 *  - skipExtensions: drop files ending with any of these suffixes
 *  - docPatterns (prefix whitelist): when set, doc files are only sent if
 *    their path starts with one of the prefixes (code files always sent)
 */
export function shouldSkipFile(
  relPath,
  { skipDocs = false, docExtensions = [], skipExtensions = [], docPatterns = null } = {},
) {
  const lower = relPath.toLowerCase();
  const isDoc = docExtensions.some((e) => lower.endsWith(e));
  if (isDoc) {
    if (skipDocs) return true;
    if (docPatterns && !docPatterns.some((p) => relPath.startsWith(p))) return true;
  }
  if (skipExtensions.some((e) => lower.endsWith(e))) return true;
  return false;
}

// ============================================================
// Per-repo config — .yats/config.json (P6)
// ============================================================

/** Validate a parsed repo config. Returns {ok:false,error} with a human
 * (and AI-agent) readable explanation of what is wrong. */
export function validateRepoConfig(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `not valid JSON: ${err.message}` };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, error: "must be a JSON object (not an array or a plain value)" };
  }
  const errors = [];
  if (data.indexDocs !== undefined && typeof data.indexDocs !== "boolean") {
    errors.push('"indexDocs" must be true or false');
  }
  for (const key of ["docExtensions", "docPatterns", "ignoredDirs", "skipExtensions"]) {
    if (data[key] !== undefined && (!Array.isArray(data[key]) || !data[key].every((v) => typeof v === "string"))) {
      errors.push(`"${key}" must be an array of strings`);
    }
  }
  if (errors.length > 0) return { ok: false, error: errors.join("; ") };
  return { ok: true, config: data };
}

/**
 * Load and validate the repo's .yats/config.json.
 * Returns { ok:true, config, path, exists } or { ok:false, error, path, exists }.
 * A missing file is NOT an error — machine defaults apply.
 */
export function loadRepoConfig(repoPath) {
  const configPath = join(repoPath, ".yats", "config.json");
  let raw;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch {
    return { ok: true, config: {}, path: configPath, exists: false };
  }
  const result = validateRepoConfig(raw);
  return { ...result, path: configPath, exists: true };
}

/**
 * Merge the machine config (~/.yats/.env) with the repo config.
 * Rule: a repo can only NARROW what the machine allows — ignoredDirs and
 * skipExtensions are UNIONs, docExtensions REPLACES the global list, and
 * indexDocs=false can only turn docs off (never on, if the machine forbids).
 */
export function mergeRepoConfig(globalEnv, repoConfig) {
  const toList = (v) => v.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

  const docExtensions = Array.isArray(repoConfig.docExtensions)
    ? repoConfig.docExtensions.map((e) => e.trim().toLowerCase()).filter(Boolean)
    : toList(globalEnv.DOC_EXTENSIONS ?? DEFAULT_DOC_EXTENSIONS);

  return {
    docExtensions,
    skipExtensions: [
      ...toList(globalEnv.SKIP_EXTENSIONS ?? ""),
      ...(Array.isArray(repoConfig.skipExtensions) ? repoConfig.skipExtensions : []),
    ],
    ignoredDirs: [
      ...toList(globalEnv.IGNORED_DIRS ?? ""),
      ...(Array.isArray(repoConfig.ignoredDirs) ? repoConfig.ignoredDirs : []),
    ],
    docPatterns: Array.isArray(repoConfig.docPatterns) ? repoConfig.docPatterns : null,
    indexDocs: repoConfig.indexDocs !== false,
  };
}

/**
 * The message printed when .yats/config.json is invalid. Written for BOTH
 * humans and AI agents running `yats index`: it explains what is wrong, why
 * indexing stopped (a broken filter could index something huge), and the
 * three ways out (fix + re-run, delete the file, or --no-config).
 */
export function configErrorText(repoPath, configPath, error) {
  return [
    `✗ Invalid repo config: ${configPath}`,
    ``,
    `  ${error}`,
    ``,
    `  Indexing stopped before reading any file. A broken config could mean`,
    `  wrong filters (e.g. indexing a huge folder that was meant to be ignored).`,
    ``,
    `  How to fix — pick ONE:`,
    ``,
    `  1. Correct ${configPath} (valid JSON, schema below) and re-run:`,
    ``,
    `       yats index ${repoPath}`,
    ``,
    `  2. Delete the file to fall back to the machine defaults (~/.yats/.env).`,
    ``,
    `  3. Re-run with --no-config to ignore the file for this run only:`,
    ``,
    `       yats index ${repoPath} --no-config`,
    ``,
    `  Valid schema (every key is optional):`,
    ``,
    ...CONFIG_SCHEMA_HINT.split("\n").map((l) => `    ${l}`),
    ``,
    `  Semantics: ignoredDirs/skipExtensions ADD to the machine config;`,
    `  docExtensions REPLACES it; docPatterns whitelists which doc files are`,
    `  sent (prefix match); indexDocs=false skips all docs for this repo.`,
  ].join("\n");
}

function promptYesNo(question) {
  process.stdout.write(question);
  try {
    const buf = Buffer.alloc(16);
    const n = readSync(0, buf, 0, 16);
    return buf.toString("utf-8", 0, n).trim().toLowerCase() === "y";
  } catch {
    return false;
  }
}

/**
 * Resolve the repo config, stopping the run on a malformed file.
 * - Non-TTY (the normal case — an AI agent runs yats): exit 1 with the
 *   configErrorText so the agent can fix the file and re-run.
 * - TTY (a human): ask whether to open $EDITOR to fix it, re-validate and
 *   retry in a loop until valid or declined.
 */
export function resolveRepoConfig(repoPath, noConfig = false) {
  if (noConfig) return {};
  for (;;) {
    const res = loadRepoConfig(repoPath);
    if (res.ok) return res.config;

    console.error(configErrorText(repoPath, res.path, res.error));

    if (!process.stdin.isTTY) process.exit(1);

    const editor = process.env.EDITOR || process.env.VISUAL || "vi";
    const answer = promptYesNo(`\n  Open ${editor} to fix it and retry? [y/N] `);
    if (!answer) process.exit(1);
    spawnSync(editor, [res.path], { stdio: "inherit" });
    console.log("  Re-reading the config...");
  }
}


async function walk(dir, ignored) {
  const files = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (ignored.has(e.name) || e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...await walk(full, ignored));
    } else if (e.isFile()) {
      files.push(full);
    }
  }
  return files;
}

export default async function indexRepo(args, options = {}) {
  const skipDocsFlag = options.skipDocs || false;
  const noConfig = options.noConfig || false;
  const repoPath = args[0];
  if (!repoPath) {
    console.error("Usage: npx yats index <path> [--skip-docs] [--no-config]");
    process.exit(1);
  }

  // The repository identity is its full path (two clones of the same repo are
  // two distinct indexes) — never the basename.
  const repoName = repoPath;
  let stat;
  try {
    stat = statSync(repoPath);
  } catch {
    console.error(`Path not found: ${repoPath}`);
    process.exit(1);
  }
  if (!stat.isDirectory()) {
    console.error(`Not a directory: ${repoPath}`);
    process.exit(1);
  }

  // P4/P6 — machine config (~/.yats/.env) + repo config (.yats/config.json).
  // A malformed repo config STOPS the run (never index with broken filters).
  const yatsEnv = loadYatsEnv();
  const repoConfig = resolveRepoConfig(repoPath, noConfig);
  const effective = mergeRepoConfig(yatsEnv, repoConfig);
  const skipDocs = skipDocsFlag || effective.indexDocs === false;
  const ignoredDirs = new Set([...IGNORED, ...effective.ignoredDirs]);

  // Register repo
  try {
    await fetch(`${YATS_URL}/index`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: repoPath }),
    });
  } catch {
    console.error(`Cannot reach YATS at ${YATS_URL}. Is it running?`);
    process.exit(1);
  }

  // Walk and send files
  console.log(`Indexing ${repoPath}...`);
  const files = await walk(repoPath, ignoredDirs);
  // Send files concurrently in batches
  const CONCURRENCY = 10;
  const batch = [];

  for (const file of files) {
    const relPath = relative(repoPath, file);
    if (shouldSkipFile(relPath, {
      skipDocs,
      docExtensions: effective.docExtensions,
      skipExtensions: effective.skipExtensions,
      docPatterns: effective.docPatterns,
    })) continue;
    batch.push(file);
  }

  let sent = 0;
  let errors = 0;
  const total = batch.length;

  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const chunk = batch.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(async (file) => {
      const relPath = relative(repoPath, file);
      try {
        const content = readFileSync(file, "utf-8");
        if (content.includes("\0") || content.length > 1_000_000) return { ok: true, skipped: true };
        const res = await fetch(`${YATS_URL}/index/file`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoName, filePath: relPath, content }),
        });
        return { ok: res.ok, skipped: false };
      } catch {
        return { ok: false, skipped: false };
      }
    }));
    
    for (const r of results) {
      if (r.ok) sent++;
      else if (!r.skipped) errors++;
    }
    process.stdout.write(`\r  ${sent + errors}/${total} files`);
  }
  console.log(`\r  ✓ ${sent} files indexed${errors > 0 ? `, ${errors} skipped` : ""}`);

  // Finalize: resolve cross-file references and store relationships.
  // The server also flushes automatically after a quiet period, but an
  // explicit call makes the graph available immediately.
  try {
    const res = await fetch(`${YATS_URL}/index/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repository: repoName }),
    });
    const data = await res.json();
    if (res.ok) {
      console.log(`  ✓ Graph finalized (${data.stored} relationships in final flush)`);
    }
  } catch {
    // Non-fatal — the server flushes on its own debounce timer.
  }

  // Record the indexed commit so `yats watch` knows where to start diffing
  // from (P1: the index reflects the last commit, not the last save).
  try {
    const { execSync } = await import("node:child_process");
    const commit = execSync("git rev-parse HEAD", {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
    if (commit) {
      await fetch(`${YATS_URL}/index/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repository: repoName, commit }),
      });
      console.log(`  ✓ Indexed commit recorded: ${commit.slice(0, 8)}`);
    }
  } catch {
    // Not a git repo (or server unreachable) — watch will handle it.
  }

  // Report the real totals from the graph. The server flushes incrementally
  // while files stream in, so the final flush above may report 0 even though
  // thousands of relationships are already stored.
  try {
    const res = await fetch(`${YATS_URL}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "repository_summary", arguments: { path: repoName } },
      }),
    });
    const data = await res.json();
    const text = data?.result?.content?.[0]?.text;
    if (text) {
      const summary = JSON.parse(text);
      console.log(`  ✓ Indexed ${summary.totalSymbols} symbols, ${summary.totalRelationships} relationships`);
    }
  } catch {
    // Non-fatal — summary is informational.
  }
  console.log(``);
}
