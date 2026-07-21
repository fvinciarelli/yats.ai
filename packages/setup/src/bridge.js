#!/usr/bin/env node
/**
 * YATS Bridge — MCP stdio ↔ HTTP proxy
 *
 * Usage:
 *   npx yats-bridge                # defaults to localhost:5555
 *   npx yats-bridge --port 5555
 *   npx yats-bridge --url http://my-server:5555
 */

const YATS_URL = process.env.YATS_URL || "http://localhost:5555";

// Parse CLI args
const args = process.argv.slice(2);
let baseUrl = YATS_URL;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" && args[i + 1]) baseUrl = `http://localhost:${args[++i]}`;
  if (args[i] === "--url" && args[i + 1]) baseUrl = args[++i];
}

let sessionId = null;
let sseBuffer = "";

async function getSession() {
  const res = await fetch(`${baseUrl}/mcp/sse`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  // Read first SSE event to get the session endpoint
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });

    const match = sseBuffer.match(/event: endpoint\ndata: (.+)/);
    if (match) {
      const endpoint = match[1];
      sessionId = new URL(endpoint, baseUrl).searchParams.get("sessionId");
      sseBuffer = sseBuffer.slice(match.index + match[0].length);
      break;
    }
  }

  if (!sessionId) throw new Error("Failed to get SSE session");

  // Keep reading SSE in background — forward messages to stdout
  (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });

      // Extract "message" events
      const parts = sseBuffer.split("\n\n");
      sseBuffer = parts.pop() || "";

      for (const part of parts) {
        const msgMatch = part.match(/^event: message\ndata: (.+)$/m);
        if (msgMatch) {
          process.stdout.write(msgMatch[1].trim() + "\n");
        }
      }
    }
  })();
}

async function sendRequest(jsonLine) {
  if (!sessionId) await getSession();
  if (!sessionId) return;

  await fetch(`${baseUrl}/mcp/message?sessionId=${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: jsonLine,
  });
}

// Read JSON-RPC from stdin
let stdinBuffer = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", async (chunk) => {
  stdinBuffer += chunk;
  const lines = stdinBuffer.split("\n");
  stdinBuffer = lines.pop() || "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      JSON.parse(trimmed); // validate JSON
      await sendRequest(trimmed);
    } catch {
      process.stderr.write(`Bridge: invalid JSON: ${trimmed.slice(0, 100)}\n`);
    }
  }
});

process.stdin.on("end", () => {
  // Keep process alive briefly for pending SSE responses
  setTimeout(() => process.exit(0), 2000);
});
