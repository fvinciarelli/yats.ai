#!/usr/bin/env node
/**
 * yats watch — file watcher that keeps the YATS index in sync with live edits.
 *
 * Usage:
 *   yats watch <path> [--repo <name>]
 *
 * Zero dependencies — uses Node.js built-in fs.watch and http.
 */

import { watch, statSync, readFileSync } from "node:fs";
import { resolve, basename, relative } from "node:path";
import { request } from "node:http";

// ============================================================
// Config
// ============================================================

const YATS_URL = process.env.YATS_URL ?? "http://localhost:5555";
const DEBOUNCE_MS = parseInt(process.env.YATS_WATCH_DEBOUNCE ?? "500", 10);

const repoPath = resolve(process.argv[2] ?? process.cwd());
const repoArgIdx = process.argv.indexOf("--repo");
const repoName = repoArgIdx >= 0 ? process.argv[repoArgIdx + 1] : basename(repoPath);

if (!process.argv[2]) {
  console.log("Usage: yats watch <path> [--repo <name>]");
  console.log("");
  console.log("Watches a directory and keeps the YATS index in sync.");
  console.log("When files change, it tells the YATS server to re-index them.");
  console.log("");
  console.log("  yats watch ~/my-project");
  console.log("  yats watch ~/my-project --repo my-api");
  process.exit(1);
}

// ============================================================
// HTTP helpers
// ============================================================

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(path, YATS_URL);
    const req = request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            resolve(body);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function indexFile(filePath) {
  const rel = relative(repoPath, filePath);
  console.log(`  ↻ Indexing: ${rel}`);
  try {
    const content = readFileSync(filePath, "utf-8");
    await post("/index/file", { path: filePath, content, repository: repoName });
    console.log(`  ✓ Done: ${rel}`);
  } catch (err) {
    console.error(`  ✗ Failed: ${rel} — ${err.message}`);
  }
}

async function removeFile(filePath) {
  const rel = relative(repoPath, filePath);
  console.log(`  ↻ Removing from index: ${rel}`);
  try {
    await post("/index/remove", { path: filePath, repository: repoName });
    console.log(`  ✓ Removed: ${rel}`);
  } catch (err) {
    console.error(`  ✗ Failed: ${rel} — ${err.message}`);
  }
}

// ============================================================
// Debounced watcher
// ============================================================

const pending = new Map();
const SKIP_PATTERNS = [
  /node_modules/,
  /\.git\//,
  /vendor\//,
  /__pycache__/,
  /\.next\//,
  /dist\//,
  /\.yarn\//,
];

function shouldSkip(filename) {
  if (!filename || filename.startsWith(".")) return true;
  return SKIP_PATTERNS.some((p) => p.test(filename));
}

console.log(`👀 Watching: ${repoPath}`);
console.log(`   Repo: ${repoName}`);
console.log(`   Server: ${YATS_URL}`);
console.log(`   (debounce: ${DEBOUNCE_MS}ms)`);
console.log("");

watch(repoPath, { recursive: true }, (eventType, filename) => {
  if (!filename || shouldSkip(filename)) return;

  const fullPath = resolve(repoPath, filename);

  // Debounce: group rapid changes to the same file
  const existing = pending.get(fullPath);
  if (existing) clearTimeout(existing);

  pending.set(
    fullPath,
    setTimeout(async () => {
      pending.delete(fullPath);

      // Check if file still exists (or was deleted)
      try {
        statSync(fullPath);
        await indexFile(fullPath);
      } catch {
        await removeFile(fullPath);
      }
    }, DEBOUNCE_MS),
  );
});

// Keep the process alive
process.stdin.resume();

// Clean shutdown
process.on("SIGINT", () => {
  console.log("\n👋 Stopped watching.");
  process.exit(0);
});
