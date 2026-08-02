/**
 * yats search <query> — Search code via MCP
 * Thin HTTP client that calls search_code on the YATS MCP server.
 */
const YATS_URL = process.env.YATS_URL || "http://localhost:5555";

export default async function search(args) {
  const repo = args.find(a => a.startsWith("--repo="))?.split("=")[1] || "";
  const limit = parseInt(args.find(a => a.startsWith("--limit="))?.split("=")[1] || "10", 10);
  const cleanArgs = args.filter(a => !a.startsWith("--"));
  const query = cleanArgs.join(" ");

  if (!query) {
    console.error("Usage: yats search <query> [--repo=<name>] [--limit=<n>]");
    process.exit(1);
  }

  try {
    const res = await fetch(`${YATS_URL}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "search_code",
          arguments: { query, repository: repo || undefined, limit },
        },
      }),
    });
    const data = await res.json();
    const text = data?.result?.content?.[0]?.text;
    if (text) {
      const results = JSON.parse(text);
      if (Array.isArray(results) && results.length > 0) {
        console.log(`Found ${results.length} results:\n`);
        for (const r of results) {
          console.log(`  ${r.kind?.toUpperCase() ?? "?"} ${r.name}`);
          console.log(`    File: ${r.file}:${r.line}`);
          console.log(`    Score: ${(r.score ?? 0).toFixed(2)} (${r.source ?? "vector"})`);
          if (r.reason) console.log(`    Reason: ${r.reason}`);
          if (r.snippet) console.log(`    ${r.snippet.slice(0, 200)}`);
          console.log("");
        }
      } else {
        console.log("No results found.");
      }
    } else {
      console.log("No results found.");
    }
  } catch (err) {
    console.error(`Cannot reach YATS at ${YATS_URL}. Is it running?`);
    process.exit(1);
  }
}
