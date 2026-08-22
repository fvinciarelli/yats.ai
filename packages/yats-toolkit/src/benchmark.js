/**
 * yats benchmark — AI agent token comparison
 * Measures token usage answering codebase questions with and without YATS.
 * Uses only Node.js built-ins (zero dependencies).
 *
 * Interactive UI: arrow-key selection + colors when run in a TTY.
 * Falls back to plain numbered prompts when stdin is piped (scriptable).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, execSync } from "node:child_process";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import * as os from "node:os";

const logger = {
  info: (msg) => console.error(`[benchmark] ${msg}`),
  warn: (msg) => console.error(`[benchmark] ⚠ ${msg}`),
  error: (msg) => console.error(`[benchmark] ❌ ${msg}`),
};

// ============================================================
// Terminal UI (colors + arrow-key selection)
// ============================================================

const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);

const A = isTTY
  ? {
      reset: "\x1b[0m",
      bold: "\x1b[1m",
      dim: "\x1b[2m",
      purple: "\x1b[35m",
      cyan: "\x1b[36m",
      green: "\x1b[32m",
      red: "\x1b[31m",
      yellow: "\x1b[33m",
      gray: "\x1b[90m",
    }
  : {
      reset: "", bold: "", dim: "", purple: "", cyan: "",
      green: "", red: "", yellow: "", gray: "",
    };

function setRaw(on) {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
    process.stdin.setRawMode(on);
  }
}

function showCursor(on) {
  if (isTTY) process.stdout.write(on ? "\x1b[?25h" : "\x1b[?25l");
}

function restoreTerminal() {
  setRaw(false);
  showCursor(true);
}

process.on("SIGINT", () => {
  restoreTerminal();
  console.log(`\n  ${A.yellow}✖ Cancelled${A.reset}\n`);
  process.exit(130);
});

// Reads a single key (raw mode). Returns "up" | "down" | "enter" | "backspace" | "ctrl-c" | "esc" | a character.
function readKey() {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    let acc = "";
    const done = (k) => {
      stdin.removeListener("data", onData);
      resolve(k);
    };
    const onData = (chunk) => {
      acc += chunk;
      if (acc.length === 1 && acc !== "\x1b") {
        const ch = acc;
        if (ch === "\r" || ch === "\n") done("enter");
        else if (ch === "\x03") done("ctrl-c");
        else if (ch === "\x7f" || ch === "\b") done("backspace");
        else done(ch);
        return;
      }
      if (acc.startsWith("\x1b")) {
        if (acc.length >= 3) {
          if (acc === "\x1b[A") done("up");
          else if (acc === "\x1b[B") done("down");
          else done("esc");
        }
        // else wait for more bytes of the escape sequence
      }
    };
    stdin.on("data", onData);
  });
}

// Non-TTY line input (piped stdin) via a readline interface + queue.
const rl = !isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
const lineQueue = [];
const lineWaiters = [];
if (rl) {
  rl.on("line", (line) => {
    if (lineWaiters.length) lineWaiters.shift()(line);
    else lineQueue.push(line);
  });
  rl.on("close", () => {
    while (lineWaiters.length) lineWaiters.shift()("");
  });
}

// Ask for a free-text line. Works in TTY (raw line editing) and piped stdin.
async function askLine(question) {
  process.stdout.write(question);
  if (!isTTY) {
    return new Promise((resolve) => {
      if (lineQueue.length) resolve(lineQueue.shift());
      else lineWaiters.push(resolve);
    });
  }
  setRaw(true);
  let line = "";
  while (true) {
    const key = await readKey();
    if (key === "enter") {
      process.stdout.write("\n");
      setRaw(false);
      return line;
    }
    if (key === "ctrl-c") {
      restoreTerminal();
      console.log(`\n  ${A.yellow}✖ Cancelled${A.reset}\n`);
      process.exit(130);
    }
    if (key === "backspace") {
      if (line.length) {
        line = line.slice(0, -1);
        process.stdout.write("\b \b");
      }
    } else if (typeof key === "string" && key.length === 1 && key >= " ") {
      line += key;
      process.stdout.write(key);
    }
  }
}

// Interactive selector. options: [{ label, hint, value, ok?, accent? }]
async function select(title, options) {
  if (!isTTY) {
    console.log(`\n  ${title}`);
    options.forEach((o, i) => {
      console.log(`    ${i + 1}. ${o.label}${o.hint ? ` (${o.hint})` : ""}`);
    });
    const choice = await askLine(`  Pick [1-${options.length}]: `);
    const idx = parseInt(choice) - 1;
    return idx >= 0 && idx < options.length ? options[idx].value : options[0].value;
  }

  let idx = 0;
  const cols = process.stdout.columns || 80;
  const maxLabel = Math.max(24, cols - 12);
  const draw = () => {
    let s = `  ${A.bold}${A.purple}${title}${A.reset}\n`;
    for (let i = 0; i < options.length; i++) {
      const o = options[i];
      const sel = i === idx;
      const cursor = sel ? `${A.purple}›${A.reset}` : " ";
      let label = o.label;
      if (label.length > maxLabel) label = label.slice(0, maxLabel - 1) + "…";
      if (sel) label = `${A.bold}${label}${A.reset}`;
      if (!sel && o.accent) label = `${A.cyan}${label}${A.reset}`;
      if (sel && o.accent) label = `${A.bold}${A.cyan}${label}${A.reset}`;
      let hint = "";
      if (o.hint) {
        const color = o.ok === false ? A.red : A.gray;
        hint = `  ${A.dim}${color}${o.hint}${A.reset}`;
      }
      s += `  ${cursor} ${label}${hint}\n`;
    }
    s += `\n  ${A.dim}↑/↓ move · Enter select · Ctrl+C cancel${A.reset}\n`;
    return s;
  };

  const lineCount = options.length + 3; // title + options + blank + footer
  setRaw(true);
  showCursor(false);
  process.stdout.write("\n" + draw());

  while (true) {
    const key = await readKey();
    if (key === "up") idx = (idx - 1 + options.length) % options.length;
    else if (key === "down") idx = (idx + 1) % options.length;
    else if (key === "enter") break;
    else if (key === "ctrl-c") {
      restoreTerminal();
      console.log(`\n  ${A.yellow}✖ Cancelled${A.reset}\n`);
      process.exit(130);
    } else {
      continue;
    }
    process.stdout.write(`\x1b[${lineCount}A\x1b[J`);
    process.stdout.write(draw());
  }

  setRaw(false);
  showCursor(true);
  process.stdout.write("\n");
  return options[idx].value;
}

// ============================================================
// Helpers
// ============================================================

function isInstalled(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function hasApiKey(envVar) {
  return !envVar || !!process.env[envVar];
}

function toAbsolute(p) {
  let s = String(p).trim();
  if (s === "~") s = process.env.HOME ?? "/tmp";
  else if (s.startsWith("~/")) s = path.join(process.env.HOME ?? "/tmp", s.slice(2));
  return path.resolve(s);
}

// ============================================================
// .env loading — so spawned agents inherit API keys
// ============================================================

function loadEnvFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    let count = 0;
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && value && !(key in process.env)) {
        process.env[key] = value;
        count++;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

function loadEnv() {
  const candidates = [];
  // Canonical: ~/.yats/.env (setup writes embedding + benchmark keys there)
  candidates.push(path.join(process.env.HOME ?? "/tmp", ".yats", ".env"));
  candidates.push(path.join(process.cwd(), ".env"));

  // walk up from this module (src/) to find a repo-root .env (legacy fallback)
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const p = path.join(dir, ".env");
    if (!candidates.includes(p)) candidates.push(p);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Load ALL candidates so keys accumulate (first one wins per key).
  let loaded = null;
  for (const c of candidates) {
    if (loadEnvFile(c) > 0 && !loaded) loaded = c;
  }
  return loaded;
}

const LOADED_ENV = loadEnv();
if (LOADED_ENV) logger.info(`Loaded ${LOADED_ENV}`);

let selectedModel = null;
let copilotConsent = false;
let workDir = path.join(process.cwd(), "repos");

// ============================================================
// Repos — loaded dynamically from benchmark/targets + benchmark/questions
// ============================================================

const BENCH_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "benchmark");
const CONNECT_DIR = path.join(BENCH_DIR, "..", "..", "..", "connect");
let BENCH_HOME = null;

function benchHome() {
  if (!BENCH_HOME) {
    BENCH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "yats-bench-"));
  }
  return BENCH_HOME;
}

function readConnect(agentDir, file) {
  try {
    return fs.readFileSync(path.join(CONNECT_DIR, agentDir, file), "utf8");
  } catch {
    return null;
  }
}

// Inline per-agent instruction files (option A: aggressive "YATS first, max 3
// calls"). Kept inline so the benchmark is self-contained and reproducible when
// run from npm — no dependency on the repo's connect/ directory.
const CLAUDE_SKILL_MD = `---
name: yats
description: YATS has this codebase indexed in a knowledge graph. Use when asked about the code — how something works, architecture, call chains, where something is defined. Use YATS tools first before reading files.
---

# YATS Code Intelligence

This repo is indexed by YATS (mcp__yats__* tools). Every symbol, call, and relationship is in a knowledge graph.

## Golden rule

**YATS first, Read second.** MCP tools return results in milliseconds for ~100 tokens. Reading files costs thousands of tokens and takes seconds.

## Efficient workflow

1. \`search_code\` — natural language query about the code (ALWAYS start here)
2. \`find_symbol\` on top 2-3 hits to get exact locations
3. \`find_callers\` / \`find_callees\` on 1-2 key symbols to trace the flow
4. \`expand_graph\` on seeds to get the full subgraph in one call
5. Only then \`Read\` files at the exact lines YATS gave you

## Rules

- Max 3-5 YATS tool calls per task. Synthesize what you have.
- Never guess symbol names — always start with \`search_code\`.
- Prefer \`expand_graph\` over multiple individual \`find_symbol\` calls.
- If YATS returns empty, try a different query before falling back to file reads.
- Repository name is usually the directory name. Check \`list_repositories\` if unsure.
`;

const CODEX_AGENTS_MD = `# YATS Code Intelligence

This repository is indexed by YATS MCP. You have these tools:
\`search_code\`, \`find_symbol\`, \`find_callers\`, \`find_callees\`, \`expand_graph\`,
\`find_references\`, \`find_implementations\`, \`find_inheritors\`, \`find_routes\`,
\`repository_summary\`, \`architecture_summary\`, \`list_repositories\`.

## ⚠️ ABSOLUTE HARD LIMIT: 3 TOOL CALLS TOTAL

You are allowed **AT MOST 3 YATS tool calls** for this entire task. This is a hard budget, not a suggestion.

- After your 3rd call, you MUST write your final answer immediately.
- Do NOT call \`find_symbol\` separately for every symbol. \`expand_graph\` returns callers + callees + neighbors in ONE call.
- Do NOT re-run \`search_code\` with slightly different wording.
- Do NOT verify each result with another call. Trust the graph.
- Do NOT read source files with shell commands (\`head\`, \`cat\`, \`sed\`, \`rg\`, \`grep\`). YATS already has the symbols and relationships — use the YATS tools instead.
- Every extra call wastes tokens and fails this task.

## Workflow (exactly 3 calls, in this order)

1. \`search_code("<your question>", repository="__REPO_NAME__")\` — call 1
2. \`expand_graph([top 2 symbol ids], repository="__REPO_NAME__")\` — call 2 (full subgraph)
3. \`find_callers("<key symbol>", repository="__REPO_NAME__")\` — call 3 (only if you still need it)
4. STOP. Write the answer.

## Repository

Use \`repository="__REPO_NAME__"\` for every call. Do NOT call \`list_repositories\` — the repo name is already given.
`;

const COPILOT_INSTRUCTIONS_MD = `# YATS Code Intelligence

This repo is indexed by YATS MCP. You have tools: search_code, find_symbol, find_callers, find_callees, expand_graph, find_references, find_implementations, find_inheritors, find_routes, repository_summary, list_repositories.

## Rules
- YATS first, file reads second. YATS is ~100 tokens and instant.
- Max 3 YATS calls per task. After call 3, answer with what you have.
- Start with search_code, then find_symbol on top hits, then expand_graph.
- Do NOT invent answers — verify with YATS or read files.
`;

const CURSOR_RULES_MDC = `# YATS Code Intelligence

This repo is indexed by YATS. Use these MCP tools for code questions:
\`search_code\`, \`find_symbol\`, \`find_callers\`, \`find_callees\`, \`expand_graph\`,
\`find_references\`, \`find_implementations\`, \`find_inheritors\`, \`find_routes\`.

## Rules

- Start with \`search_code\` for any codebase question.
- Max 3 YATS calls per task. Synthesize, don't keep searching.
- YATS returns results in ms. File reads cost thousands of tokens.
- If unsure about repo name, call \`list_repositories\` first.

## Workflow

1. \`search_code("your question", repository="<name>")\`
2. \`find_symbol\` on top hits
3. \`expand_graph\` or \`find_callers\`/\`find_callees\` to trace flow
4. Read files only at exact lines from YATS results
`;

const GEMINI_MD = `# YATS Code Intelligence

This repository is indexed by YATS MCP. You have access to a knowledge graph.

## Tools available
\`search_code\`, \`find_symbol\`, \`find_callers\`, \`find_callees\`, \`expand_graph\`,
\`find_references\`, \`find_implementations\`, \`find_inheritors\`, \`find_routes\`,
\`repository_summary\`, \`architecture_summary\`, \`list_repositories\`.

## GOLDEN RULE: YATS first, files second
- YATS queries cost ~100 tokens, return in milliseconds.
- Reading files costs THOUSANDS of tokens.
- Always try \`search_code()\` BEFORE reading any file.

## Workflow (3 steps max)
1. \`search_code("your question", repository="<name>")\` — ALWAYS start here
2. \`find_symbol(name, repository="<name>")\` on top 2-3 hits
3. \`expand_graph([top1, top2], repository="<name>")\` — callers+callees in one call
4. Only then read files at exact lines from YATS

## Rules
- Max 3 YATS calls per task. Synthesize and answer.
- NEVER guess symbol names — always start with search_code.
- Prefer expand_graph over multiple find_symbol calls.
- Repository name is usually the directory name. Check list_repositories if unsure.
`;

// Private/unknown repos (the LLM has never seen them) — the real proof.
const UNKNOWN_REPOS = [
  {
    name: "hub-lab",
    url: "https://github.com/fvinciarelli/hub-lab.git",
    language: "go",
    known: false,
  },
];

function loadQuestions(lang, repo) {
  const dir = path.join(BENCH_DIR, "questions", lang, repo);
  if (!fs.existsSync(dir)) return [];
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => fs.readFileSync(path.join(dir, f), "utf8").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function loadRepos() {
  const repos = [];
  for (const r of UNKNOWN_REPOS) {
    repos.push({
      ...r,
      defaultPath: path.join(process.env.HOME ?? "/tmp", "repos", r.name),
      questions: loadQuestions(r.language, r.name),
    });
  }
  try {
    const data = JSON.parse(
      fs.readFileSync(path.join(BENCH_DIR, "targets", "repos.json"), "utf8"),
    );
    for (const [lang, entries] of Object.entries(data)) {
      for (const e of entries) {
        repos.push({
          name: e.name,
          url: e.url,
          language: lang,
          known: true,
          defaultPath: path.join(process.env.HOME ?? "/tmp", "repos", e.name),
          questions: loadQuestions(lang, e.name),
        });
      }
    }
  } catch (err) {
    logger.warn(`Could not load repos.json: ${err.message}`);
  }
  return repos.filter((r) => r.questions.length > 0);
}

const KNOWN_REPOS = loadRepos();

/**
 * Each agent: how to run it, how to check it's installed, and how to wire YATS MCP.
 */
