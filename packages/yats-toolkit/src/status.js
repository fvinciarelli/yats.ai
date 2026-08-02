/** yats status — Check indexed repos via YATS MCP */
import { spawn } from "node:child_process";

const YATS_URL = process.env.YATS_URL || "http://localhost:5555";

export default async function status() {
  // Check Docker status
  try {
    const res = await fetch(`${YATS_URL}/health`);
    const data = await res.json();
    console.log(`  YATS: ${data.status} (sessions: ${data.sessions || 0})`);
  } catch {
    console.log("  YATS: not running");
    console.log(`  Start with: npx yats setup`);
    return;
  }

  // Get repos via MCP
  try {
    const res = await fetch(`${YATS_URL}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_repositories", arguments: {} },
      }),
    });
    const data = await res.json();
    const repos = JSON.parse(data?.result?.content?.[0]?.text || "[]");
    if (repos.length === 0) {
      console.log("  No indexed repositories.");
    } else {
      console.log("  Indexed repositories:");
      for (const r of repos) {
        console.log(`    ${r.name}  →  ${r.rootPath}`);
      }
    }
  } catch {
    console.log("  Could not fetch repository list.");
  }
}
