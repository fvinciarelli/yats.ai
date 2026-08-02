/**
 * yats summary <repository> — Show repository summary via MCP
 * Thin HTTP client that calls repository_summary on the YATS MCP server.
 */
const YATS_URL = process.env.YATS_URL || "http://localhost:5555";

export default async function summary(args) {
  const repo = args[0];
  if (!repo) {
    console.error("Usage: yats summary <repository>");
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
          name: "repository_summary",
          arguments: { repository: repo },
        },
      }),
    });
    const data = await res.json();
    const text = data?.result?.content?.[0]?.text;
    if (text) {
      console.log(text);
    } else {
      console.log(`No summary available for "${repo}".`);
    }
  } catch (err) {
    console.error(`Cannot reach YATS at ${YATS_URL}. Is it running?`);
    process.exit(1);
  }
}