const KNOWN_AGENTS = [
  {
    name: "claude",
    cli: "claude",
    checkCmd: "which claude",
    installHint: "npm install -g @anthropic-ai/claude-code",
    needsApiKey: "ANTHROPIC_API_KEY",
    defaultModel: process.env.YATS_BENCH_MODEL ?? "haiku",
    models: [
      { name: "haiku", hint: "fastest & cheapest" },
      { name: "sonnet", hint: "balanced" },
      { name: "opus", hint: "most powerful" },
    ],
    authLabel: "ANTHROPIC_API_KEY (in ~/.yats/.env)",
    needsSkill: true,
    mcpKind: "stdio",
    runCmd: (prompt, repoDir, hasMcp, model) => [
      "-p", prompt,
      "--model", model,
      "--output-format", "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      ...(hasMcp ? ["--mcp-config", "/tmp/yats-bench-mcp.json"] : []),
    ],
  },
  {
    name: "codex",
    cli: "codex",
    checkCmd: "which codex",
    installHint: "npm install -g @openai/codex",
    needsApiKey: "OPENAI_API_KEY",
    defaultModel: "gpt-4.1-mini",
    models: [
      { name: "gpt-4.1-mini", hint: "fastest & cheapest" },
      { name: "gpt-4.1", hint: "balanced" },
      { name: "gpt-5.4", hint: "most powerful" },
    ],
    authLabel: "OPENAI_API_KEY (in ~/.yats/.env)",
    needsSkill: false,
    mcpKind: "codex-config",
    runCmd: (prompt, repoDir, hasMcp, model) => ["exec", "--json", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox", prompt],
  },
  {
    name: "copilot",
    cli: "copilot",
    checkCmd: "which copilot",
    installHint: "npm install -g @github/copilot",
    needsApiKey: "",
    defaultModel: "default",
    models: [
      { name: "default", hint: "Copilot-managed model" },
    ],
    authLabel: "copilot auth (consent asked at start)",
    needsSkill: false,
    mcpKind: "copilot-config",
    runCmd: (prompt, repoDir, hasMcp, model) => [
      "-p", prompt,
      "--output-format", "json",
      "--allow-all",
      ...(hasMcp ? ["--additional-mcp-config", "@/tmp/copilot-mcp.json"] : []),
    ],
  },
  {
    name: "cursor",
    cli: "cursor-agent",
    checkCmd: "which cursor-agent",
    installHint: "https://cursor.com/docs/cli — install the cursor-agent CLI",
    needsApiKey: "",
    defaultModel: "claude-sonnet-5",
    models: [
      { name: "claude-sonnet-5", hint: "balanced" },
      { name: "claude-haiku-5", hint: "fast & cheap" },
    ],
    authLabel: "cursor-agent login",
    needsSkill: false,
    mcpKind: "cursor-config",
    runCmd: (prompt, repoDir, hasMcp, model) => [
      "-p", prompt,
      "--output-format", "stream-json",
      "--force",
      "--model", model,
    ],
  },
  {
    name: "gemini",
    cli: "gemini",
    checkCmd: "which gemini",
    installHint: "npm install -g @google/gemini-cli",
    needsApiKey: "GEMINI_API_KEY",
    defaultModel: process.env.YATS_BENCH_GEMINI_MODEL ?? "gemini-flash-latest",
    models: [
      { name: "gemini-flash-latest", hint: "fastest & cheapest" },
      { name: "gemini-2.5-pro", hint: "most powerful" },
      { name: "gemini-pro-latest", hint: "balanced" },
    ],
    authLabel: "GEMINI_API_KEY (in ~/.yats/.env)",
    needsSkill: false,
    mcpKind: "gemini-config",
    runCmd: (prompt, repoDir, hasMcp, model) => [
      "-p", prompt,
      "--model", model,
      "--output-format", "stream-json",
      "--yolo",
    ],
  },
];

// ============================================================
// Wizard steps (modern UI)
// ============================================================

async function selectAgent() {
  const opts = KNOWN_AGENTS.map((a) => {
    const installed = isInstalled(a.cli);
    const hasKey = !a.needsApiKey || hasApiKey(a.needsApiKey);
    let hint = installed ? "installed" : "not installed";
    if (installed && a.needsApiKey && !hasKey) hint = `missing ${a.needsApiKey} in ~/.yats/.env`;
    return { label: a.name, hint, ok: installed && hasKey, value: a };
  });
  return select("Select your AI agent", opts);
}

async function selectModel(agent) {
  if (agent.models.length <= 1) {
    selectedModel = agent.models[0].name;
    return;
  }
  const opts = agent.models.map((m) => ({
    label: m.name,
    hint: m.hint,
    value: m.name,
  }));
  selectedModel = await select(`Model for ${agent.name}`, opts);
  console.log(`  ${A.green}✓${A.reset} Model: ${A.bold}${selectedModel}${A.reset}`);
}

async function selectWorkDir() {
  const def = path.join(process.cwd(), "repos");
  const input = (await askLine(`\n  Where to download repos? [${def}]: `)).trim();
  workDir = toAbsolute(input || def);
  for (const r of KNOWN_REPOS) {
    r.defaultPath = path.join(workDir, r.name);
  }
  console.log(`  ${A.green}✓${A.reset} Repos will be saved to ${workDir}`);
}

async function selectRepo() {
  const opts = KNOWN_REPOS.map((r) => {
    const exists = fs.existsSync(r.defaultPath) && fs.existsSync(path.join(r.defaultPath, ".git"));
    return {
      label: r.name,
      hint: r.known
        ? `${r.language}${exists ? "" : " · will clone"}`
        : `${r.language} · unknown — proposed by YATS.AI`,
      accent: !r.known,
      value: r,
    };
  });
  opts.push({
    label: "Custom repo",
    hint: "your own — local path or git URL",
    accent: true,
    value: "__custom__",
  });
  return select("Select a repository", opts);
}

async function selectCustomRepo() {
  console.log(`\n  ${A.bold}${A.purple}Custom repo${A.reset}\n`);
  const loc = (await askLine("  Local path or git URL: ")).trim();
  if (!loc) {
    console.log(`  ${A.red}✖ Empty location. Aborting.${A.reset}`);
    process.exit(1);
  }

  const isUrl = /^(https?:\/\/|git@|ssh:\/\/)/i.test(loc);
  let name, url, defaultPath;
  if (isUrl) {
    name = loc.split("/").pop().replace(/\.git$/, "") || "custom";
    url = loc;
    defaultPath = path.join(workDir, name);
  } else {
    defaultPath = toAbsolute(loc);
    name = path.basename(defaultPath);
    url = null;
  }

  const lang = (await askLine("  Language [auto]: ")).trim() || "auto";

  console.log(`\n  ${A.dim}Question (Enter for a default architecture question):${A.reset}`);
  const q = (await askLine("  > ")).trim();
  const question = q || "Explain the architecture of this codebase: the key components, how they connect, and the main data flow.";

  return {
    name,
    url,
    language: lang,
    known: false,
    defaultPath,
    questions: [question],
    custom: true,
  };
}

async function selectQuestion(repo) {
  const opts = repo.questions.map((q) => ({
    label: q.length > 76 ? q.slice(0, 76) + "…" : q,
    hint: null,
    value: q,
  }));
  return select("Pick a question", opts);
}

async function selectRuns() {
  const opts = [1, 2, 3].map((n) => ({
    label: `${n} run${n > 1 ? "s" : ""}`,
    hint: n === 1 ? "recommended" : null,
    value: n,
  }));
  return select("Runs per condition", opts);
}

// ============================================================
// Setup
// ============================================================

async function ensureRepo(repo) {
  const repoPath = path.resolve(repo.defaultPath);
  const gitDir = path.join(repoPath, ".git");
  if (fs.existsSync(repoPath) && fs.existsSync(gitDir)) {
    console.log(`  ${A.green}✓${A.reset} Repo at ${repoPath}`);
    return repoPath;
  }
  if (repo.url) {
    if (fs.existsSync(repoPath)) {
      console.log(`  ${A.yellow}⚠${A.reset} Removing incomplete clone at ${repoPath}...`);
      fs.rmSync(repoPath, { recursive: true, force: true });
    }
    const parent = path.dirname(repoPath);
    fs.mkdirSync(parent, { recursive: true });
    await runWithSpinner(`Cloning ${repo.name}...`, () => new Promise((resolve, reject) => {
      const proc = spawn("git", ["clone", "--depth", "1", repo.url, repoPath], { stdio: ["ignore", "pipe", "pipe"] });
      proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`git clone exited with code ${code}`))));
      proc.on("error", reject);
    }));
    console.log(`  ${A.green}✓${A.reset} Cloned to ${repoPath}`);
    return repoPath;
  }
  logger.error(`Path not found: ${repoPath}`);
  process.exit(1);
}

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "__pycache__", "vendor", "target", "bin", "obj", ".venv", "venv", ".yarn", ".pnpm"]);

