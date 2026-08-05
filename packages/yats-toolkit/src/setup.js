/**
 * YATS Setup — One-command wizard to get YATS running on your machine.
 *
 * Usage:
 *   npx yats-toolkit
 *   curl -fsSL https://get.yats.site | bash
 *
 * Requirements: Docker (with compose plugin)
 */

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync, statSync, chmodSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

// ============================================================
// Constants
// ============================================================

// Read version from package.json dynamically
let YATS_VERSION = "0.1.0";
try {
  const pkgPath = new URL("../package.json", import.meta.url);
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  YATS_VERSION = pkg.version || YATS_VERSION;
} catch {}
const YATS_DIR = join(homedir(), ".yats");
const REPOS_DIR = join(YATS_DIR, "repos");
const COMPOSE_FILE = join(YATS_DIR, "docker-compose.yml");
const MCP_CONFIG_FILE = join(YATS_DIR, "mcp-config.json");
const YATS_BIN_DIR = join(YATS_DIR, "bin");

const GITHUB_COMPOSE_URL =
  "https://raw.githubusercontent.com/fvinciarelli/yats.ai/main/docker/docker-compose.yml";

const B = "\x1b[1m";
const D = "\x1b[2m";
const R = "\x1b[0m";
const G = "\x1b[32m";
const Y = "\x1b[33m";
const C = "\x1b[36m";
const RED = "\x1b[31m";

// Minimal embedded docker-compose as fallback
const EMBEDDED_COMPOSE = `services:
  neo4j:
    image: neo4j:5.26-community
    expose: ["7474", "7687"]
    environment:
      - NEO4J_AUTH=neo4j/\${NEO4J_PASSWORD:-password}
      - NEO4J_apoc_export_file_enabled=true
      - NEO4J_apoc_import_file_enabled=true
      - NEO4J_apoc_import_file_use__neo4j__config=true
      - NEO4J_PLUGINS=["apoc"]
      - NEO4J_server_memory_heap_initial__size=512m
      - NEO4J_server_memory_heap_max__size=1g
    volumes:
      - neo4j-data:/data
      - neo4j-logs:/logs
    healthcheck:
      test: ["CMD-SHELL", "echo 'RETURN 1;' | cypher-shell -u neo4j -p \${NEO4J_PASSWORD:-password} 2>/dev/null || exit 1"]
      interval: 10s
      timeout: 10s
      retries: 10
      start_period: 30s
    restart: unless-stopped
  qdrant:
    image: qdrant/qdrant:latest
    expose: ["6333", "6334"]
    volumes:
      - qdrant-storage:/qdrant/storage
    environment:
      - QDRANT__SERVICE__GRPC_PORT=6334
      - QDRANT__SERVICE__HTTP_PORT=6333
    healthcheck:
      test: ["CMD-SHELL", "timeout 1 bash -c 'cat < /dev/null > /dev/tcp/localhost/6333' 2>/dev/null || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 5s
    restart: unless-stopped
  __OLLAMA_PLACEHOLDER__
  yats:
    image: ghcr.io/fvinciarelli/yats.ai:latest
    ports: ["__MCP_PORT__:__MCP_PORT__"]
    environment:
      - NEO4J_URI=bolt://neo4j:7687
      - NEO4J_USER=neo4j
      - NEO4J_PASSWORD=\${NEO4J_PASSWORD:-password}
      - QDRANT_URL=http://qdrant:6333
      - EMBEDDING_PROVIDER=__PROVIDER__
      - OLLAMA_URL=http://ollama:11434
      - OLLAMA_MODEL=__OLLAMA_MODEL__
      - OPENAI_API_KEY=__OPENAI_KEY__
      - MISTRAL_API_KEY=__MISTRAL_KEY__
      - VOYAGE_API_KEY=__VOYAGE_KEY__
      - REPOSITORIES_PATH=/repos
      - YATS_PORT=__MCP_PORT__
      - EMBEDDING_BATCH_SIZE=__BATCH_SIZE__
      - INDEX_DOCS=__INDEX_DOCS__
      - DOC_MAX_FILES=__DOC_MAX__
      - LOG_LEVEL=info
    volumes:
      - \${REPOS_PATH:-~/.yats/repos}:/repos:ro
    depends_on:
      neo4j:
        condition: service_healthy
      qdrant:
        condition: service_healthy
    restart: unless-stopped
volumes:
  neo4j-data:
  neo4j-logs:
  qdrant-storage:
`;

