/**
 * yats remove <path> — Delete a repository from the index by its path.
 * Wraps the MCP delete_repository tool, accepting a directory path
 * instead of requiring the exact repo name.
 */
import { resolve } from "node:path";

const YATS_URL = process.env.YATS_URL || "http://localhost:5555";

async function mcpCall(tool, args = {}) {
  const res = await fetch(`${YATS_URL}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: tool, arguments: args },
    }),
  });
  const data = await res.json();
  return data?.result?.content?.[0]?.text;
}

export default async function remove(args) {
  const rawPath = args[0];
  if (!rawPath) {
    console.error("Usage: yats remove <path>");
    process.exit(1);
  }

  const repoPath = resolve(rawPath);

  try {
    // Step 1: ask for confirmation (using path, server resolves to repo)
    console.log(`Looking up "${repoPath}"...`);
    const warning = await mcpCall("delete_repository", { path: repoPath });
    console.log(warning);
    console.log("");

    // Step 2: confirm
    const readline = await import("node:readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) => rl.question("  Confirm deletion? [y/N] ", resolve));
    rl.close();

    if (answer.toLowerCase() !== "y") {
      console.log("Cancelled.");
      process.exit(0);
    }

    // Step 3: execute
    console.log("Deleting...");
    const result = await mcpCall("delete_repository", { path: repoPath, confirm: true });
    console.log(result);
    console.log("");
  } catch (err) {
    console.error(`Cannot reach YATS at ${YATS_URL}. Is it running?`);
    process.exit(1);
  }
}
