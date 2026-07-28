import { createLogger } from "@yats/shared";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { execSync } from "node:child_process";
import * as readline from "node:readline";

const logger = createLogger("benchmark");

// ============================================================
// Types
// ============================================================

interface AgentConfig {
  name: string;
  cli: string;
  checkCmd: string;
  installHint: string;
  needsApiKey: string;
  needsSkill: boolean;
  needsMcpConfig: boolean;
  runCmd: (prompt: string, repoDir: string, hasMcp: boolean) => string[];
}

interface RepoConfig {
  name: string;
  url: string;
  defaultPath: string;
  language: string;
  questions: string[];
}

interface RunResult {
  run: number;
  withYats: boolean;
  tokens: number;
  cost: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  toolCalls: Record<string, number>;
  agentSpawns: number;
  fileReads: number;
  bashCmds: number;
  yatsQueries: number;
  contentChars: number;
  duration: number;
  error?: string;
  logFile: string;
}

// ============================================================
// Configuration
// ============================================================

const KNOWN_REPOS: RepoConfig[] = [
  {
    name: "fastapi",
    url: "https://github.com/tiangolo/fastapi.git",
    defaultPath: path.join(process.env.HOME ?? "/tmp", "repos", "fastapi"),
    language: "python",
    questions: [
      "How does middleware work in FastAPI? Trace registration, ordering, and execution of the middleware stack.",
      "How are HTTP routes registered and dispatched in FastAPI? Find the key classes responsible for routing.",
    ],
  },
  {
    name: "lab_hub",
    url: "https://github.com/fvinciarelli/lab_hub.git",
    defaultPath: path.join(process.env.HOME ?? "/tmp", "repos", "lab_hub"),
    language: "go",
    questions: [
      "How does Hub Lab translate analyzer protocols? What are the key Go packages and functions?",
      "How does the bidirectional flow work in Hub Lab? Trace orders and results paths.",
    ],
  },
];

const KNOWN_AGENTS: AgentConfig[] = [
  {
    name: "claude",
    cli: "claude",
    checkCmd: "which claude",
    installHint: "npm install -g @anthropic-ai/claude-code",
    needsApiKey: "ANTHROPIC_API_KEY",
    needsSkill: true,
    needsMcpConfig: true,
    runCmd: (prompt: string, repoDir: string, hasMcp: boolean) => {
      const args = [
        "-p", prompt,
        "--model", process.env.YATS_BENCH_MODEL ?? "haiku",
        "--output-format", "stream-json",
        "--verbose",
        "--dangerously-skip-permissions",
        ...(hasMcp ? ["--mcp-config", "/tmp/yats-bench-mcp.json"] : []),
      ];
      return args;
    },
  },
  {
    name: "codex",
    cli: "codex",
    checkCmd: "which codex",
    installHint: "Install VS Code ChatGPT extension",
    needsApiKey: "OPENAI_API_KEY",
    needsSkill: false,
    needsMcpConfig: false,
    runCmd: (prompt: string, repoDir: string, hasMcp: boolean) => {
      const args = [
        "exec", "--json",
        ...(hasMcp ? [] : ["-c", "mcp_servers.yats.enabled=false"]),
        prompt,
      ];
      return args;
    },
  },
];

// ============================================================
// Interactive wizard
// ============================================================

const ask = (rl: readline.Interface, question: string): Promise<string> =>
  new Promise((resolve) => rl.question(question, resolve));

async function selectAgent(rl: readline.Interface): Promise<AgentConfig> {
  console.log("\n  Available agents:");
  KNOWN_AGENTS.forEach((a, i) => console.log(`    ${i + 1}. ${a.name}`));
  const choice = await ask(rl, "\n  Pick agent [1-2]: ");
  const idx = parseInt(choice) - 1;
  if (isNaN(idx) || idx < 0 || idx >= KNOWN_AGENTS.length) {
    console.log("  Invalid. Defaulting to claude.");
    return KNOWN_AGENTS[0]!;
  }
  return KNOWN_AGENTS[idx]!;
}

