/**
 * yats index <path> — Index a repository by sending files to YATS server.
 * Reads each file from the host and POSTs it via HTTP.
 */
import { readFileSync, statSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const YATS_URL = process.env.YATS_URL || "http://localhost:5555";

export const IGNORED = new Set([
  "node_modules", ".git", "dist", "build", ".next", "__pycache__",
  "vendor", "target", "bin", "obj", ".venv", "venv", ".yarn", ".pnpm",
]);

async function walk(dir) {
  const files = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (IGNORED.has(e.name) || e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...await walk(full));
    } else if (e.isFile()) {
      files.push(full);
    }
  }
  return files;
}

export default async function indexRepo(args, options = {}) {
  const skipDocs = options.skipDocs || false;
  const repoPath = args[0];
  if (!repoPath) {
    console.error("Usage: npx yats index <path>");
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
  const files = await walk(repoPath);
  // Send files concurrently in batches
  const CONCURRENCY = 10;
  const batch = [];
  
  for (const file of files) {
    const relPath = relative(repoPath, file);
    if (skipDocs && relPath.endsWith(".md")) continue;
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
