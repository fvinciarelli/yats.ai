/**
 * yats index <path> — Index a repository by sending files to YATS server.
 * Reads each file from the host and POSTs it via HTTP.
 */
import { readFileSync, statSync, readdirSync } from "node:fs";
import { join, relative, basename } from "node:path";

const YATS_URL = process.env.YATS_URL || "http://localhost:5555";

const IGNORED = new Set([
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

  const repoName = basename(repoPath);
  const stat = statSync(repoPath);
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
  let sent = 0;
  let errors = 0;

  for (const file of files) {
    const relPath = relative(repoPath, file);

    // Skip docs if requested
    if (skipDocs && relPath.endsWith(".md")) continue;

    try {
      const content = readFileSync(file, "utf-8");
      // Skip binary/large files
      if (content.includes("\0") || content.length > 1_000_000) continue;

      const res = await fetch(`${YATS_URL}/index/file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoName, filePath: relPath, content }),
      });
      if (res.ok) {
        sent++;
        process.stdout.write(`\r  ${sent}/${files.length} files`);
      } else {
        errors++;
      }
    } catch {
      errors++;
    }
  }
  console.log(`\r  ✓ ${sent} files indexed${errors > 0 ? `, ${errors} skipped` : ""}`);
  console.log(``);
}