async function selectRepo(rl: readline.Interface): Promise<RepoConfig> {
  console.log("\n  Available repos:");
  KNOWN_REPOS.forEach((r, i) => {
    const exists = fs.existsSync(r.defaultPath);
    console.log(`    ${i + 1}. ${r.name} (${r.language}) ${exists ? "[cloned]" : "[will clone]"}`);
  });
  const choice = await ask(rl, "\n  Pick repo [1-2]: ");
  const idx = parseInt(choice) - 1;
  if (isNaN(idx) || idx < 0 || idx >= KNOWN_REPOS.length) {
    console.log("  Invalid. Defaulting to lab_hub.");
    return KNOWN_REPOS[1]!;
  }
  return KNOWN_REPOS[idx]!;
}

async function selectQuestion(rl: readline.Interface, repo: RepoConfig): Promise<string> {
  console.log("\n  Questions:");
  repo.questions.forEach((q, i) => {
    console.log(`    ${i + 1}. ${q.slice(0, 80)}...`);
  });
  const choice = await ask(rl, "\n  Pick question [1]: ");
  const idx = parseInt(choice || "1") - 1;
  if (isNaN(idx) || idx < 0 || idx >= repo.questions.length) {
    return repo.questions[0]!;
  }
  return repo.questions[idx]!;
}

async function selectRuns(rl: readline.Interface): Promise<number> {
  const choice = await ask(rl, "\n  Number of runs per condition [1]: ");
  const n = parseInt(choice || "1");
  return isNaN(n) || n < 1 ? 1 : Math.min(n, 5);
}

// ============================================================
// Setup
// ============================================================

function ensureRepo(repo: RepoConfig): string {
  const repoPath = repo.defaultPath;
  if (!fs.existsSync(repoPath)) {
    console.log(`\n  Cloning ${repo.name} from ${repo.url}...`);
    const parent = path.dirname(repoPath);
    fs.mkdirSync(parent, { recursive: true });
    execSync(`git clone --depth 1 ${repo.url} ${repoPath}`, {
      stdio: "inherit",
      timeout: 120_000,
    });
    console.log(`  ✓ Cloned to ${repoPath}`);
  } else {
    console.log(`  ✓ Repo already at ${repoPath}`);
  }
  return repoPath;
}

function setupAgent(agent: AgentConfig, repoPath: string, withYats: boolean): void {
  // Skill for Claude
  if (agent.needsSkill && withYats) {
    const skillDir = path.join(repoPath, ".claude", "skills", "yats");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), `---
name: yats
description: YATS has this codebase indexed. Use when asked about the code — how something works, architecture, call chains, where something is defined.
when_to_use: "How does X work?, Where is X defined?, What calls X?, architecture, trace, find routes, find config"
---

# YATS Code Intelligence
This repo is indexed by YATS (mcp__yats__* tools). Every symbol, call, and relationship is in a knowledge graph.

## Golden rule
**YATS first, Read second.** MCP tools return in ms for ~100 tokens. Reading files costs thousands.

## Workflow
1. search_code — natural language query
2. find_symbol on hits
3. find_callers / find_callees to trace
4. Only then Read files at the line YATS gave you
`);
  } else if (!withYats) {
    // Remove skill for baseline
    const skillDir = path.join(repoPath, ".claude", "skills", "yats");
    if (fs.existsSync(skillDir)) {
      fs.rmSync(skillDir, { recursive: true });
    }
  }

  // MCP config for Claude
  if (agent.needsMcpConfig && withYats) {
    const mcpConfig = {
      mcpServers: {
        yats: { url: "http://localhost:5555/mcp" },
      },
    };
    fs.writeFileSync("/tmp/yats-bench-mcp.json", JSON.stringify(mcpConfig));

    // Claude project config
    const claudeJson = {
      env: { API_TIMEOUT_MS: "3000000" },
      permissions: { defaultMode: "default" },
      projects: {
        [repoPath]: {
          mcpServers: {
            yats: { type: "sse", url: "http://localhost:5555/mcp/sse" },
          },
        },
      },
    };
    const claudeJsonPath = path.join(process.env.HOME ?? "/tmp", ".claude.json");
    fs.writeFileSync(claudeJsonPath, JSON.stringify(claudeJson));
  } else if (agent.name === "claude") {
    // Clean config for baseline
    const claudeJsonPath = path.join(process.env.HOME ?? "/tmp", ".claude.json");
    fs.writeFileSync(claudeJsonPath, JSON.stringify({
      env: { API_TIMEOUT_MS: "3000000" },
      permissions: { defaultMode: "default" },
      projects: {},
    }));
  }
}

