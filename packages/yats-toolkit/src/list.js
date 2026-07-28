/**
 * yats list — List all indexed repositories via MCP
 * Thin HTTP client that calls list_repositories on the YATS MCP server.
 */
const YATS_URL = process.env.YATS_URL || "http://localhost:5555";

export default async function list() {
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
    const text = data?.result?.content?.[0]?.text;
    if (text) {
      const repos = JSON.parse(text);
      if (repos.length === 0) {
        console.log("No indexed repositories found.");
      } else {
        for (const r of repos) {
          console.log(`  ${r.name}  →  ${r.rootPath}`);
        }
      }
    } else {
      console.log("No indexed repositories found.");
    }
  } catch (err) {
    console.error(`Cannot reach YATS at ${YATS_URL}. Is it running?`);
    process.exit(1);
  }
}
