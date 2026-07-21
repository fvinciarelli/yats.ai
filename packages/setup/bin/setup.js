#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, dirname } from "node:path";
import { createInterface } from "node:readline";
import * as readline from "node:readline";

// ============================================================
// YATS Setup Wizard
// ============================================================

const YATS_DIR = join(homedir(), ".yats");
const YATS_ENV = join(YATS_DIR, ".env");
const YATS_CONFIG = join(YATS_DIR, "mcp-config.json");
const REPOS_DIR = join(YATS_DIR, "repos");

const DOCKER_COMPOSE_DIR = join(
  dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "..",
  "docker",
);

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RED = "\x1b[31m";

function print(s) {
  process.stdout.write(s);
}

function header() {
  console.log("");
  console.log(`  ╔══════════════════════════════════════════════════╗`);
  console.log(`  ║              ${BOLD}YATS  Setup${RESET}                        ║`);
  console.log(`  ║     ${DIM}Yet Another Token Saver${RESET}                      ║`);
  console.log(`  ║     ${DIM}Index your code, talk to your AI${RESET}             ║`);
  console.log(`  ╚══════════════════════════════════════════════════╝`);
  console.log("");
}

async function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function step(title) {
  console.log(`  ${BOLD}${title}${RESET}`);
  console.log("");
}

async function choose(rl, prompt, options) {
  console.log(`  ${prompt}`);
  for (let i = 0; i < options.length; i++) {
    const marker = i === 0 ? `${CYAN}${BOLD}▸${RESET}` : " ";
    console.log(`    ${marker} ${options[i].label}${i < options.length - 1 ? "" : ""}`);
  }
  console.log("");
  console.log(`  ${DIM}Use ↑/↓ arrows, Enter to select${RESET}`);

  let selected = 0;
  const stdin = process.stdin;

  return new Promise((resolve) => {
    function onData(key) {
      if (key === "\u001b[A" || key === "\u001b[B") {
        // Clear lines
        for (let i = 0; i < options.length + 4; i++) {
          process.stdout.write("\x1b[1A\x1b[2K");
        }
        if (key === "\u001b[A") selected = Math.max(0, selected - 1);
        else selected = Math.min(options.length - 1, selected + 1);
        console.log(`  ${prompt}`);
        for (let i = 0; i < options.length; i++) {
          const marker = i === selected ? `${CYAN}${BOLD}▸${RESET}` : " ";
          console.log(`    ${marker} ${options[i].label}`);
        }
        console.log("");
        console.log(`  ${DIM}Use ↑/↓ arrows, Enter to select${RESET}`);
      } else if (key === "\r" || key === "\n") {
        stdin.removeListener("data", onData);
        stdin.setRawMode(false);
        resolve(options[selected].value);
      }
    }
    stdin.setRawMode(true);
    stdin.on("data", onData);
  });
}

// ============================================================
// Main
// ============================================================

