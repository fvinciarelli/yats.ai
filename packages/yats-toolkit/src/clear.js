/**
 * yats clear <repository> — Delete indexed data via MCP
 * Thin HTTP client that calls delete_repository on the YATS MCP server.
 * Uses two-step confirmation flow.
 */
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

export default async function clear(args) {
  const repo = args[0];
  if (!repo) {
    console.error("Usage: yats clear <repository>");
    process.exit(1);
  }

  try {
    // Step 1: ask for confirmation
    console.log(`Fetching info for "${repo}"...`);
    const warning = await mcpCall("delete_repository", { repository: repo });
    console.log(warning);
    console.log("");

    // Step 2: confirm via stdin
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
    const result = await mcpCall("delete_repository", { repository: repo, confirm: true });
    console.log(result);
    console.log("");
  } catch (err) {
    console.error(`Cannot reach YATS at ${YATS_URL}. Is it running?`);
    process.exit(1);
  }
}