function countFiles(dir) {
  let n = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      if (IGNORE_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) n += countFiles(full);
      else if (e.isFile()) n++;
    }
  } catch {
    /* ignore unreadable dirs */
  }
  return n;
}

function getRepoSummary(repoName) {
  try {
    const out = execSync(`yats summary "${repoName}"`, { encoding: "utf8", stdio: "pipe", timeout: 30_000 });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function isIndexedAtPath(repoPath) {
  try {
    const out = execSync("yats list", { encoding: "utf8", stdio: "pipe" });
    // yats list prints "  <name>  →  <rootPath>". YATS identifies repos by
    // rootPath, so compare exact paths (not substring — avoids hub-lab matching hub-lab-2).
    return out.split("\n").some((line) => {
      const arrow = line.lastIndexOf("→");
      if (arrow === -1) return false;
      return line.slice(arrow + 1).trim() === repoPath;
    });
  } catch {
    /* not indexed yet */
    return false;
  }
}

async function ensureIndexed(repo, repoPath) {
  console.log(`\n  ${A.dim}Checking if ${repo.name} is indexed...${A.reset}`);
  const already = isIndexedAtPath(repoPath);

  if (!already) {
    await runWithSpinner(`Indexing ${repo.name}...`, () => new Promise((resolve, reject) => {
      const proc = spawn("yats", ["index", repoPath], { stdio: ["ignore", "pipe", "pipe"] });
      proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`yats index exited with code ${code}`))));
      proc.on("error", reject);
    }));
    console.log(`  ${A.green}✓${A.reset} Indexed`);
  } else {
    console.log(`  ${A.green}✓${A.reset} Already indexed`);
  }

  const summary = getRepoSummary(repo.name);
  const files = countFiles(repoPath);
  const rows = [
    ["Files", files.toLocaleString()],
    ["Symbols", (summary?.totalSymbols ?? 0).toLocaleString()],
    ["Relationships", (summary?.totalRelationships ?? 0).toLocaleString()],
    ["Languages", (summary?.languages || []).join(", ") || "—"],
  ];
  const w1 = Math.max(...rows.map((r) => r[0].length));
  const w2 = Math.max(...rows.map((r) => r[1].length));
  const border = (l, m, r) => "  " + l + "─".repeat(w1 + 2) + m + "─".repeat(w2 + 2) + r;
  const row = (a, b) => `  │ ${a.padEnd(w1)} │ ${b.padEnd(w2)} │`;
  console.log(border("┌", "┬", "┐"));
  for (const [a, b] of rows) console.log(row(a, b));
  console.log(border("└", "┴", "┘"));
}