const OLLAMA_SERVICE = `  ollama:
    image: ollama/ollama:latest
    expose: ["11434"]
    volumes:
      - ollama-models:/root/.ollama
    environment:
      - OLLAMA_KEEP_ALIVE=24h
    restart: unless-stopped
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        ollama serve &
        sleep 5
        ollama pull __OLLAMA_MODEL__ 2>/dev/null || true
        wait
  ollama-models:
`;

// ============================================================
// UI helpers
// ============================================================

const W = 52; // inner box width

/** Strip ANSI codes to count visible chars */
function visibleLen(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

/** Pad a string to exactly W visible chars */
function pad(s) {
  const vlen = visibleLen(s);
  const total = W + (s.length - vlen); // account for ANSI codes
  return s + " ".repeat(Math.max(0, W - vlen));
}

/** Center text within width, preserving ANSI codes */
function center(text, width = W) {
  const vlen = visibleLen(text);
  if (vlen >= width) return text;
  const left = Math.floor((width - vlen) / 2);
  const right = width - vlen - left;
  return " ".repeat(left) + text + " ".repeat(right);
}

/** Draw a box with centered lines */
function box(lines, width = W) {
  const top = `  ╔${"═".repeat(width + 2)}╗`;
  const bottom = `  ╚${"═".repeat(width + 2)}╝`;
  console.log(top);
  for (const line of lines) {
    if (line === "") {
      console.log(`  ║ ${" ".repeat(width)} ║`);
    } else {
      console.log(`  ║ ${center(line)} ║`);
    }
  }
  console.log(bottom);
}

function header() {
  console.log("");
  box([
    center(`${B}YATS  Setup${R}`),
    "",
    center(`${D}Yet Another Token Saver — v${YATS_VERSION}${R}`),
    center(`${D}by Franco Vinciarelli${R}`),
  ]);
  console.log("");
}

function step(title) {
  console.log(`  ${C}▸${R} ${B}${title}${R}`);
  console.log("");
}

async function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function spinner(text) {
  process.stdout.write(`  ${D}${text}${R}`);
  return {
    done: (ok = true) => {
      process.stdout.write(`\r  ${ok ? `${G}✓${R}` : `${RED}✗${R}`} ${text}\n`);
    },
  };
}

// Selector: arrow keys to move + type a number + Enter to pick
async function choose(prompt, options) {
  console.log(`  ${prompt}`);
  for (let i = 0; i < options.length; i++) {
    console.log(`    ${B}${i + 1}${R}. ${options[i].label}`);
  }
  console.log("");

  let selected = 0;
  let buf = "";

  const render = () => {
    // move up to the prompt line and clear everything below
    const lines = options.length + 3;
    for (let i = 0; i < lines; i++) process.stdout.write("\x1b[1A\x1b[2K");
    console.log(`  ${prompt}`);
    for (let i = 0; i < options.length; i++) {
      const arrow = i === selected ? `${C}▸${R}` : " ";
      console.log(`    ${arrow} ${B}${i + 1}${R}. ${options[i].label}`);
    }
    console.log("");
    const hint = buf ? `  ${D}Selected: ${buf}. Press Enter to confirm, ↑/↓ to change${R}` : `  ${D}↑/↓ to move, or type a number, Enter to select${R}`;
    console.log(hint);
  };

  render();

  const stdin = process.stdin;
  return new Promise((resolve) => {
    let rawOk = true;
    try { stdin.setRawMode(true); } catch { rawOk = false; }

    if (!rawOk) {
      // Fallback to plain readline (piped stdin, no TTY)
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const ask = () => {
        rl.question(`  ${B}Pick [1-${options.length}]:${R} `, (answer) => {
          const num = parseInt(answer.trim(), 10);
          if (num >= 1 && num <= options.length) {
            rl.close();
            console.log("");
            resolve(options[num - 1].value);
          } else {
            console.log(`  ${RED}Invalid. Type 1-${options.length}.${R}\n`);
            ask();
          }
        });
      };
      ask();
      return;
    }

    const onData = (key) => {
      const k = key.toString();
      if (k === "\u001b[A" || k === "\u001bOA") { selected = Math.max(0, selected - 1); buf = ""; render(); return; }
      if (k === "\u001b[B" || k === "\u001bOB") { selected = Math.min(options.length - 1, selected + 1); buf = ""; render(); return; }
      if (k >= "0" && k <= "9") { buf += k; render(); return; }
      if (k === "\r" || k === "\n") {
        if (buf) { const n = parseInt(buf, 10); if (n >= 1 && n <= options.length) selected = n - 1; }
        stdin.removeListener("data", onData);
        try { stdin.setRawMode(false); } catch {}
        console.log("");
        resolve(options[selected].value);
        return;
      }
      if (k === "\u0003") { try { stdin.setRawMode(false); } catch {} process.exit(0); }
      buf = "";
    };
    stdin.resume();
    stdin.on("data", onData);
  });
}

function divider() {
  console.log(`  ${D}───────────────────────────────────────────────────────${R}`);
  console.log("");
}

// ============================================================
// System checks
// ============================================================

async function checkDocker() {
  return new Promise((resolve) => {
    const proc = spawn("docker", ["info"], { stdio: "ignore" });
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

async function checkPort(port) {
  return new Promise((resolve) => {
    const proc = spawn("docker", ["ps", "--format", "{{.Ports}}"], { stdio: "pipe" });
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.on("close", () => resolve(out.includes(`:${port}->`)));
    proc.on("error", () => resolve(false));
  });
}

async function checkYatsRunning() {
  // Check if the compose file from a previous setup exists
  if (!existsSync(COMPOSE_FILE)) return false;
  // Check if the YATS setup container is actually running
  return new Promise((resolve) => {
    const proc = spawn("docker", ["ps", "--format", "{{.Names}}", "--filter", "name=yats-yats"], { stdio: "pipe" });
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.on("close", () => resolve(out.trim().length > 0));
    proc.on("error", () => resolve(false));
  });
}

// ============================================================
// Compose file generation
// ============================================================

function generateCompose(provider, ollamaModel, apiKey, mcpPort, batchSize, indexDocs, docMaxFiles) {
  let compose = EMBEDDED_COMPOSE;

  if (provider === "ollama") {
    compose = compose.replace("__OLLAMA_PLACEHOLDER__", OLLAMA_SERVICE.replace("__OLLAMA_MODEL__", ollamaModel));
  } else {
    compose = compose.replace("__OLLAMA_PLACEHOLDER__", "");
  }

  compose = compose
    .replace(/__PROVIDER__/g, provider)
    .replace(/__OLLAMA_MODEL__/g, ollamaModel)
    .replace(/__OPENAI_KEY__/g, provider === "openai" ? apiKey : "")
    .replace(/__MISTRAL_KEY__/g, provider === "mistral" ? apiKey : "")
    .replace(/__VOYAGE_KEY__/g, provider === "voyage" ? apiKey : "")
    .replace(/__MCP_PORT__/g, String(mcpPort))
    .replace(/__BATCH_SIZE__/g, String(batchSize))
    .replace(/__INDEX_DOCS__/g, indexDocs ? "true" : "false")
    .replace(/__DOC_MAX__/g, String(docMaxFiles))

  return compose;
}

// ============================================================
// Docker operations
// ============================================================

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: "inherit", ...opts });
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
    proc.on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(url, retries = 30, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return true;
    } catch {}
    await sleep(delay);
  }
  return false;
}