function checkAgent(agent: AgentConfig): void {
  try {
    execSync(agent.checkCmd, { stdio: "pipe" });
    console.log(`  ✓ ${agent.name} CLI found`);
  } catch {
    console.log(`  ⚠ ${agent.name} CLI not found. Install: ${agent.installHint}`);
  }

  if (!process.env[agent.needsApiKey]) {
    console.log(`  ⚠ ${agent.needsApiKey} not set. Set it in .env or export it.`);
    console.log(`     Required for ${agent.name}. See benchmark/.env.example`);
  } else {
    console.log(`  ✓ ${agent.needsApiKey} is set`);
  }
}

// ============================================================
// Run
// ============================================================

function runAgent(
  agent: AgentConfig,
  prompt: string,
  repoPath: string,
  withYats: boolean,
  logFile: string,
  timeoutSec: number = 180,
): Promise<{ exitCode: number; signal: string | null }> {
  const args = agent.runCmd(prompt, repoPath, withYats);

  return new Promise((resolve) => {
    const proc = spawn(agent.cli, args, {
      cwd: repoPath,
      stdio: ["pipe", fs.openSync(logFile, "w"), "pipe"],
      timeout: timeoutSec * 1000,
    });

    proc.on("close", (code, signal) => {
      resolve({ exitCode: code ?? -1, signal });
    });

    proc.on("error", (err) => {
      fs.appendFileSync(logFile, `\nSPAWN_ERROR: ${err.message}\n`);
      resolve({ exitCode: -1, signal: null });
    });
  });
}

// ============================================================
// Parse results
// ============================================================

function parseResult(logFile: string): Partial<RunResult> {
  try {
    const content = fs.readFileSync(logFile, "utf-8");
    const lines = content.trim().split("\n");
    const events = lines
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean);

    const results = events.filter((e: any) => e.type === "result");
    if (!results.length) return { error: "No result events found", logFile };

    const last = results[results.length - 1] as any;
    const modelUsage = last.modelUsage ?? {};

    let tokens = 0;
    let outputTokens = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    for (const mu of Object.values(modelUsage) as any[]) {
      tokens += (mu.inputTokens ?? 0) + (mu.outputTokens ?? 0) +
                (mu.cacheReadInputTokens ?? 0) + (mu.cacheCreationInputTokens ?? 0);
      outputTokens += mu.outputTokens ?? 0;
      cacheRead += mu.cacheReadInputTokens ?? 0;
      cacheWrite += mu.cacheCreationInputTokens ?? 0;
    }

    // Tool calls
    const toolCalls: Record<string, number> = {};
    for (const e of events) {
      if ((e as any).type === "assistant") {
        for (const c of (e as any).message?.content ?? []) {
          if (c.type === "tool_use") {
            toolCalls[c.name] = (toolCalls[c.name] ?? 0) + 1;
          }
        }
      }
    }

    const yatsQueries = Object.entries(toolCalls)
      .filter(([k]) => k.includes("yats") || k.includes("mcp__"))
      .reduce((sum, [, v]) => sum + v, 0);
    const fileReads = toolCalls["Read"] ?? 0;
    const bashCmds = toolCalls["Bash"] ?? 0;
    const agentSpawns = (toolCalls["Agent"] ?? 0) + (toolCalls["Task"] ?? 0);

    // Content chars
    let contentChars = 0;
    for (const e of events) {
      if ((e as any).type === "user") {
        for (const c of (e as any).message?.content ?? []) {
          if (c.type === "tool_result") {
            let t = c.content ?? "";
            if (Array.isArray(t)) t = t.map((x: any) => x.text ?? "").join("");
            contentChars += String(t).length;
          }
        }
      }
    }

    return {
      tokens,
      cost: last.total_cost_usd ?? 0,
      outputTokens,
      cacheRead,
      cacheWrite,
      toolCalls,
      agentSpawns,
      fileReads,
      bashCmds,
      yatsQueries,
      contentChars,
      duration: last.duration_ms ?? 0,
      logFile,
    };
  } catch (err: any) {
    return { error: err.message, logFile };
  }
}

// ============================================================
// Output
// ============================================================