function writeSkill(repoPath, withYats) {
  const skillDir = path.join(repoPath, ".claude", "skills", "yats");
  if (withYats) {
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), CLAUDE_SKILL_MD);
  } else {
    fs.rmSync(skillDir, { recursive: true, force: true });
  }
}

function setupAgent(agent, repoPath, withYats) {
  const home = path.join(benchHome(), agent.name);
  fs.mkdirSync(home, { recursive: true });

  switch (agent.mcpKind) {
    case "stdio": { // Claude
      process.env.CLAUDE_CONFIG_DIR = home;
      if (agent.needsSkill) writeSkill(repoPath, withYats);
      if (withYats) {
        const mcp = readConnect("claude", "mcp.json")
          ?? JSON.stringify({ mcpServers: { yats: { command: "yats", args: ["bridge"] } } });
        fs.writeFileSync("/tmp/yats-bench-mcp.json", mcp);
      }
      break;
    }

    case "codex-config": { // Codex
      process.env.CODEX_HOME = home;
      if (process.env.OPENAI_API_KEY) {
        fs.writeFileSync(path.join(home, "auth.json"), JSON.stringify({ OPENAI_API_KEY: process.env.OPENAI_API_KEY }));
      }
      fs.rmSync(path.join(repoPath, ".codex", "config.toml"), { force: true });
      const model = selectedModel ?? agent.defaultModel;
      const base = readConnect("codex", "config.toml")
        ?? `model = "gpt-4.1-mini"\nsandbox_mode = "danger-full-access"\napproval_policy = "never"\n\n[features]\nmulti_agent = false\n`;
      let config = base.replace(/^model\s*=.*$/m, `model = "${model}"`);
      if (withYats) {
        if (!/\[mcp_servers\.yats\]/.test(config)) {
          config += `\n[mcp_servers.yats]\ncommand = "yats"\nargs = ["bridge"]\n`;
        }
      } else {
        config = config.replace(/\n\[mcp_servers\.yats\][\s\S]*$/, "");
      }
      fs.writeFileSync(path.join(home, "config.toml"), config);
      if (withYats) {
        const content = CODEX_AGENTS_MD.replaceAll("__REPO_NAME__", path.basename(repoPath));
        fs.writeFileSync(path.join(repoPath, "AGENTS.md"), content);
      } else {
        fs.rmSync(path.join(repoPath, "AGENTS.md"), { force: true });
      }
      break;
    }

    case "copilot-config": { // Copilot
      process.env.COPILOT_HOME = home;
      // Only copy the user's auth metadata if they explicitly consented in checkAgent().
      if (copilotConsent) {
        const realConfig = path.join(os.homedir(), ".copilot", "config.json");
        if (fs.existsSync(realConfig)) {
          fs.copyFileSync(realConfig, path.join(home, "config.json"));
        }
      }
      if (withYats) {
        const bridge = path.join(BENCH_DIR, "adapters", "mcp-bridge-stdio.cjs");
        const mcp = JSON.stringify({
          mcpServers: { yats: { type: "local", command: "node", args: [bridge, "--stdio"] } },
        });
        fs.writeFileSync("/tmp/copilot-mcp.json", mcp);
        const ghDir = path.join(repoPath, ".github");
        fs.mkdirSync(ghDir, { recursive: true });
        fs.writeFileSync(path.join(ghDir, "copilot-instructions.md"), COPILOT_INSTRUCTIONS_MD);
      } else {
        fs.rmSync(path.join(repoPath, ".github", "copilot-instructions.md"), { force: true });
      }
      break;
    }

    case "cursor-config": { // Cursor
      if (withYats) {
        const mcp = readConnect("cursor", "mcp.json")
          ?? JSON.stringify({ mcpServers: { yats: { url: "http://localhost:5555/mcp" } } });
        fs.writeFileSync("/tmp/cursor-mcp.json", mcp);
        process.env.CURSOR_MCP_CONFIG = "/tmp/cursor-mcp.json";
        const rulesDir = path.join(repoPath, ".cursor", "rules");
        fs.mkdirSync(rulesDir, { recursive: true });
        fs.writeFileSync(path.join(rulesDir, "yats.mdc"), CURSOR_RULES_MDC);
      } else {
        delete process.env.CURSOR_MCP_CONFIG;
        fs.rmSync(path.join(repoPath, ".cursor", "rules", "yats.mdc"), { force: true });
      }
      break;
    }

    case "gemini-config": { // Gemini
      process.env.GEMINI_CLI_HOME = home;
      process.env.GEMINI_CLI_TRUST_WORKSPACE = "true";
      fs.rmSync(path.join(repoPath, ".gemini", "settings.json"), { force: true });
      if (withYats) {
        const mcp = readConnect("gemini", "mcp.json")
          ?? JSON.stringify({ mcpServers: { yats: { command: "yats", args: ["bridge"], trust: true } } });
        const settingsDir = path.join(home, ".gemini");
        fs.mkdirSync(settingsDir, { recursive: true });
        fs.writeFileSync(path.join(settingsDir, "settings.json"), mcp);
        fs.writeFileSync(path.join(repoPath, "GEMINI.md"), GEMINI_MD);
      } else {
        fs.rmSync(path.join(home, ".gemini", "settings.json"), { force: true });
        fs.rmSync(path.join(repoPath, "GEMINI.md"), { force: true });
      }
      break;
    }
  }
}