// ============================================================
// Main
// ============================================================

async function loadEnv() {
  const env = {};
  try {
    const content = readFileSync(ENV_FILE, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  } catch { /* no .env file yet */ }
  return env;
}

async function testApiConnection(provider, apiKey) {
  const endpoints = {
    openai: { url: "https://api.openai.com/v1/embeddings", key: apiKey, body: { model: "text-embedding-3-small", input: ["test"] } },
    mistral: { url: "https://api.mistral.ai/v1/embeddings", key: apiKey, body: { model: "mistral-embed", input: ["test"] } },
    voyage: { url: "https://api.voyageai.com/v1/embeddings", key: apiKey, body: { model: "voyage-3-lite", input: ["test"] } },
  };
  const cfg = endpoints[provider];
  if (!cfg) return { ok: false, error: "Unknown provider" };
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify(cfg.body),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) return { ok: true };
    const err = await res.text();
    return { ok: false, error: `HTTP ${res.status}: ${err.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function main(options = {}) {
  // Load pre-filled values from .env (if exists) or CLI flags
  const env = loadEnv();
  const nonInteractive = options.nonInteractive || false;
  const prefill = {
    provider: options.provider || env.YATS_PROVIDER || null,
    apiKey: options.apiKey || env.OPENAI_API_KEY || env.MISTRAL_API_KEY || env.VOYAGE_API_KEY || null,
    port: options.port ? parseInt(options.port, 10) : null,
    batch: options.batch ? parseInt(options.batch, 10) : null,
    noDocs: options.noDocs || false,
    skipConfirm: options.skipConfirm || false,
  };

  header();

  // Check Docker
  const hasDocker = await checkDocker();
  if (!hasDocker) {
    console.log(`  ${RED}✗ Docker is not installed or not running.${R}`);
    console.log("");
    console.log(`  Please install Docker Desktop from ${C}https://docker.com${R}`);
    console.log(`  Then re-run:  ${B}npx yats-toolkit${R}`);
    console.log("");
    process.exit(1);
  }
  console.log(`  ${G}✓${R} Docker found`);
  console.log("");

  // Check for existing YATS containers BEFORE the wizard
  const existingContainers = await checkYatsRunning();
  if (existingContainers) {
    // Try to read the port from the existing compose/env
    let port = 5555;
    try {
      const composeContent = require("fs").readFileSync(COMPOSE_FILE, "utf-8");
      const match = composeContent.match(/YATS_PORT=(\d+)/) || composeContent.match(/"(\d+):(\d+)"/);
      if (match) port = parseInt(match[1] || match[2], 10);
    } catch {}

    console.log(`  ${G}✓${R} YATS is already running on ${C}http://localhost:${port}/mcp${R}`);
    console.log("");
    console.log(`  To start fresh ${B}(destroys all indexed data):${R}`);
    console.log(`  ${C}cd ~/.yats && docker compose down -v${R}`);
    console.log("");
    process.exit(0);
  }

  // Check for existing stopped install (compose file exists but containers not running)
  if (existsSync(COMPOSE_FILE)) {
    console.log(`  ${Y}⚠${R}  Found existing YATS installation (containers not running).`);
    console.log("");
    const rlStopped = createInterface({ input: process.stdin, output: process.stdout });
    const cleanAnswer = await ask(rlStopped, `  ${B}Start fresh (deletes all indexed data)? [y/N]${R} `);
    rlStopped.close();
    if (cleanAnswer.toLowerCase() === "y") {
      console.log("");
      const sClean = spinner("Cleaning up previous installation...");
      try {
        await runCmd("docker", ["compose", "-f", COMPOSE_FILE, "down", "-v"]);
        sClean.done(true);
      } catch {
        sClean.done(false);
      }
    } else {
      console.log("");
      console.log(`  ${G}✓${R} Keeping existing data. Proceeding with reconfiguration.`);
    }
    console.log("");
  }

  // Step 1: Embedding provider
  let provider;
  if (nonInteractive && prefill.provider) {
    provider = prefill.provider;
    console.log(`  Provider: ${provider}`);
  } else {
    step("Step 1 — Embedding provider");
    provider = await choose("How should I generate embeddings for your code?", [
      { label: "Ollama (local, private, included) — recommended", value: "ollama" },
      { label: "OpenAI (cloud, needs API key)", value: "openai" },
      { label: "Mistral (cloud, needs API key)", value: "mistral" },
      { label: "Voyage AI (cloud, optimized for code, needs API key)", value: "voyage" },
    ]);
  }

  let apiKey = "";
  let ollamaModel = "nomic-embed-text";

  if (provider === "ollama") {
    step("Step 2 — Ollama model");
    ollamaModel = await choose("Which model?", [
      { label: "nomic-embed-text (768d, fast, ~274MB)", value: "nomic-embed-text" },
      { label: "mxbai-embed-large (1024d, more accurate, ~669MB)", value: "mxbai-embed-large" },
    ]);
  } else {
    const providerNames = { openai: "OpenAI", mistral: "Mistral", voyage: "Voyage AI" };
    step(`Step 2 — ${providerNames[provider]} API key`);

    if (nonInteractive && prefill.apiKey) {
      apiKey = prefill.apiKey;
      console.log(`  API key: ${apiKey.slice(0, 8)}...`);
    } else {
      const rl2 = createInterface({ input: process.stdin, output: process.stdout });
      const defaultKey = prefill.apiKey || "";
      const prompt = defaultKey
        ? `  ${B}Your ${providerNames[provider]} API key${R} [${defaultKey.slice(0, 8)}...]: `
        : `  ${B}Your ${providerNames[provider]} API key:${R} `;
      apiKey = await ask(rl2, prompt);
      if (!apiKey && defaultKey) apiKey = defaultKey;
      rl2.close();
    }

    console.log("");
    console.log(`  ${Y}⚠${R}  This is a paid service — you may be charged for API usage.`);
    console.log("");

    // Optional: test connection
    if (!nonInteractive) {
      const rlTest = createInterface({ input: process.stdin, output: process.stdout });
      const testAnswer = await ask(rlTest, `  ${B}Test connection? [Y/n]${R} `);
      rlTest.close();
      if (testAnswer.toLowerCase() !== "n") {
        const sTest = spinner("Testing API connection...");
        const result = await testApiConnection(provider, apiKey);
        if (result.ok) {
          sTest.done(true);
          console.log("");
        } else {
          sTest.done(false);
          console.log(`  ${RED}✗${R} Connection failed: ${result.error}`);
          console.log(`  ${Y}⚠${R}  You can change the API key later in ${C}~/.yats/.env${R}`);
          console.log("");
          if (!nonInteractive) {
            const rlRetry = createInterface({ input: process.stdin, output: process.stdout });
            const retryAnswer = await ask(rlRetry, `  ${B}Re-enter API key? [Y/n]${R} `);
            rlRetry.close();
            if (retryAnswer.toLowerCase() !== "n") {
              const rl2b = createInterface({ input: process.stdin, output: process.stdout });
              apiKey = await ask(rl2b, `  ${B}Your ${providerNames[provider]} API key:${R} `);
              rl2b.close();
              console.log("");
            }
          }
        }
      } else {
        console.log("");
      }
    }
    console.log("");
  }

  // Step 3: Embedding batch size
  const BATCH_DEFAULTS = { openai: 200, mistral: 200, voyage: 100, ollama: 4 };
  const BATCH_MAX = { openai: 2048, mistral: 1024, voyage: 128, ollama: 4 };
  const defaultBatch = prefill.batch || BATCH_DEFAULTS[provider];
  const maxBatch = BATCH_MAX[provider];
  let batchSize = defaultBatch;

  if (nonInteractive) {
    console.log(`  Batch size: ${batchSize}`);
  } else {
    step(`Step 3 — Embedding batch size`);
    console.log(`  ${D}How many texts to embed per API request.${R}`);
    console.log(`  ${D}Higher = faster indexing, lower = safer for rate limits.${R}`);
    console.log(`  ${D}Provider max: ${maxBatch}${R}`);
    console.log("");
    const rlBatch = createInterface({ input: process.stdin, output: process.stdout });
    const batchAnswer = await ask(rlBatch, `  ${B}Batch size${R} [${defaultBatch}]: `);
    rlBatch.close();
    const batchTrimmed = batchAnswer.trim();
    if (batchTrimmed) {
      const num = parseInt(batchTrimmed, 10);
      if (num >= 1 && num <= maxBatch) batchSize = num;
      else console.log(`  ${Y}⚠${R}  Must be 1–${maxBatch}. Using default ${defaultBatch}.`);
    }
    console.log(`  ${G}✓${R} Batch size: ${batchSize}`);
    console.log("");
  }

  // Step 4: Documentation indexing
  const docMaxFiles = 300;
  let indexDocs = !prefill.noDocs;

  if (!nonInteractive) {
    step("Step 4 — Documentation indexing");
    console.log(`  ${D}Index README, ARCHITECTURE, AI/ docs, and docs/ directory.${R}`);
    console.log(`  ${D}Patterns (edit via DOC_PATTERNS env): AI/*.md, README.md, docs/${R}`);
    console.log(`  ${D}If docs/ has >${docMaxFiles} .md files, you'll get a warning.${R}`);
    console.log("");
    const rlDocs = createInterface({ input: process.stdin, output: process.stdout });
    const docsAnswer = await ask(rlDocs, `  ${B}Index documentation? [Y/n]${R} `);
    rlDocs.close();
    if (docsAnswer.toLowerCase() === "n") {
      indexDocs = false;
      console.log(`  ${Y}⚠${R}  Documentation indexing disabled. Set INDEX_DOCS=true to re-enable.`);
    } else {
      console.log(`  ${G}✓${R}  Documentation will be indexed.`);
    }
    console.log("");
  } else {
    console.log(`  Index docs: ${indexDocs ? "Yes" : "No"}`);
  }

  // Optional: pre-index directories
  const pathsToIndex = [];
  if (!nonInteractive) {
    step("Step 5 — Pre-index (optional)");
    console.log(`  ${D}Indexing happens automatically on first search.${R}`);
    console.log(`  ${D}Want to pre-index some directories now to skip the wait later?${R}`);
    console.log("");
    console.log(`  ${D}Tip: type a path or drag-n-drop a folder from your file manager.${R}`);
    const rl3 = createInterface({ input: process.stdin, output: process.stdout });
    while (true) {
      const p = await ask(rl3, `  ${B}Directory path (Enter to skip):${R} `);
      const trimmed = p.trim();
      if (!trimmed) break;
      const resolved = resolve(trimmed);
      if (existsSync(resolved)) {
        try {
          if (statSync(resolved).isDirectory()) {
            pathsToIndex.push(resolved);
            console.log(`  ${G}✓${R} Added: ${resolved}`);
          } else {
            console.log(`  ${RED}✗${R} Not a directory: ${resolved}`);
          }
        } catch {
          console.log(`  ${RED}✗${R} Cannot access: ${resolved}`);
        }
      } else {
        console.log(`  ${RED}✗${R} Not found: ${resolved}`);
      }
    }
    rl3.close();
  }
  console.log("");

  // Port selection
  let mcpPort = prefill.port || 5555;
  if (!nonInteractive) {
    const rlPort = createInterface({ input: process.stdin, output: process.stdout });
    const inUse = await checkPort(mcpPort);
    const suggested = inUse ? (mcpPort + 1) : mcpPort;
    const hint = inUse ? ` ${Y}(default ${mcpPort} is in use)${R}` : "";
    const answer = await ask(rlPort, `  ${B}MCP server port${R} [${suggested}]:${hint} `);
    const trimmed = answer.trim();
    if (trimmed) {
      const num = parseInt(trimmed, 10);
      if (num >= 1024 && num <= 65535) mcpPort = num;
    } else {
      mcpPort = suggested;
    }
    rlPort.close();
    console.log(`  ${G}✓${R} MCP server on ${C}http://localhost:${mcpPort}/mcp/sse${R}`);
    console.log("");
  }

  // Confirm
  if (!nonInteractive && !prefill.skipConfirm) {
    step(`Step ${pathsToIndex.length ? "6" : "5"} — Confirm`);
    const providerName = provider === "ollama"
      ? `Ollama (${ollamaModel})`
      : { openai: "OpenAI", mistral: "Mistral", voyage: "Voyage AI" }[provider];
    box([
      `${B}Provider:${R}     ${providerName}`,
      `${B}Port:${R}         ${String(mcpPort)}`,
      ...(pathsToIndex.length ? [`${B}Pre-index:${R}    ${String(pathsToIndex.length + " directorie(s)")}`] : []),
      `${B}Batch:${R}        ${String(batchSize)}`,
      `${B}Index docs:${R}   ${indexDocs ? "Yes (max " + docMaxFiles + " files)" : "No"}`,
      `${B}API calls:${R}    ${provider === "ollama" ? "None (runs locally)" : `To ${provider} API`}`,
      `${B}Disk needed:${R}  ${provider === "ollama" ? "~3GB" : "~1GB"}`,
    ]);
    console.log("");
    const proceed = await (() => {
      const rl4 = createInterface({ input: process.stdin, output: process.stdout });
      return ask(rl4, `  ${B}Proceed? [Y/n]${R} `).then((a) => { rl4.close(); return a; });
    })();
    if (proceed.toLowerCase() === "n") {
      console.log("");
      console.log(`  Setup cancelled. Run ${B}npx yats-toolkit${R} anytime to try again.`);
      console.log("");
      process.exit(0);
    }
  }

  // Install
  console.log("");
  step(`${D}Installing${R}`);

  // Create directories
  mkdirSync(YATS_DIR, { recursive: true });
  mkdirSync(REPOS_DIR, { recursive: true });

  // Generate and write docker-compose
  const compose = generateCompose(provider, ollamaModel, apiKey, mcpPort, batchSize, indexDocs, docMaxFiles);
  writeFileSync(COMPOSE_FILE, compose);

  // Write MCP config
  const mcpConfig = { mcpServers: { yats: { url: `http://localhost:${mcpPort}/mcp/sse` } } };
  writeFileSync(MCP_CONFIG_FILE, JSON.stringify(mcpConfig, null, 2));

  // Pull the YATS Docker image from GitHub Container Registry
  const sPull = spinner("Pulling YATS image from registry...");
  try {
    await runCmd("docker", ["pull", "ghcr.io/fvinciarelli/yats.ai:latest"]);
    sPull.done(true);
  } catch {
    sPull.done(false);
    console.log(`  ${RED}Failed to pull YATS image. Is Docker running and internet accessible?${R}`);
    process.exit(1);
  }

  const sUp = spinner("Starting services (Neo4j, Qdrant, YATS)...");
  try {
    await runCmd("docker", ["compose", "-f", COMPOSE_FILE, "up", "-d"]);
    sUp.done(true);
  } catch {
    sUp.done(false);
    console.log(`  ${RED}Failed to start Docker services. Check docker logs.${R}`);
    process.exit(1);
  }

  const sWait = spinner("Starting YATS server...");
  const yatsOk = await waitForHealth(`http://localhost:${mcpPort}/health`, 60, 2000);
  sWait.done(yatsOk);

  if (!yatsOk) {
    console.log("");
    console.log(`  ${RED}✗ YATS server failed to start within 2 minutes.${R}`);
    console.log(`  Check logs: ${C}docker compose -f ${COMPOSE_FILE} logs yats${R}`);
    console.log("");
    process.exit(1);
  }

  // Pre-index directories if user added them
  if (pathsToIndex.length > 0 && yatsOk) {
    console.log("");
    const sIndex = spinner(`Pre-indexing ${pathsToIndex.length} directorie(s)...`);
    try {
      for (const dir of pathsToIndex) {
        const repoName = dir.split("/").pop() || dir;
        // Path inside the container: repos are mounted under /repos/
        const containerPath = `/repos/${repoName}`;
        await fetch(`http://localhost:${mcpPort}/index`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: containerPath }),
        });
      }
      sIndex.done(true);
    } catch {
      sIndex.done(false);
      console.log(`  ${Y}Index endpoint not ready yet. Repos will be indexed on first search.${R}`);
    }
  }

  // Install YATS CLI globally (or to ~/.yats/bin if global fails)
  const sCli = spinner("Installing YATS CLI...");
  try {
    const osPlatform = platform();
    mkdirSync(YATS_BIN_DIR, { recursive: true });

    if (osPlatform === "win32") {
      // Windows: create a .cmd wrapper
      const cmdScript = `@echo off\r\nnpx yats %*\r\n`;
      writeFileSync(join(YATS_BIN_DIR, "yats.cmd"), cmdScript);
    } else {
      // Linux/macOS: create a shell wrapper
      const shScript = `#!/usr/bin/env bash\nnpx yats "$@"\n`;
      writeFileSync(join(YATS_BIN_DIR, "yats"), shScript);
      chmodSync(join(YATS_BIN_DIR, "yats"), 0o755);
    }
    sCli.done(true);

    // Add to PATH
    const rcFiles = [];
    if (osPlatform !== "win32") {
      // Try .bashrc and .zshrc
      const bashrc = join(homedir(), ".bashrc");
      const zshrc = join(homedir(), ".zshrc");
      if (existsSync(bashrc)) rcFiles.push(bashrc);
      if (existsSync(zshrc)) rcFiles.push(zshrc);
      if (rcFiles.length === 0) rcFiles.push(bashrc); // if neither exists, create .bashrc

      const exportLine = `\nexport PATH="$HOME/.yats/bin:$PATH"  # YATS CLI\n`;
      for (const rc of rcFiles) {
        const content = existsSync(rc) ? readFileSync(rc, "utf-8") : "";
        if (!content.includes(".yats/bin")) {
          writeFileSync(rc, content + exportLine);
        }
      }
    } else {
      // Windows: use setx (no visual feedback needed for the spinner)
      // setx is best-effort; user may need admin
      try {
        await runCmd("setx", ["PATH", `${YATS_BIN_DIR};%PATH%`]);
      } catch {}
    }

    console.log(`  ${G}✓${R} CLI installed to ${C}${YATS_BIN_DIR}${R}`);
    if (osPlatform !== "win32") {
      const names = rcFiles.map(f => f.split("/").pop()).join(" and ");
      console.log(`  ${Y}⚠${R}  Added ${C}~/.yats/bin${R} to your ${C}${names}${R}`);
      console.log(`  ${Y}⚠${R}  Run ${B}source ${names.includes("zshrc") ? "~/.zshrc" : "~/.bashrc"}${R} or restart your terminal`);
      console.log(`  ${Y}⚠${R}  for the ${B}yats${R} command to be available.`);
    }
  } catch (e) {
    sCli.done(false);
  }

  // Done
  console.log("");
  console.log(`  ✅  ${G}YATS is ready!${R}  →  ${C}http://localhost:${mcpPort}/mcp/sse${R}`);
  console.log("");
  console.log(`  Config saved to ${C}~/.yats/.env${R}`);
  console.log("");
  box([
    `${B}Copy this URL into your AI agent:${R}`,
    `{ "url": "http://localhost:${mcpPort}/mcp/sse" }`,
    "",
    `${B}Copilot / Claude Desktop:${R}`,
    `{ "command": "npx", "args": ["yats-bridge"] }`,
    "",
    `${D}For more: yats connect${R}`,
    `${C}github.com/fvinciarelli/yats.ai/connect${R}`,
  ]);
  console.log("");
  console.log(`  ${B}Try:${R} ${C}"how does auth work in this project?"${R}`);
  console.log("");
  console.log(`  ${B}Commands:${R}  yats status | yats clear | yats stop/start`);
  console.log(`             yats update | yats connect`);
  console.log("");
  console.log(`  Docs:  ${C}https://fvinciarelli.github.io/yats.ai/${R}  ·  ${C}https://yats.site${R}`);
  console.log("");
}
export default main;