function printTable(
  title: string,
  runs: RunResult[],
  withYats: boolean,
): void {
  const label = withYats ? "With YATS" : "Baseline";
  console.log(`\n  ${title} — ${label}`);
  console.log("  ┌──────┬──────────┬────────┬───────┬──────┬──────┬──────┬──────────┐");
  console.log("  │ Run  │  Tokens  │  Cost  │ Output│ Reads│ Bash │ YATS │  Result  │");
  console.log("  ├──────┼──────────┼────────┼───────┼──────┼──────┼──────┼──────────┤");
  for (const r of runs) {
    const status = r.error ? "ERROR" : "OK";
    console.log(
      `  │  ${String(r.run).padEnd(4)} │ ${String(r.tokens).padStart(8)} │ $${r.cost.toFixed(3).padStart(4)} │ ${String(r.outputTokens).padStart(5)} │ ${String(r.fileReads).padStart(4)} │ ${String(r.bashCmds).padStart(4)} │ ${String(r.yatsQueries).padStart(4)} │ ${status.padEnd(8)} │`,
    );
  }
  // Average
  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const good = runs.filter((r) => !r.error);
  if (good.length) {
    console.log("  ├──────┼──────────┼────────┼───────┼──────┼──────┼──────┼──────────┤");
    console.log(
      `  │ AVG  │ ${String(Math.round(avg(good.map((r) => r.tokens)))).padStart(8)} │ $${avg(good.map((r) => r.cost)).toFixed(3).padStart(4)} │ ${String(Math.round(avg(good.map((r) => r.outputTokens)))).padStart(5)} │ ${String(Math.round(avg(good.map((r) => r.fileReads)))).padStart(4)} │ ${String(Math.round(avg(good.map((r) => r.bashCmds)))).padStart(4)} │ ${String(Math.round(avg(good.map((r) => r.yatsQueries)))).padStart(4)} │          │`,
    );
  }
  console.log("  └──────┴──────────┴────────┴───────┴──────┴──────┴──────┴──────────┘");
}

function printComparison(baseline: RunResult[], yats: RunResult[]): void {
  const goodB = baseline.filter((r) => !r.error);
  const goodY = yats.filter((r) => !r.error);
  if (!goodB.length || !goodY.length) return;

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const tB = avg(goodB.map((r) => r.tokens));
  const tY = avg(goodY.map((r) => r.tokens));
  const cB = avg(goodB.map((r) => r.cost));
  const cY = avg(goodY.map((r) => r.cost));
  const rB = avg(goodB.map((r) => r.fileReads));
  const rY = avg(goodY.map((r) => r.fileReads));
  const bB = avg(goodB.map((r) => r.bashCmds));
  const bY = avg(goodY.map((r) => r.bashCmds));

  const tokenSave = ((tB - tY) / tB * 100);
  const costSave = ((cB - cY) / cB * 100);
  const readSave = rB ? ((rB - rY) / rB * 100) : 0;
  const bashSave = bB ? ((bB - bY) / bB * 100) : 0;

  console.log("\n  ╔══════════════════════════════════════════════════╗");
  console.log("  ║" + "              SAVINGS (YATS vs Baseline)".padEnd(49) + "║");
  console.log("  ╠══════════════════════════════════════════════════╣");
  console.log(`  ║  Tokens:      ${String(Math.round(tB)).padStart(8)} → ${String(Math.round(tY)).padStart(8)}   ${tokenSave > 0 ? "↓" : "↑"} ${Math.abs(tokenSave).toFixed(1).padStart(5)}%`.padEnd(49) + "║");
  console.log(`  ║  Cost:       $${cB.toFixed(3)} → $${cY.toFixed(3)}   ${costSave > 0 ? "↓" : "↑"} ${Math.abs(costSave).toFixed(1).padStart(5)}%`.padEnd(49) + "║");
  console.log(`  ║  File reads:  ${String(Math.round(rB)).padStart(5)} → ${String(Math.round(rY)).padStart(5)}   ${readSave > 0 ? "↓" : "↑"} ${Math.abs(readSave).toFixed(1).padStart(5)}%`.padEnd(49) + "║");
  console.log(`  ║  Bash cmds:   ${String(Math.round(bB)).padStart(5)} → ${String(Math.round(bY)).padStart(5)}   ${bashSave > 0 ? "↓" : "↑"} ${Math.abs(bashSave).toFixed(1).padStart(5)}%`.padEnd(49) + "║");
  console.log("  ╚══════════════════════════════════════════════════╝");
}

// ============================================================
// Main entry
// ============================================================