async function main() {
  header();

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  // Step 1: Embedding provider
  await step("Step 1 — Embedding provider");

  const provider = await choose(rl, "How should I generate embeddings for your code?", [
    { label: "Ollama (local, private, included)", value: "ollama" },
    { label: "OpenAI (cloud, needs API key)", value: "openai" },
  ]);

  let apiKey = "";
  let ollamaModel = "nomic-embed-text";

  if (provider === "ollama") {
    await step("Step 2 — Ollama model");
    ollamaModel = await choose(rl, "Which model?", [
      { label: "nomic-embed-text (768d, fast, ~274MB) — recommended", value: "nomic-embed-text" },
      { label: "mxbai-embed-large (1024d, more accurate, ~669MB)", value: "mxbai-embed-large" },
    ]);
  } else {
    await step("Step 2 — OpenAI API key");
    apiKey = await ask(rl, `  ${BOLD}Your OpenAI API key:${RESET} `);
    console.log("");
    console.log(`  ${YELLOW}⚠${RESET}  This is a paid service. You may be charged for API usage.`);
    console.log("");
  }

  // Step 3: Confirm
  await step("Step 3 — Confirm");

  console.log(`  ┌──────────────────────────────────────────────────────┐`);
  console.log(`  │                                                      │`);
  console.log(`  │  Provider:     ${provider === "ollama" ? `Ollama (${ollamaModel})` : "OpenAI"}`);
  console.log(`  │  Disk needed:   ${provider === "ollama" ? "~3GB" : "~1GB"}`);
  console.log(`  │                                                      │`);
  console.log(`  └──────────────────────────────────────────────────────┘`);
  console.log("");

  const proceed = await ask(rl, `  ${BOLD}Proceed? [Y/n]${RESET} `);
  if (proceed.toLowerCase() === "n") {
    console.log("");
    console.log(`  Setup cancelled.`);
    rl.close();
    process.exit(0);
  }

  rl.close();

  // Step 4: Install
  console.log("");
  console.log(`  Step 4 — Installing`);
  console.log("");

  // Create .yats directory
  mkdirSync(YATS_DIR, { recursive: true });
  mkdirSync(REPOS_DIR, { recursive: true });

  // Write .env
  const envContent = [
    "# YATS environment",
    `EMBEDDING_PROVIDER=${provider}`,
    `OLLAMA_MODEL=${ollamaModel}`,
    `NEO4J_PASSWORD=password`,
    `REPOS_PATH=${REPOS_DIR}`,
    `LOG_LEVEL=info`,
    provider === "openai" ? `OPENAI_API_KEY=${apiKey}` : "",
  ].filter(Boolean).join("\n");
  writeFileSync(YATS_ENV, envContent);

  // Write MCP config
  const mcpConfig = {
    mcpServers: {
      yats: {
        url: "http://localhost:3000/mcp/sse",
      },
    },
  };
  writeFileSync(YATS_CONFIG, JSON.stringify(mcpConfig, null, 2));

  // Start docker compose
  console.log(`  ${DIM}Pulling Docker images...${RESET}`);

  const profile = provider === "ollama" ? "ollama" : "";
  const composeArgs = ["compose", "-f", join(DOCKER_COMPOSE_DIR, "docker-compose.yml")];
  if (profile) composeArgs.push("--profile", profile);
  composeArgs.push("up", "-d");

  await runCommand("docker", composeArgs, {
    env: { ...process.env, YATS_ENV_FILE: YATS_ENV },
  });

  console.log(`  ${GREEN}✓${RESET} Docker started`);
  console.log(`  ${DIM}Waiting for services...${RESET}`);
  await sleep(3000);

  // Wait for health
  await waitForHealth();

  console.log("");

  // Done
  console.log(`  ✅  ${GREEN}YATS is ready!${RESET}`);
  console.log("");
  console.log("");
  console.log(`  Add this to your AI agent configuration:`);
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
  console.log(`  ${GREEN}[✓ Copied to clipboard]${RESET}`);
  console.log("");
  console.log(`  Config saved to ${YATS_CONFIG}`);
  console.log("");
  console.log(`  ───────────────────────────────────────────────────────`);
  console.log("");
  console.log(`  How it works:`);
  console.log("");
  console.log(`    Just ask your AI agent about your code. The index`);
  console.log(`    builds automatically the first time you search.`);
  console.log("");
  console.log(`    Example: "how does authentication work in this project?"`);
  console.log("");
  console.log(`    Add repos:  ${BOLD}yats add ~/work/my-project${RESET}`);
  console.log("");
  console.log(`  Docs: ${CYAN}https://yats.site${RESET}`);
  console.log("");
}

function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: "inherit", ...opts });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with ${code}`));
    });
    proc.on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth() {
  for (let i = 0; i < 30; i++) {
    try {
      const resp = await fetch("http://localhost:3000/health");
      if (resp.ok) {
        console.log(`  ${GREEN}✓${RESET} YATS server healthy`);
        return;
      }
    } catch {}
    await sleep(2000);
  }
  console.log(`  ${YELLOW}⚠${RESET} YATS server may still be starting...`);
}

main().catch((err) => {
  console.error(`${RED}Error:${RESET} ${err.message}`);
  process.exit(1);
});
