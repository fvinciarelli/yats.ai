#!/usr/bin/env node
/**
 * YATS MCP Bridge — stdio mode for Codex
 *
 * Acts as an MCP server via stdio that wraps YATS MCP tools.
 * Codex connects via: command="node", args=["bridge.cjs", "--stdio"]
 *
 * Usage:
 *   node mcp-bridge-stdio.cjs --stdio    # MCP stdio server
 *   node mcp-bridge-stdio.cjs            # HTTP proxy (existing mode)
 */

const http = require("node:http");
const https = require("node:https");
const readline = require("node:readline");

// ── Config ──────────────────────────────────────────────
const YATS_MCP_URL = process.env.YATS_MCP_URL || "http://localhost:5555/mcp";
const YATS_BRIDGE_UPSTREAM_URL = process.env.YATS_BRIDGE_UPSTREAM_URL || "https://api.deepseek.com/v1/chat/completions";
const YATS_BRIDGE_UPSTREAM_KEY = process.env.YATS_BRIDGE_UPSTREAM_KEY || process.env.DEEPSEEK_API_KEY || "";
const PORT = parseInt(process.env.YATS_BRIDGE_PORT || "8000", 10);

// ── Logger ───────────────────────────────────────────────
const log = (msg) => {
  process.stderr.write(`[bridge] ${msg}\n`);
  // Also write to file for debugging Gemini
  try { require("node:fs").appendFileSync("/tmp/gemini-bridge.log", `[${new Date().toISOString()}] ${msg}\n`); } catch {}
};

// ── MCP: fetch tools from YATS ──────────────────────────
async function fetchYatsTools() {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
  return new Promise((resolve, reject) => {
    const url = new URL(YATS_MCP_URL);
    const transport = YATS_MCP_URL.startsWith("https") ? https : http;
    const req = transport.request({
      hostname: url.hostname, port: url.port || 80, path: url.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data).result?.tools || []); }
        catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── MCP: call a YATS tool ────────────────────────────────
async function callYatsTool(name, args) {
  const body = JSON.stringify({
    jsonrpc: "2.0", id: Date.now(), method: "tools/call",
    params: { name, arguments: args },
  });
  return new Promise((resolve) => {
    const url = new URL(YATS_MCP_URL);
    const transport = YATS_MCP_URL.startsWith("https") ? https : http;
    const req = transport.request({
      hostname: url.hostname, port: url.port || 80, path: url.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        try {
          const r = JSON.parse(data);
          resolve(r.result?.content || [{ type: "text", text: JSON.stringify(r) }]);
        } catch (e) {
          resolve([{ type: "text", text: `Error: ${e.message}` }]);
        }
      });
    });
    req.on("error", (e) => resolve([{ type: "text", text: `Error: ${e.message}` }]));
    req.setTimeout(30000, () => { req.destroy(); resolve([{ type: "text", text: "Timeout" }]); });
    req.write(body);
    req.end();
  });
}

// ── OpenAI proxy (for HTTP mode) ─────────────────────────
function mapModelName(model) {
  if (YATS_BRIDGE_UPSTREAM_URL.includes("deepseek.com")) {
    const map = { "gpt-4o-mini": "deepseek-chat", "gpt-4.1-mini": "deepseek-chat", "gpt-4o": "deepseek-chat" };
    return map[model] || model;
  }
  return model;
}

async function callUpstreamOpenAI(messages, tools, model) {
  const body = JSON.stringify({
    model: mapModelName(model) || "deepseek-chat",
    messages, tools,
    tool_choice: tools.length > 0 ? "auto" : undefined,
    stream: false,
  });
  const transport = YATS_BRIDGE_UPSTREAM_URL.startsWith("https") ? https : http;
  return new Promise((resolve, reject) => {
    const url = new URL(YATS_BRIDGE_UPSTREAM_URL);
    const req = transport.request({
      hostname: url.hostname,
      port: url.port || (YATS_BRIDGE_UPSTREAM_URL.startsWith("https") ? 443 : 80),
      path: url.pathname, method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${YATS_BRIDGE_UPSTREAM_KEY}` },
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Parse error: ${e.message}`)); }
      });
    });
    req.on("error", reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.write(body);
    req.end();
  });
}

// ── stdio MCP server mode ───────────────────────────────
async function startStdio() {
  log("Starting stdio MCP server...");
  const tools = await fetchYatsTools();
  log(`Fetched ${tools.length} tools from YATS`);

  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  let initialized = false;

  rl.on("line", async (line) => {
    line = line.trim();
    if (!line) return;
    log(`RAW: ${line.slice(0, 500)}`);

    let request;
    try { request = JSON.parse(line); }
    catch (e) { log(`PARSE ERROR: ${e.message} — line: ${line.slice(0, 100)}`); return; }

    const { id, method, params } = request;
    log(`stdio: ${method} id=${id}`);

    try {
      if (method === "initialize") {
        initialized = true;
        respond({ jsonrpc: "2.0", id, result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "yats-bridge", version: "1.0.0" },
        }});
      } else if (method === "notifications/initialized") {
        // No response needed for notifications
      } else if (method === "tools/list") {
        respond({ jsonrpc: "2.0", id, result: { tools } });
      } else if (method === "tools/call") {
        const toolName = params?.name;
        const toolArgs = params?.arguments || {};
        
        // Inject default repository if missing (Gemini doesn't always pass it)
        const needsRepo = ["search_code", "find_symbol", "find_callers", "find_callees",
          "find_references", "find_implementations", "find_inheritors", "find_routes",
          "find_configuration", "expand_graph", "related_symbols", "list_symbols",
          "repository_summary", "architecture_summary"];
        if (needsRepo.includes(toolName) && !toolArgs.repository && !toolArgs.path) {
          const defaultRepo = process.env.YATS_DEFAULT_REPO || "lab_hub";
          toolArgs.repository = defaultRepo;
          log(`stdio: injected repository="${defaultRepo}"`);
        }
        
        log(`stdio tool call: ${toolName} ARGS=${JSON.stringify(toolArgs).slice(0, 300)}`);
        const result = await callYatsTool(toolName, toolArgs);
        const resultText = result.map((c) => c.text || "").join("\n");
        log(`stdio result: ${resultText.slice(0, 200)}`);
        respond({ jsonrpc: "2.0", id, result: { content: result } });
      } else if (method === "shutdown") {
        respond({ jsonrpc: "2.0", id, result: {} });
        process.exit(0);
      } else {
        respond({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${method}` } });
      }
    } catch (e) {
      log(`stdio error: ${e.message}`);
      respond({ jsonrpc: "2.0", id, error: { code: -32603, message: e.message } });
    }
  });

  process.stdin.on("end", () => { log("stdin closed"); process.exit(0); });
  log("Stdio MCP server ready");
}

function respond(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

// ── HTTP proxy mode (existing) ──────────────────────────
async function startHttp() {
  const tools = await fetchYatsTools();
  log(`Fetched ${tools.length} tools from YATS`);

  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", tools: tools.length }));
      return;
    }
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "gpt-4o-mini", object: "model" }] }));
      return;
    }
    res.writeHead(404); res.end("Not found");
  });

  server.listen(PORT, () => {
    log(`HTTP bridge listening on http://localhost:${PORT}`);
    log(`  /health — health check`);
    log(`  /v1/models — model list`);
  });
}

// ── Main ─────────────────────────────────────────────────
const mode = process.argv[2];
if (mode === "--stdio") {
  startStdio().catch((e) => { log(`FATAL: ${e.message}`); process.exit(1); });
} else {
  startHttp().catch((e) => { log(`FATAL: ${e.message}`); process.exit(1); });
}
