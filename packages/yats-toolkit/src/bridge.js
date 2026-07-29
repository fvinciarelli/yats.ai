#!/usr/bin/env node
/**
 * YATS Bridge — MCP stdio ↔ YATS HTTP proxy
 *
 * Acts as a local MCP server over stdio that wraps YATS MCP tools.
 * Used by AI agents (Copilot, Gemini, Codex, Claude) to connect to YATS.
 *
 * Usage:
 *   yats bridge                          # default: localhost:5555
 *   yats bridge --port 5555
 *   yats bridge --url http://my-server:5555
 *
 * Agent configs:
 *   Copilot:  { "type": "local", "command": "node", "args": ["bridge.cjs", "--stdio"] }
 *   Gemini:   { "command": "node", "args": ["bridge.cjs", "--stdio"], "trust": true }
 *   Codex:    command = "node", args = ["bridge.cjs", "--stdio"]
 *   Claude:   { "command": "node", "args": ["bridge.cjs", "--stdio"] }
 */

import http from "node:http";
import https from "node:https";
import { createInterface } from "node:readline";
import { basename } from "node:path";

// ── Config ──────────────────────────────────────────────
let yatsUrl = process.env.YATS_URL || "http://localhost:5555";

// Parse CLI args
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" && args[i + 1]) {
    yatsUrl = `http://localhost:${args[++i]}`;
  } else if (args[i] === "--url" && args[i + 1]) {
    yatsUrl = args[++i];
  }
}

const YATS_MCP_URL = yatsUrl.endsWith("/mcp") ? yatsUrl : yatsUrl + "/mcp";

// Default repo: env var > cwd basename
const DEFAULT_REPO = process.env.YATS_DEFAULT_REPO || basename(process.cwd());

// Tools that require a repository parameter
const REPO_TOOLS = new Set([
  "search_code", "find_symbol", "find_callers", "find_callees",
  "find_references", "find_implementations", "find_inheritors", "find_routes",
  "find_configuration", "expand_graph", "related_symbols", "list_symbols",
  "repository_summary", "architecture_summary", "search_similar",
]);

// ── Logger ───────────────────────────────────────────────
const log = (msg) => process.stderr.write(`[yats-bridge] ${msg}\n`);

// ── HTTP helpers ─────────────────────────────────────────
function post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const transport = u.protocol === "https:" ? https : http;
    const req = transport.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Parse error: ${e.message}`)); }
      });
    });
    req.on("error", reject);
    req.setTimeout(30_000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.write(JSON.stringify(body));
    req.end();
  });
}

// ── MCP operations ───────────────────────────────────────
async function fetchTools() {
  const r = await post(YATS_MCP_URL, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
  return r.result?.tools || [];
}

async function callTool(name, args) {
  const r = await post(YATS_MCP_URL, {
    jsonrpc: "2.0", id: Date.now(), method: "tools/call",
    params: { name, arguments: args },
  });
  return r.result?.content || [{ type: "text", text: JSON.stringify(r) }];
}

// ── stdio MCP server ─────────────────────────────────────
async function start() {
  log(`Connecting to ${YATS_MCP_URL}...`);
  const tools = await fetchTools();
  log(`Fetched ${tools.length} tools — default repo: "${DEFAULT_REPO}"`);

  const rl = createInterface({ input: process.stdin, terminal: false });
  let pending = 0;
  let stdinClosed = false;

  const checkDone = () => {
    if (stdinClosed && pending === 0) {
      log("All done, exiting.");
      process.exit(0);
    }
  };

  rl.on("line", (line) => {
    line = line.trim();
    if (!line) return;
    pending++;

    handleLine(line).finally(() => {
      pending--;
      checkDone();
    });
  });

  async function handleLine(line) {
    let request;
    try { request = JSON.parse(line); }
    catch { return; }

    const { id, method, params } = request;

    try {
      if (method === "initialize") {
        respond({ jsonrpc: "2.0", id, result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "yats-bridge", version: "1.0.0" },
        }});
      } else if (method === "notifications/initialized") {
        // No response needed
      } else if (method === "tools/list") {
        respond({ jsonrpc: "2.0", id, result: { tools } });
      } else if (method === "tools/call") {
        const toolName = params?.name;
        const toolArgs = params?.arguments || {};

        // Auto-inject repository if missing
        if (REPO_TOOLS.has(toolName) && !toolArgs.repository && !toolArgs.path) {
          toolArgs.repository = DEFAULT_REPO;
        }

        log(`call: ${toolName}(${JSON.stringify(toolArgs).slice(0, 200)})`);
        const content = await callTool(toolName, toolArgs);
        const text = content.map((c) => c.text || "").join("\n");

        // structuredContent fixes Gemini CLI compatibility
        respond({ jsonrpc: "2.0", id, result: {
          content,
          structuredContent: { result: text },
        }});
      } else if (method === "shutdown") {
        respond({ jsonrpc: "2.0", id, result: {} });
        stdinClosed = true;
        checkDone();
      } else {
        respond({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown: ${method}` } });
      }
    } catch (e) {
      log(`error: ${e.message}`);
      respond({ jsonrpc: "2.0", id, error: { code: -32603, message: e.message } });
    }
  }

  process.stdin.on("end", () => {
    stdinClosed = true;
    checkDone();
  });

  log("Ready — waiting for MCP client on stdio");
}

function respond(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

// ── Main ─────────────────────────────────────────────────
start().catch((e) => { log(`FATAL: ${e.message}`); process.exit(1); });