async function checkAgent(agent) {
  console.log(`\n  ${A.dim}Checking ${agent.name}...${A.reset}`);
  if (!isInstalled(agent.cli)) {
    console.log(`  ${A.red}✖ ${agent.cli} is not installed.${A.reset}`);
    console.log(`     Install: ${agent.installHint}`);
    return false;
  }
  console.log(`  ${A.green}✓${A.reset} ${agent.cli} found`);

  // API-key agents (claude/codex/gemini) read keys from ~/.yats/.env
  if (agent.needsApiKey) {
    if (!hasApiKey(agent.needsApiKey)) {
      console.log(`  ${A.red}✖ ${agent.needsApiKey} not set.${A.reset}`);
      console.log(`     Add it to ${A.bold}~/.yats/.env${A.reset} to use ${agent.name}.`);
      return false;
    }
    console.log(`  ${A.green}✓${A.reset} ${agent.needsApiKey} found in ~/.yats/.env`);
    return true;
  }

  // copilot / cursor use their own OAuth login (no API key in .env)
  if (agent.name === "copilot") {
    const realConfig = path.join(os.homedir(), ".copilot", "config.json");
    if (fs.existsSync(realConfig)) {
      const use = await select("Copilot login", [
        { label: "Use my existing Copilot login (copy ~/.copilot/config.json)", value: true },
        { label: "No — cancel", value: false },
      ]);
      if (!use) {
        console.log(`  ${A.yellow}✖ Cancelled${A.reset}`);
        return false;
      }
      copilotConsent = true;
      console.log(`  ${A.green}✓${A.reset} Will use your existing Copilot login`);
    } else {
      console.log(`  ${A.red}✖ No ~/.copilot/config.json found.${A.reset}`);
      console.log(`     Run ${A.bold}copilot auth${A.reset} first.`);
      return false;
    }
    return true;
  }

  console.log(`  ${A.dim}Auth:  ${agent.authLabel}${A.reset}`);
  return true;
}

// ============================================================
// Run
// ============================================================

let agentActivity = "";

// Generic activity extractor — tails the agent's JSONL log and shows the most
// recent meaningful event (a tool call, or the event type). No per-agent parsing.
function tailAgentActivity(logFile) {
  try {
    const size = fs.statSync(logFile).size;
    if (size === 0) { agentActivity = ""; return; }
    const fd = fs.openSync(logFile, "r");
    const len = Math.min(size, 32 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);

    const events = [];
    for (const line of buf.toString("utf8").split("\n")) {
      const l = line.trim();
      if (!l) continue;
      try {
        const e = JSON.parse(l);
        if (e && typeof e === "object") events.push(e);
      } catch { /* partial line */ }
    }

    const toolName = (e) => {
      const name =
        (typeof e.name === "string" && e.name) ||
        e.tool_name ||
        e.tool_call?.name ||
        e.tool_use?.name ||
        e.tool?.name ||
        e.item?.name ||
        e.item?.tool ||
        (Array.isArray(e.message?.content) &&
          e.message.content.find((c) => c && c.type === "tool_use")?.name);
      return typeof name === "string" && name ? name : null;
    };

    // Prefer the most recent tool call in the tail
    for (let i = events.length - 1; i >= 0; i--) {
      const name = toolName(events[i]);
      if (!name) continue;
      const e = events[i];
      const input =
        e.input || e.arguments || e.item?.input || e.item?.arguments ||
        e.tool_call?.input || e.tool_call?.arguments ||
        e.tool_use?.input ||
        (Array.isArray(e.message?.content) &&
          e.message.content.find((c) => c && c.type === "tool_use")?.input);
      let detail = input?.file_path ?? input?.query ?? input?.pattern ?? input?.command ?? input?.url ?? "";
      if (!detail && input && typeof input === "object") {
        detail = Object.values(input).find((v) => typeof v === "string") ?? "";
      }
      agentActivity = `${name}${detail ? " " + String(detail).slice(0, 48) : ""}`;
      return;
    }

    // Fallback: most recent event type
    const last = events[events.length - 1];
    if (last && typeof last.type === "string") {
      agentActivity = `${last.type}${last.subtype ? ":" + last.subtype : ""}`;
    }
  } catch {
    /* file not ready yet */
  }
}

async function runWithSpinner(label, fn) {
  if (!isTTY) {
    console.log(`  ${A.dim}${label}...${A.reset}`);
    return fn();
  }
  agentActivity = "";
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const start = Date.now();
  const width = Math.max(20, (process.stdout.columns || 80) - 1);
  const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const draw = () => {
    const secs = Math.floor((Date.now() - start) / 1000);
    const prefix = `  ${A.cyan}${frames[i % frames.length]}${A.reset} ${A.dim}${label}${A.reset} ${A.gray}${secs}s${A.reset}  ${A.dim}`;
    const suffix = `${A.reset}`;
    const budget = Math.max(0, width - strip(prefix).length - strip(suffix).length);
    const activity = agentActivity.length > budget
      ? agentActivity.slice(0, Math.max(0, budget - 1)) + "…"
      : agentActivity;
    const line = prefix + activity + suffix;
    const visible = strip(line).length;
    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 0);
    process.stdout.write(line + (visible < width ? " ".repeat(width - visible) : ""));
    i++;
  };
  draw();
  const id = setInterval(draw, 80);
  try {
    return await fn();
  } finally {
    clearInterval(id);
    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 0);
  }
}

function runAgent(agent, prompt, repoPath, withYats, logFile, timeoutSec = 600) {
  const model = selectedModel ?? agent.defaultModel;
  // Claude: raw question (end-user behavior). Other agents keep the neutral
  // "do not modify files" guard.
  const wrapped = agent.name === "claude"
    ? prompt
    : `Do NOT create, write, edit, or delete any files, and do not run commands that modify the repository.\n\nQuestion:\n${prompt}`;
  const args = agent.runCmd(wrapped, repoPath, withYats, model);

  return new Promise((resolve) => {
    const proc = spawn(agent.cli, args, {
      cwd: repoPath,
      stdio: ["ignore", fs.openSync(logFile, "w"), "ignore"],
      timeout: timeoutSec * 1000,
    });

    const watcher = setInterval(() => tailAgentActivity(logFile), 400);

    proc.on("close", (code, signal) => {
      clearInterval(watcher);
      resolve({ exitCode: code ?? -1, signal });
    });

    proc.on("error", (err) => {
      clearInterval(watcher);
      fs.appendFileSync(logFile, `\nSPAWN_ERROR: ${err.message}\n`);
      resolve({ exitCode: -1, signal: null });
    });
  });
}

// ============================================================
// Parse results
// ============================================================

export function extractAnswer(events, agentName) {
  const parts = [];
  const push = (s) => { if (typeof s === "string" && s.trim()) parts.push(s.trim()); };

  if (agentName === "codex") {
    for (const e of events) {
      if (e.type === "item.completed" && e.item?.type === "agent_message") push(e.item.text);
    }
  } else if (agentName === "claude" || agentName === "cursor") {
    for (const e of events) {
      if (e.type === "assistant" && Array.isArray(e.message?.content)) {
        for (const c of e.message.content) if (c?.type === "text") push(c.text);
      } else if (e.type === "stream_event" && e.event?.type === "content_block_delta" && e.event.delta?.type === "text_delta") {
        push(e.event.delta.text);
      }
    }
  } else if (agentName === "gemini") {
    for (const e of events) {
      if (e.type === "message" && e.role === "assistant") {
        if (typeof e.content === "string") push(e.content);
        else if (Array.isArray(e.content)) for (const c of e.content) push(typeof c === "string" ? c : c?.text);
      }
    }
  } else if (agentName === "copilot") {
    for (const e of events) {
      if (e.type === "assistant.message") {
        const c = e.data?.content ?? e.content;
        if (typeof c === "string") push(c);
        else if (Array.isArray(c)) for (const b of c) push(typeof b === "string" ? b : b?.text);
      }
    }
  }

  return parts.join("\n\n");
}

function printAnswerPreview(answer, max = 600) {
  if (!answer) return;
  const text = answer.length > max ? answer.slice(0, max).replace(/\n+$/, "") + "\n    …" : answer;
  console.log(`    ${A.dim}— answer —${A.reset}`);
  for (const line of text.split("\n")) {
    console.log(`    ${A.dim}${line}${A.reset}`);
  }
}

