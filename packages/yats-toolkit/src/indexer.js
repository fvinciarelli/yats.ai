/**
 * yats index <path> — Index a repository by sending files to YATS server.
 * Reads each file from the host and POSTs it via HTTP.
 */
import { readFileSync, statSync, readdirSync } from "node:fs";
import { join, relative, basename, extname } from "node:path";

const YATS_URL = process.env.YATS_URL || "http://localhost:5555";

// Read configurable filters from env, with defaults
const IGNORED_DIRS = new Set(
  (process.env.IGNORED_DIRS || "node_modules,.git,dist,build,.next,__pycache__,vendor,target,bin,obj,.venv,venv,.yarn,.pnpm")
    .split(",").map(d => d.trim()).filter(Boolean)
);

const SKIP_EXTENSIONS = new Set(
  (process.env.SKIP_EXTENSIONS || "")
    .split(",").map(e => e.trim().toLowerCase()).filter(Boolean)
);

function shouldSkipFile(filePath) {
  if (SKIP_EXTENSIONS.size === 0) return false;
  const ext = extname(filePath).toLowerCase();
  // Also check compound extensions like .min.js
  const base = basename(filePath).toLowerCase();
  for (const skipExt of SKIP_EXTENSIONS) {
    if (base.endsWith(skipExt)) return true;
  }
  return false;
}

async function walk(dir) {
  const files = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (IGNORED_DIRS.has(e.name) || e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...await walk(full));
    } else if (e.isFile()) {
      if (!shouldSkipFile(full)) {
        files.push(full);
      }
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

  const repoName = basename(repoPath);
  const repoStat = statSync(repoPath);
  if (!repoStat.isDirectory()) {
    console.error(`Not a directory: ${repoPath}`);
    process.exit(1);
  }

  // Register repo
  try {
    const regRes = await fetch(`${YATS_URL}/index`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: repoPath }),
    });
    if (!regRes.ok) {
      const errBody = await regRes.text();
      console.error(`Failed to register repository: ${regRes.status} ${errBody}`);
      process.exit(1);
    }
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
  let skipped = 0;
  let errors = 0;
  const errorMessages = [];
  const total = batch.length;

  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const chunk = batch.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(async (file) => {
      const relPath = relative(repoPath, file);
      try {
        const content = readFileSync(file, "utf-8");
        // Skip binary files and files > 1MB
        if (content.includes("\0") || content.length > 1_000_000) {
          return { status: "skipped", file: relPath, reason: "binary or too large" };
        }
        const res = await fetch(`${YATS_URL}/index/file`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoName, filePath: relPath, content }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok) {
          // Server may return { ok: true, status: "skipped" } for unsupported files
          if (body.status === "skipped") {
            return { status: "skipped", file: relPath, reason: body.reason || "unsupported" };
          }
          return { status: "indexed", file: relPath };
        } else {
          const errMsg = body.error || `HTTP ${res.status}`;
          return { status: "error", file: relPath, reason: errMsg };
        }
      } catch (err) {
        return { status: "error", file: relPath, reason: err.message };
      }
    }));
    
    for (const r of results) {
      if (r.status === "indexed") sent++;
      else if (r.status === "skipped") skipped++;
      else {
        errors++;
        errorMessages.push(`  ${r.file}: ${r.reason}`);
      }
    }
    process.stdout.write(`\r  ${sent + skipped + errors}/${total} files`);
  }

  // Summary
  console.log(`\r  ✓ ${sent} indexed, ${skipped} skipped${errors > 0 ? `, ${errors} errors` : ""}`);
  if (errorMessages.length > 0) {
    console.log("");
    console.log(`  Errors:`);
    for (const msg of errorMessages.slice(0, 20)) {
      console.log(msg);
    }
    if (errorMessages.length > 20) {
      console.log(`  ... and ${errorMessages.length - 20} more errors`);
    }
  }
  console.log("");

  if (errors > 0) {
    process.exit(1);
  }
}
