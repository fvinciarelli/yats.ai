// Cliente SSE mínimo para consultar tools del server YATS (Streamable HTTP).
const BASE = process.env.YATS_URL ?? "http://localhost:5556";
const TOOL = process.env.TOOL ?? "repository_summary";
const ARGS = JSON.parse(process.env.ARGS ?? "{}");
const sessionId = crypto.randomUUID();

const ctrl = new AbortController();
const sseRes = await fetch(`${BASE}/mcp/sse?sessionId=${sessionId}`, { signal: ctrl.signal });
const reader = sseRes.body.getReader();
const decoder = new TextDecoder();
let buf = "";

const responsePromise = new Promise((resolve, reject) => {
  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
          if (dataLine) {
            const data = dataLine.slice(6);
            if (data.startsWith("{")) {
              try { resolve(JSON.parse(data)); return; } catch { /* keep looking */ }
            }
          }
        }
      }
    } catch (e) { reject(e); }
  })();
});

const postRes = await fetch(`${BASE}/mcp/message?sessionId=${sessionId}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: TOOL, arguments: ARGS } }),
});
await postRes.text();

const res = await Promise.race([
  responsePromise,
  new Promise((_, rej) => setTimeout(() => rej(new Error("timeout esperando respuesta SSE")), 20000)),
]);
ctrl.abort();
console.log(JSON.stringify(res, null, 2));