export async function runBenchmark(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log("\n  ╔══════════════════════════════════════════════════╗");
  console.log("  ║" + "                YATS BENCHMARK".padEnd(49) + "║");
  console.log("  ╚══════════════════════════════════════════════════╝");

  // 1. Select agent
  const agent = await selectAgent(rl);
  checkAgent(agent);

  // 2. Select repo
  const repo = await selectRepo(rl);

  // 3. Ensure repo cloned
  const repoPath = ensureRepo(repo);

  // 4. Select question
  const question = await selectQuestion(rl, repo);

  // 5. Number of runs
  const numRuns = await selectRuns(rl);

  rl.close();

  // 6. Ensure repo is indexed
  console.log(`\n  Checking if ${repo.name} is indexed...`);
  // TODO: check via MCP call

  // Prep results dir
  // Results: saved to ./benchmark/results in user's working directory
  const resultsDir = path.join(process.cwd(), "benchmark", "results");
  fs.mkdirSync(resultsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  // 7. Run baseline
  console.log(`\n  ═══════ BASELINE (${numRuns} runs) ═══════`);
  const baselineResults: RunResult[] = [];
  for (let i = 1; i <= numRuns; i++) {
    console.log(`\n  ▶ Run ${i}/${numRuns} — BASELINE...`);
    setupAgent(agent, repoPath, false);
    const logFile = path.join(resultsDir, `${repo.name}_baseline_${timestamp}_run${i}.jsonl`);
    await runAgent(agent, question, repoPath, false, logFile);
    const result = parseResult(logFile);
    baselineResults.push({
      run: i,
      withYats: false,
      tokens: result.tokens ?? 0,
      cost: result.cost ?? 0,
      outputTokens: result.outputTokens ?? 0,
      cacheRead: result.cacheRead ?? 0,
      cacheWrite: result.cacheWrite ?? 0,
      toolCalls: result.toolCalls ?? {},
      agentSpawns: result.agentSpawns ?? 0,
      fileReads: result.fileReads ?? 0,
      bashCmds: result.bashCmds ?? 0,
      yatsQueries: result.yatsQueries ?? 0,
      contentChars: result.contentChars ?? 0,
      duration: result.duration ?? 0,
      error: result.error,
      logFile,
    });
    const r = baselineResults[baselineResults.length - 1]!;
    if (r.error) {
      console.log(`    ❌ Error: ${r.error}`);
    } else {
      console.log(`    ✓ ${r.tokens.toLocaleString()} tokens, $${r.cost.toFixed(4)}, ${r.fileReads} reads, ${r.bashCmds} bash`);
    }
  }

  // 8. Run YATS
  console.log(`\n  ═══════ WITH YATS (${numRuns} runs) ═══════`);
  const yatsResults: RunResult[] = [];
  for (let i = 1; i <= numRuns; i++) {
    console.log(`\n  ▶ Run ${i}/${numRuns} — YATS...`);
    setupAgent(agent, repoPath, true);
    const logFile = path.join(resultsDir, `${repo.name}_yats_${timestamp}_run${i}.jsonl`);
    await runAgent(agent, question, repoPath, true, logFile);
    const result = parseResult(logFile);
    yatsResults.push({
      run: i,
      withYats: true,
      tokens: result.tokens ?? 0,
      cost: result.cost ?? 0,
      outputTokens: result.outputTokens ?? 0,
      cacheRead: result.cacheRead ?? 0,
      cacheWrite: result.cacheWrite ?? 0,
      toolCalls: result.toolCalls ?? {},
      agentSpawns: result.agentSpawns ?? 0,
      fileReads: result.fileReads ?? 0,
      bashCmds: result.bashCmds ?? 0,
      yatsQueries: result.yatsQueries ?? 0,
      contentChars: result.contentChars ?? 0,
      duration: result.duration ?? 0,
      error: result.error,
      logFile,
    });
    const r = yatsResults[yatsResults.length - 1]!;
    if (r.error) {
      console.log(`    ❌ Error: ${r.error}`);
    } else {
      console.log(`    ✓ ${r.tokens.toLocaleString()} tokens, $${r.cost.toFixed(4)}, ${r.yatsQueries} yats, ${r.fileReads} reads`);
    }
  }

  // 9. Show results
  printTable(repo.name, baselineResults, false);
  printTable(repo.name, yatsResults, true);
  printComparison(baselineResults, yatsResults);

  console.log(`\n  Logs saved to: ${resultsDir}\n`);
}
