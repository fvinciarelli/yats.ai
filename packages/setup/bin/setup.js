#!/usr/bin/env node
/**
 * YATS Setup — One-command wizard to get YATS running on your machine.
 *
 * Usage:
 *   npx yats-setup
 *   curl -fsSL https://get.yats.site | bash
 *
 * Requirements: Docker (with compose plugin)
 */

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

// ============================================================
// Constants
// ============================================================

const YATS_VERSION = "0.1.0";
const YATS_DIR = join(homedir(), ".yats");
const REPOS_DIR = join(YATS_DIR, "repos");
const COMPOSE_FILE = join(YATS_DIR, "docker-compose.yml");
const MCP_CONFIG_FILE = join(YATS_DIR, "mcp-config.json");

const GITHUB_COMPOSE_URL =
  "https://raw.githubusercontent.com/fvinciarelli/yats/main/docker/docker-compose.yml";

const B = "\x1b[1m";
const D = "\x1b[2m";
const R = "\x1b[0m";
const G = "\x1b[32m";
const Y = "\x1b[33m";
const C = "\x1b[36m";
const RED = "\x1b[31m";

// Minimal embedded docker-compose as fallback
const EMBEDDED_COMPOSE = `version: "3.9"
services:
  neo4j:
    image: neo4j:5.26-community
    ports: ["7474:7474", "7687:7687"]
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
    ports: ["6333:6333", "6334:6334"]
    volumes:
      - qdrant-storage:/qdrant/storage
    environment:
      - QDRANT__SERVICE__GRPC_PORT=6334
      - QDRANT__SERVICE__HTTP_PORT=6333
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:6333/health"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s
    restart: unless-stopped
  __OLLAMA_PLACEHOLDER__
  yats:
    image: yats:local
    # TODO: switch to published image before release
    # image: ghcr.io/fvinciarelli/yats:latest
    ports: ["\${YATS_PORT:-3000}:3000"]
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
      - YATS_PORT=3000
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
    ports: ["11434:11434"]
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

function header() {
  const W = 48; // inner width
  const pad = (s) => {
    const visible = s.replace(/\x1b\[[0-9;]*m/g, "").length;
    return s + " ".repeat(Math.max(0, W - visible));
  };
  console.log("");
  console.log(`  ╔${"═".repeat(W + 2)}╗`);
  console.log(`  ║ ${pad(`${B}YATS  Setup${R}`)} ║`);
  console.log(`  ║ ${" ".repeat(W)} ║`);
  console.log(`  ║ ${pad(`${D}Yet Another Token Saver${R}`)} ║`);
  console.log(`  ║ ${pad(`${D}by Franco Vinciarelli${R}`)} ║`);
  console.log(`  ╚${"═".repeat(W + 2)}╝`);
  console.log("");
}

function step(title) {
  console.log(`  ${B}${title}${R}`);
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

// Simple numbered selector — works in every terminal, no exceptions
async function choose(prompt, options) {
  console.log(`  ${prompt}`);
  for (let i = 0; i < options.length; i++) {
    console.log(`    ${B}${i + 1}${R}. ${options[i].label}`);
  }
  console.log("");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  while (true) {
    const answer = await new Promise((resolve) => rl.question(`  ${B}Pick [1-${options.length}]:${R} `, resolve));
    const num = parseInt(answer.trim(), 10);
    if (num >= 1 && num <= options.length) {
      rl.close();
      console.log("");
      return options[num - 1].value;
    }
    console.log(`  ${RED}Invalid. Type 1-${options.length}.${R}\n`);
  }
}

function divider() {
  console.log(`  ───────────────────────────────────────────────────────`);
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

// ============================================================
// Compose file generation
// ============================================================

function generateCompose(provider, ollamaModel, apiKey) {
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
    .replace(/__VOYAGE_KEY__/g, provider === "voyage" ? apiKey : "");

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

async function main() {
  header();

  // Check Docker
  const hasDocker = await checkDocker();
  if (!hasDocker) {
    console.log(`  ${RED}✗ Docker is not installed or not running.${R}`);
    console.log("");
    console.log(`  Please install Docker Desktop from ${C}https://docker.com${R}`);
    console.log(`  Then re-run:  ${B}npx yats-setup${R}`);
    console.log("");
    process.exit(1);
  }
  console.log(`  ${G}✓${R} Docker found`);
  console.log("");

  // Step 1: Embedding provider
  step("Step 1 — Embedding provider");

  const provider = await choose("How should I generate embeddings for your code?", [
    { label: "Ollama (local, private, included) — recommended", value: "ollama" },
    { label: "OpenAI (cloud, needs API key)", value: "openai" },
    { label: "Mistral (cloud, needs API key)", value: "mistral" },
    { label: "Voyage AI (cloud, optimized for code, needs API key)", value: "voyage" },
  ]);

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
    const rl2 = createInterface({ input: process.stdin, output: process.stdout });
    apiKey = await ask(rl2, `  ${B}Your ${providerNames[provider]} API key:${R} `);
    rl2.close();
    console.log("");
    console.log(`  ${Y}⚠${R}  This is a paid service — you may be charged for API usage.`);
    console.log("");
  }

  // Step 3: Confirm
  step("Step 3 — Confirm");

  const providerName = provider === "ollama"
    ? `Ollama (${ollamaModel})`
    : { openai: "OpenAI", mistral: "Mistral", voyage: "Voyage AI" }[provider];
  console.log(`  ┌──────────────────────────────────────────────────────┐`);
  console.log(`  │                                                      │`);
  console.log(`  │  Provider:     ${providerName.padEnd(39)}│`);
  console.log(`  │  Disk needed:  ${(provider === "ollama" ? "~3GB" : "~1GB").padEnd(39)}│`);
  console.log(`  │                                                      │`);
  console.log(`  └──────────────────────────────────────────────────────┘`);
  console.log("");

  const proceed = await (() => {
    const rl3 = createInterface({ input: process.stdin, output: process.stdout });
    return ask(rl3, `  ${B}Proceed? [Y/n]${R} `).then((a) => { rl3.close(); return a; });
  })();
  if (proceed.toLowerCase() === "n") {
    console.log("");
    console.log(`  Setup cancelled. Run ${B}npx yats-setup${R} anytime to try again.`);
    console.log("");
    process.exit(0);
  }

  // Step 4: Install
  console.log("");
  step("Step 4 — Installing");

  // Create directories
  mkdirSync(YATS_DIR, { recursive: true });
  mkdirSync(REPOS_DIR, { recursive: true });

  // Generate and write docker-compose
  const compose = generateCompose(provider, ollamaModel, apiKey);
  writeFileSync(COMPOSE_FILE, compose);

  // Write MCP config
  const mcpConfig = { mcpServers: { yats: { url: "http://localhost:3000/mcp/sse" } } };
  writeFileSync(MCP_CONFIG_FILE, JSON.stringify(mcpConfig, null, 2));

  // Start services
  const sPull = spinner("Pulling Docker images...");
  try {
    await runCmd("docker", ["compose", "-f", COMPOSE_FILE, "up", "-d"]);
    sPull.done(true);
  } catch {
    sPull.done(false);
    console.log(`  ${RED}Failed to start Docker services. Check docker logs.${R}`);
    process.exit(1);
  }

  const sWait = spinner("Waiting for databases...");
  const neo4jOk = await waitForHealth("http://localhost:7474", 20, 3000);
  if (!neo4jOk) {
    sWait.done(false);
    console.log(`  ${Y}Neo4j is taking longer than expected... continuing anyway.${R}`);
  } else {
    sWait.done(true);
  }

  const sServer = spinner("Starting YATS server...");
  const yatsOk = await waitForHealth("http://localhost:3000/health", 30, 2000);
  sServer.done(yatsOk);

  if (!yatsOk) {
    console.log("");
    console.log(`  ${Y}⚠ Server still warming up.${R} It'll be ready shortly.`);
    console.log(`  Check: ${C}docker compose -f ${COMPOSE_FILE} logs yats${R}`);
    console.log("");
  }

  // Done
  console.log("");
  console.log(`  ✅  ${G}YATS is ready!${R}`);
  divider();
  console.log("");
  console.log(`  MCP configuration for your AI agent:`);
  console.log("");
  console.log(`  ┌──────────────────────────────────────────────────────┐`);
  console.log(`  │  {                                                   │`);
  console.log(`  │    "mcpServers": {                                   │`);
  console.log(`  │      "yats": {                                       │`);
  console.log(`  │        "url": "http://localhost:3000/mcp/sse"         │`);
  console.log(`  │      }                                               │`);
  console.log(`  │    }                                                 │`);
  console.log(`  │  }                                                   │`);
  console.log(`  └──────────────────────────────────────────────────────┘`);
  console.log("");
  console.log(`  Config saved to ${C}${MCP_CONFIG_FILE}${R}`);
  divider();
  console.log("");
  console.log(`  ${B}How it works:${R}`);
  console.log("");
  console.log(`    Just ask your AI agent about your code.`);
  console.log(`    The index builds automatically on the first search.`);
  console.log("");
  console.log(`    Example: "${D}how does authentication work in my project?${R}"`);
  console.log("");
  console.log(`  ${B}Commands:${R}`);
  console.log(`    yats add ~/work/project    Add a repo to index`);
  console.log(`    yats status                Check what's indexed`);
  console.log(`    yats stop                  Stop all services`);
  console.log(`    yats update                Update to latest version`);
  console.log("");
  console.log(`  Docs: ${C}https://yats.site${R}`);
  console.log("");
}

main().catch((err) => {
  console.error(`\n  ${RED}Error:${R} ${err.message}`);
  console.error(`  If the problem persists, open an issue: ${C}https://github.com/fvinciarelli/yats/issues${R}\n`);
  process.exit(1);
});