function parseResult(logFile, agentName) {
  try {
    const content = fs.readFileSync(logFile, "utf-8");
    const events = [];
    for (const line of content.split("\n")) {
      const l = line.trim();
      if (!l) continue;
      try {
        const j = JSON.parse(l);
        if (j && typeof j === "object") events.push(j);
      } catch {
        /* skip non-JSON lines */
      }
    }

    let tokens = 0;
    let outputTokens = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    let cost = 0;
    let duration = 0;
    let errorMsg = null;

    // Claude / Cursor: "result" events with modelUsage
    const results = events.filter((e) => e.type === "result");
    if (results.length) {
      const last = results[results.length - 1];
      if (last.is_error || last.is_api_error_message) {
        errorMsg = last.result || last.error || "agent reported an error";
      }
      if (last.status === "error") {
        errorMsg = last.error?.message || last.result || "agent reported an error";
      }
      const mu = last.modelUsage ?? {};
      for (const k of Object.keys(mu)) {
        tokens += (mu[k].inputTokens ?? 0) + (mu[k].outputTokens ?? 0) +
          (mu[k].cacheReadInputTokens ?? 0) + (mu[k].cacheCreationInputTokens ?? 0);
        outputTokens += mu[k].outputTokens ?? 0;
        cacheRead += mu[k].cacheReadInputTokens ?? 0;
        cacheWrite += mu[k].cacheCreationInputTokens ?? 0;
      }
      cost = last.total_cost_usd ?? cost;
      duration = last.duration_ms ?? duration;
    }

    // Codex: "turn.failed" or "error" events
    if (!errorMsg) {
      for (const e of events) {
        if (e.type === "turn.failed" && e.error?.message) {
          errorMsg = e.error.message;
          break;
        }
        if (e.type === "error" && e.message) {
          errorMsg = e.message;
          break;
        }
      }
    }

    // Codex: "turn.completed" events with usage
    for (const e of events) {
      if (e.type === "turn.completed" && e.usage) {
        const u = e.usage;
        tokens += (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.reasoning_output_tokens ?? 0);
        outputTokens += u.output_tokens ?? 0;
        cacheRead += u.cached_input_tokens ?? 0;
      }
    }

    // Copilot (legacy): "assistant.usage" events
    for (const e of events) {
      if (e.type === "assistant.usage") {
        tokens += (e.inputTokens ?? 0) + (e.outputTokens ?? 0) + (e.cacheReadTokens ?? 0);
        outputTokens += e.outputTokens ?? 0;
        cacheRead += e.cacheReadTokens ?? 0;
      }
    }

    // Copilot 1.x: "assistant.message" carries outputTokens. Input tokens are NOT
    // exposed in the JSON stream, so for Copilot `tokens` == output tokens only.
    for (const e of events) {
      if (e.type === "assistant.message" && e.data && typeof e.data.outputTokens === "number") {
        outputTokens += e.data.outputTokens;
        tokens += e.data.outputTokens;
      }
    }

    // Copilot 1.x credits (nano AI units) — the only full-cost signal available.
    let nanoAiu = 0;
    for (const e of events) {
      if (e.type === "session.usage_checkpoint" && e.data && typeof e.data.totalNanoAiu === "number") {
        nanoAiu = e.data.totalNanoAiu;
      }
    }

    // Gemini: "result" events with stats
    for (const e of events) {
      if (e.type === "result" && e.stats) {
        tokens += (e.stats.input_tokens ?? 0) + (e.stats.output_tokens ?? 0);
        outputTokens += e.stats.output_tokens ?? 0;
      }
    }

    // Tool calls
    const toolCalls = {};
    for (const e of events) {
      if (e.type === "assistant" && e.message?.content) {
        for (const c of e.message.content) {
          if (c.type === "tool_use") toolCalls[c.name] = (toolCalls[c.name] ?? 0) + 1;
        }
      }
      if (e.type === "item.completed" && e.item) {
        const it = e.item;
        if (it.type !== "agent_message" && it.type !== "message") {
          const name = it.tool || it.name || it.type;
          if (name) toolCalls[name] = (toolCalls[name] ?? 0) + 1;
        }
      }
      if (e.type === "tool_use" && e.tool_name) {
        toolCalls[e.tool_name] = (toolCalls[e.tool_name] ?? 0) + 1;
      }
    }

    const YATS_TOOLS = new Set([
      "search_code", "search_documentation", "search_similar",
      "find_symbol", "find_references", "find_callers", "find_callees",
      "find_implementations", "find_inheritors", "find_tests",
      "find_routes", "find_configuration", "expand_graph", "related_symbols",
      "list_symbols", "list_repositories", "repository_summary",
      "architecture_summary", "delete_repository",
    ]);
    const yatsQueries = Object.entries(toolCalls)
      .filter(([k]) => /yats|mcp__/i.test(k) || YATS_TOOLS.has(k))
      .reduce((sum, [, v]) => sum + v, 0);
    const fileReads = (toolCalls["Read"] ?? 0) + (toolCalls["read_file"] ?? 0);
    const bashCmds = (toolCalls["Bash"] ?? 0) + (toolCalls["bash"] ?? 0) + (toolCalls["command_execution"] ?? 0);

    let contentChars = 0;
    for (const e of events) {
      if (e.type === "user" && e.message?.content) {
        for (const c of e.message.content) {
          if (c.type === "tool_result") {
            let t = c.content ?? "";
            if (Array.isArray(t)) t = t.map((x) => x.text ?? "").join("");
            contentChars += String(t).length;
          }
        }
      }
    }

    return {
      tokens, cost, outputTokens, cacheRead, cacheWrite, toolCalls,
      fileReads, bashCmds, yatsQueries, contentChars, nanoAiu, duration,
      answer: extractAnswer(events, agentName),
      error: errorMsg, logFile,
    };
  } catch (err) {
    return { error: err.message, logFile };
  }
}

// ============================================================
// Output
// ============================================================

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function printTable(title, runs, withYats) {
  const label = withYats ? "With YATS" : "Baseline";
  const cols = [
    { h: "Run", w: 5, right: false },
    { h: "Tokens", w: 10, right: true },
    { h: "Cost", w: 8, right: true },
    { h: "Output", w: 7, right: true },
    { h: "Reads", w: 6, right: true },
    { h: "Bash", w: 5, right: true },
    { h: "YATS", w: 5, right: true },
    { h: "Time", w: 8, right: true },
    { h: "Result", w: 8, right: false },
  ];
  const cell = (txt, w, right) => {
    const s = String(txt);
    return right ? s.padStart(w) : s.padEnd(w);
  };
  const row = (vals) => "  │" + vals.map((v, i) => " " + cell(v, cols[i].w, cols[i].right) + " ").join("│") + "│";
  const border = (l, m, r) => "  " + l + cols.map((c) => "─".repeat(c.w + 2)).join(m) + r;

  console.log(`\n  ${A.bold}${title} — ${label}${A.reset}`);
  console.log(border("┌", "┬", "┐"));
  console.log(row(cols.map((c) => c.h)));
  console.log(border("├", "┼", "┤"));
  for (const r of runs) {
    const status = r.error ? "ERROR" : "OK";
    console.log(row([
      String(r.run),
      r.tokens.toLocaleString(),
      "$" + r.cost.toFixed(3),
      String(r.outputTokens),
      String(r.fileReads),
      String(r.bashCmds),
      String(r.yatsQueries),
      fmtDuration(r.duration ?? 0),
      status,
    ]));
  }
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const good = runs.filter((r) => !r.error);
  if (good.length) {
    console.log(border("├", "┼", "┤"));
    console.log(row([
      "AVG",
      Math.round(avg(good.map((r) => r.tokens))).toLocaleString(),
      "$" + avg(good.map((r) => r.cost)).toFixed(3),
      String(Math.round(avg(good.map((r) => r.outputTokens)))),
      String(Math.round(avg(good.map((r) => r.fileReads)))),
      String(Math.round(avg(good.map((r) => r.bashCmds)))),
      String(Math.round(avg(good.map((r) => r.yatsQueries)))),
      fmtDuration(avg(good.map((r) => r.duration ?? 0))),
      "",
    ]));
  }
  console.log(border("└", "┴", "┘"));
}

