/**
 * yats reindex --rebuild-vectors — Rebuild the vector index (re-embed all symbols).
 * Thin HTTP client that POSTs to /reindex on the YATS server.
 *
 * ⚠️ Re-embedding calls the embedding API and may cost money. This is a
 * user-initiated command — run it only after changing the embedding provider
 * or model to a different vector dimension.
 */
const YATS_URL = process.env.YATS_URL || "http://localhost:5555";

export default async function reindex(args = []) {
  if (!args.includes("--rebuild-vectors")) {
    console.log("Usage: yats reindex --rebuild-vectors");
    console.log("");
    console.log("  --rebuild-vectors   Re-embed every indexed symbol with the current embedding model.");
    console.log("                      This may incur API costs. Use it after changing the embedding");
    console.log("                      provider or model (different vector dimension).");
    process.exit(1);
  }

  console.log("Rebuilding vector index... (this may take a while and may incur API costs)");
  try {
    const res = await fetch(`${YATS_URL}/reindex`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`Rebuild failed (${res.status}): ${data?.error ?? "unknown error"}`);
      process.exit(1);
    }
    console.log("");
    console.log(`  ✓ ${data.symbols} symbols re-embedded across ${data.repositories} repositories${data.errors ? ` (${data.errors} errors)` : ""}`);
    console.log("");
  } catch {
    console.error(`Cannot reach YATS at ${YATS_URL}. Is it running?`);
    process.exit(1);
  }
}