function printCopilotTable(title, runs, withYats) {
  const label = withYats ? "With YATS" : "Baseline";
  const cols = [
    { h: "Run", w: 5, right: false },
    { h: "AIU (cost)", w: 12, right: true },
    { h: "Time", w: 8, right: true },
    { h: "Result", w: 8, right: false },
  ];
  const cell = (txt, w, right) => {
    const s = String(txt);
    return right ? s.padStart(w) : s.padEnd(w);
  };
  const row = (vals) => "  │" + vals.map((v, i) => " " + cell(v, cols[i].w, cols[i].right) + " ").join("│") + "│";
  const border = (l, m, r) => "  " + l + cols.map((c) => "─".repeat(c.w + 2)).join(m) + r;

  console.log(`\n  ${A.bold}${title} — ${label}${A.reset}`);
  console.log(border("┌", "┬", "┐"));
  console.log(row(cols.map((c) => c.h)));
  console.log(border("├", "┼", "┤"));
  for (const r of runs) {
    const status = r.error ? "ERROR" : "OK";
    console.log(row([
      String(r.run),
      ((r.nanoAiu ?? 0) / 1e9).toFixed(3),
      fmtDuration(r.duration ?? 0),
      status,
    ]));
  }
  const good = runs.filter((r) => !r.error);
  if (good.length) {
    const avg = (arr, f) => arr.reduce((a, b) => a + f(b), 0) / arr.length;
    console.log(border("├", "┼", "┤"));
    console.log(row([
      "AVG",
      (avg(good, (r) => r.nanoAiu ?? 0) / 1e9).toFixed(3),
      fmtDuration(avg(good, (r) => r.duration ?? 0)),
      "",
    ]));
  }
  console.log(border("└", "┴", "┘"));
}

function printComparison(baseline, yats) {
  const goodB = baseline.filter((r) => !r.error);
  const goodY = yats.filter((r) => !r.error);
  if (!goodB.length || !goodY.length) {
    console.log(`\n  ${A.yellow}⚠ No valid results to compare.${A.reset}`);
    return;
  }

  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const tB = avg(goodB.map((r) => r.tokens));
  const tY = avg(goodY.map((r) => r.tokens));
  const cB = avg(goodB.map((r) => r.cost));
  const cY = avg(goodY.map((r) => r.cost));
  const rB = avg(goodB.map((r) => r.fileReads));
  const rY = avg(goodY.map((r) => r.fileReads));
  const bB = avg(goodB.map((r) => r.bashCmds));
  const bY = avg(goodY.map((r) => r.bashCmds));
  const dB = avg(goodB.map((r) => r.duration ?? 0));
  const dY = avg(goodY.map((r) => r.duration ?? 0));

  if (tB <= 0) {
    console.log(`\n  ${A.yellow}⚠ Baseline returned 0 tokens — the agent likely failed (check credits/auth).${A.reset}`);
    return;
  }

  const W = 46;
  const n = (x) => Math.round(x).toLocaleString();
  const pct = (a, b) => ((a - b) / a * 100);
  const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const pad = (s) => s + " ".repeat(Math.max(0, W - strip(s).length));
  const line = (txt) => "  ║ " + pad(txt) + " ║";

  const sign = (p) => {
    if (p > 0) return `${A.green}↓ ${Math.abs(p).toFixed(1).padStart(5)}%${A.reset}`;
    if (p < 0) return `${A.red}↑ ${Math.abs(p).toFixed(1).padStart(5)}%${A.reset}`;
    return `${A.dim}·    0.0%${A.reset}`;
  };

  const tokenSave = pct(tB, tY);
  const costSave = cB > 0 ? pct(cB, cY) : null;
  const readSave = rB ? pct(rB, rY) : 0;
  const bashSave = bB ? pct(bB, bY) : 0;
  const timeSave = dB ? pct(dB, dY) : 0;

  const costCell = cB > 0 ? `$${cB.toFixed(3)} → $${cY.toFixed(3)}` : `${A.dim}n/a${A.reset}`;

  console.log("  ╔" + "═".repeat(W + 2) + "╗");
  console.log("  ║ " + "SAVINGS (YATS vs Baseline)".padEnd(W) + " ║");
  console.log("  ╠" + "═".repeat(W + 2) + "╣");
  console.log(line(`Tokens:      ${n(tB).padStart(8)} → ${n(tY).padStart(8)}   ${sign(tokenSave)}`));
  console.log(line(`Cost:        ${costCell}   ${costSave === null ? `${A.dim}n/a${A.reset}` : sign(costSave)}`));
  console.log(line(`File reads:  ${n(rB).padStart(5)} → ${n(rY).padStart(5)}   ${sign(readSave)}`));
  console.log(line(`Bash cmds:   ${n(bB).padStart(5)} → ${n(bY).padStart(5)}   ${sign(bashSave)}`));
  console.log(line(`Time:        ${fmtDuration(dB).padStart(8)} → ${fmtDuration(dY).padStart(8)}   ${sign(timeSave)}`));
  console.log("  ╚" + "═".repeat(W + 2) + "╝");
}

function printCopilotComparison(baseline, yats) {
  const goodB = baseline.filter((r) => !r.error);
  const goodY = yats.filter((r) => !r.error);
  if (!goodB.length || !goodY.length) {
    console.log(`\n  ${A.yellow}⚠ No valid results to compare.${A.reset}`);
    return;
  }

  const avg = (arr, f) => arr.reduce((a, b) => a + f(b), 0) / arr.length;
  const aB = avg(goodB, (r) => r.nanoAiu ?? 0);
  const aY = avg(goodY, (r) => r.nanoAiu ?? 0);
  const dB = avg(goodB, (r) => r.duration ?? 0);
  const dY = avg(goodY, (r) => r.duration ?? 0);

  if (aB <= 0) {
    console.log(`\n  ${A.yellow}⚠ Baseline used 0 AIU — the agent likely failed (check credits/auth).${A.reset}`);
    return;
  }

  const W = 46;
  const pct = (a, b) => ((a - b) / a * 100);
  const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const pad = (s) => s + " ".repeat(Math.max(0, W - strip(s).length));
  const line = (txt) => "  ║ " + pad(txt) + " ║";
  const sign = (p) => {
    if (p > 0) return `${A.green}↓ ${Math.abs(p).toFixed(1).padStart(5)}%${A.reset}`;
    if (p < 0) return `${A.red}↑ ${Math.abs(p).toFixed(1).padStart(5)}%${A.reset}`;
    return `${A.dim}·    0.0%${A.reset}`;
  };
  const aiu = (x) => (x / 1e9).toFixed(3);

  console.log("  ╔" + "═".repeat(W + 2) + "╗");
  console.log("  ║ " + "SAVINGS (YATS vs Baseline)".padEnd(W) + " ║");
  console.log("  ╠" + "═".repeat(W + 2) + "╣");
  console.log(line(`AIU (cost):  ${aiu(aB).padStart(7)} → ${aiu(aY).padStart(7)}   ${sign(pct(aB, aY))}`));
  console.log(line(`Time:        ${fmtDuration(dB).padStart(8)} → ${fmtDuration(dY).padStart(8)}   ${sign(pct(dB, dY))}`));
  console.log("  ╚" + "═".repeat(W + 2) + "╝");
}

function saveResult(entry) {
  const file = path.join(BENCH_DIR, "results.json");
  let data = { runs: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(parsed.runs)) data = parsed;
  } catch {
    /* start fresh */
  }
  data.runs.push(entry);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

// ============================================================
// Main entry
// ============================================================

function printIntro() {
  console.log(`\n  ${A.bold}${A.purple}YATS Benchmark${A.reset}`);
  console.log(`  ${A.dim}Measure token savings: the same question, answered with vs without YATS.${A.reset}\n`);
  console.log(`  ${A.yellow}💡 Tip:${A.reset} ${A.dim}Pick an ${A.reset}${A.cyan}unknown${A.reset}${A.dim} or your own repo — the model can't answer it from memory, so that's where YATS shows its real value.${A.reset}`);
}

async function runOnce() {
  printIntro();
  selectedModel = null;

  // 1. Agent
  const agent = await selectAgent();
  if (!(await checkAgent(agent))) {
    restoreTerminal();
    process.exit(1);
  }

  // 2. Model
  await selectModel(agent);

  // 3. Workdir
  await selectWorkDir();

  // 4. Repo
  let repo = await selectRepo();
  if (repo === "__custom__") {
    repo = await selectCustomRepo();
  }

  // 3. Clone + index
  const repoPath = await ensureRepo(repo);
  await ensureIndexed(repo, repoPath);
  process.env.YATS_DEFAULT_REPO = repoPath;

  // 4. Question
  const question = await selectQuestion(repo);

  // 5. Runs
  const numRuns = await selectRuns();

  restoreTerminal();

  const resultsDir = path.join(BENCH_DIR, "results");
  fs.mkdirSync(resultsDir, { recursive: true });
  const model = selectedModel ?? agent.defaultModel;
  const date = new Date().toISOString().slice(0, 10);
  const baseName = `${repo.name}__${agent.name}__${model}__${date}`;

  // 6. Baseline
  console.log(`\n  ${A.bold}═══════ BASELINE (${numRuns} run${numRuns > 1 ? "s" : ""}) ═══════${A.reset}`);
  const baselineResults = [];
  for (let i = 1; i <= numRuns; i++) {
    setupAgent(agent, repoPath, false);
    const logFile = path.join(resultsDir, `${baseName}__baseline.jsonl`);
    const t0 = Date.now();
    await runWithSpinner(`Baseline ${i}/${numRuns} — ${agent.name} is reading files to answer`, () =>
      runAgent(agent, question, repoPath, false, logFile));
    const elapsedMs = Date.now() - t0;
    const result = parseResult(logFile, agent.name);
    baselineResults.push({
      run: i, withYats: false,
      tokens: result.tokens ?? 0, cost: result.cost ?? 0,
      outputTokens: result.outputTokens ?? 0,
      cacheRead: result.cacheRead ?? 0, cacheWrite: result.cacheWrite ?? 0,
      toolCalls: result.toolCalls ?? {},
      fileReads: result.fileReads ?? 0, bashCmds: result.bashCmds ?? 0,
      yatsQueries: result.yatsQueries ?? 0, contentChars: result.contentChars ?? 0,
      nanoAiu: result.nanoAiu ?? 0, answer: result.answer ?? "",
      duration: elapsedMs, error: result.error, logFile,
    });
    const r = baselineResults[baselineResults.length - 1];
    if (r.error) console.log(`    ${A.red}✖ ${r.error}${A.reset}`);
    else console.log(`    ${A.green}✓${A.reset} ${r.tokens.toLocaleString()} tokens${r.nanoAiu ? `, ${(r.nanoAiu / 1e9).toFixed(3)} AIU` : ""}, $${r.cost.toFixed(4)}, ${r.fileReads} reads, ${r.bashCmds} bash, ${fmtDuration(elapsedMs)}`);
    printAnswerPreview(r.answer);
  }

  // 6.5 — Ask before continuing to the with-YATS runs
  console.log(`\n  ${A.dim}Baseline finished. Next up: the same question answered ${A.bold}with YATS${A.reset}${A.dim}.${A.reset}`);
  const proceed = await select("Continue with the YATS runs?", [
    { label: "Yes, run with YATS", value: true },
    { label: "No, stop here", value: false },
  ]);
  if (!proceed) {
    console.log(`\n  ${A.yellow}✖ Stopped before the YATS runs${A.reset}\n`);
    return;
  }

  // 7. YATS
  console.log(`\n  ${A.bold}═══════ WITH YATS (${numRuns} run${numRuns > 1 ? "s" : ""}) ═══════${A.reset}`);
  const yatsResults = [];
  for (let i = 1; i <= numRuns; i++) {
    setupAgent(agent, repoPath, true);
    const logFile = path.join(resultsDir, `${baseName}__yats.jsonl`);
    const t0 = Date.now();
    await runWithSpinner(`With YATS ${i}/${numRuns} — ${agent.name} is querying the knowledge graph`, () =>
      runAgent(agent, question, repoPath, true, logFile));
    const elapsedMs = Date.now() - t0;
    const result = parseResult(logFile, agent.name);
    yatsResults.push({
      run: i, withYats: true,
      tokens: result.tokens ?? 0, cost: result.cost ?? 0,
      outputTokens: result.outputTokens ?? 0,
      cacheRead: result.cacheRead ?? 0, cacheWrite: result.cacheWrite ?? 0,
      toolCalls: result.toolCalls ?? {},
      fileReads: result.fileReads ?? 0, bashCmds: result.bashCmds ?? 0,
      yatsQueries: result.yatsQueries ?? 0, contentChars: result.contentChars ?? 0,
      nanoAiu: result.nanoAiu ?? 0, answer: result.answer ?? "",
      duration: elapsedMs, error: result.error, logFile,
    });
    const r = yatsResults[yatsResults.length - 1];
    if (r.error) console.log(`    ${A.red}✖ ${r.error}${A.reset}`);
    else console.log(`    ${A.green}✓${A.reset} ${r.tokens.toLocaleString()} tokens${r.nanoAiu ? `, ${(r.nanoAiu / 1e9).toFixed(3)} AIU` : ""}, $${r.cost.toFixed(4)}, ${r.yatsQueries} yats, ${r.fileReads} reads, ${fmtDuration(elapsedMs)}`);
    printAnswerPreview(r.answer);
  }

  // 8. Results
  const isCopilot = agent.name === "copilot";
  if (isCopilot) {
    console.log(`\n  ${A.yellow}⚠ ${A.bold}Copilot CLI doesn't expose Input Tokens${A.reset}${A.yellow} — comparing ${A.bold}AIU (cost)${A.reset}${A.yellow} & time instead.${A.reset}`);
    printCopilotTable(repo.name, baselineResults, false);
    printCopilotTable(repo.name, yatsResults, true);
    printCopilotComparison(baselineResults, yatsResults);
  } else {
    printTable(repo.name, baselineResults, false);
    printTable(repo.name, yatsResults, true);
    printComparison(baselineResults, yatsResults);
  }

  // Persist a summary entry to results.json
  const avgField = (arr, f) => {
    const good = arr.filter((r) => !r.error);
    return good.length ? good.reduce((s, r) => s + f(r), 0) / good.length : 0;
  };
  const entry = {
    agent: agent.name,
    model: selectedModel ?? agent.defaultModel,
    repo: repo.name,
    date: new Date().toISOString().slice(0, 10),
    question,
    time_ms: {
      without: Math.round(avgField(baselineResults, (r) => r.duration ?? 0)),
      with: Math.round(avgField(yatsResults, (r) => r.duration ?? 0)),
    },
  };
  if (isCopilot) {
    const aB = avgField(baselineResults, (r) => r.nanoAiu ?? 0);
    const aY = avgField(yatsResults, (r) => r.nanoAiu ?? 0);
    entry.aiu = {
      without: Math.round((aB / 1e9) * 1e6) / 1e6,
      with: Math.round((aY / 1e9) * 1e6) / 1e6,
    };
    entry.savings_pct = aB > 0 ? Math.round(((aB - aY) / aB * 100) * 10) / 10 : null;
  } else {
    const tB = avgField(baselineResults, (r) => r.tokens);
    const tY = avgField(yatsResults, (r) => r.tokens);
    entry.tokens = { without: Math.round(tB), with: Math.round(tY) };
    entry.cost = {
      without: Math.round(avgField(baselineResults, (r) => r.cost) * 1000) / 1000,
      with: Math.round(avgField(yatsResults, (r) => r.cost) * 1000) / 1000,
    };
    entry.file_reads = {
      without: Math.round(avgField(baselineResults, (r) => r.fileReads)),
      with: Math.round(avgField(yatsResults, (r) => r.fileReads)),
    };
    entry.bash_cmds = {
      without: Math.round(avgField(baselineResults, (r) => r.bashCmds)),
      with: Math.round(avgField(yatsResults, (r) => r.bashCmds)),
    };
    entry.yats_queries = {
      without: Math.round(avgField(baselineResults, (r) => r.yatsQueries)),
      with: Math.round(avgField(yatsResults, (r) => r.yatsQueries)),
    };
    entry.savings_pct = tB > 0 ? Math.round(((tB - tY) / tB * 100) * 10) / 10 : null;
  }
  entry.answers = {
    without: baselineResults.filter((r) => !r.error).map((r) => r.answer || "").join("\n\n---\n\n"),
    with: yatsResults.filter((r) => !r.error).map((r) => r.answer || "").join("\n\n---\n\n"),
  };
  saveResult(entry);

  console.log(`\n  ${A.dim}Logs saved to: ${resultsDir}${A.reset}\n`);
}

export async function runBenchmark() {
  while (true) {
    await runOnce();
    const again = await select("What's next?", [
      { label: "Run another benchmark", value: true },
      { label: "Exit", value: false },
    ]);
    if (!again) break;
  }
  console.log(`\n  ${A.dim}Bye 👋${A.reset}\n`);
  restoreTerminal();
  if (rl) rl.close();
  process.exit(0);
}
