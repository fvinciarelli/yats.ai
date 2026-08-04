/**
 * yats connect — Set up YATS MCP config for your AI agent.
 *
 * Usage:
 *   yats connect              Pick agent interactively, show config
 *   yats connect <agent>      Show config for specific agent
 *   yats connect --install    Place files in current directory
 *   yats connect --link       Show GitHub links
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createInterface } from "node:readline";
import { homedir } from "node:os";

const B = "\x1b[1m";
const D = "\x1b[2m";
const R = "\x1b[0m";
const G = "\x1b[32m";
const Y = "\x1b[33m";
const C = "\x1b[36m";
const RED = "\x1b[31m";

const YATS_DIR = join(homedir(), ".yats");
const MCP_CONFIG_FILE = join(YATS_DIR, "mcp-config.json");

const AGENTS = {
  claude: {
    name: "Claude Code",
    transport: "stdio bridge",
    files: [
      { src: "connect/claude/yats/SKILL.md", dest: ".claude/skills/yats/SKILL.md", type: "skill" },
      { src: "connect/claude/.mcp.json", dest: ".mcp.json", type: "json" },
    ],
    url: "https://github.com/fvinciarelli/yats.ai/tree/main/connect/claude",
  },
  cursor: {
    name: "Cursor",
    transport: "HTTP",
    files: [
      { src: "connect/cursor/rules.mdc", dest: ".cursor/rules/rules.mdc", type: "text" },
      { src: "connect/cursor/mcp.json", dest: ".cursor/mcp.json", type: "json" },
    ],
    url: "https://github.com/fvinciarelli/yats.ai/tree/main/connect/cursor",
  },
  copilot: {
    name: "GitHub Copilot",
    transport: "stdio bridge",
    files: [
      { src: "connect/copilot/instructions.md", dest: ".github/instructions.md", type: "text" },
      { src: "connect/copilot/mcp.json", dest: ".copilot/mcp.json", type: "json" },
    ],
    url: "https://github.com/fvinciarelli/yats.ai/tree/main/connect/copilot",
  },
  gemini: {
    name: "Gemini CLI",
    transport: "stdio bridge",
    files: [
      { src: "connect/gemini/GEMINI.md", dest: "GEMINI.md", type: "text" },
      { src: "connect/gemini/mcp.json", dest: ".gemini/settings.json", type: "json" },
    ],
    url: "https://github.com/fvinciarelli/yats.ai/tree/main/connect/gemini",
  },
  codex: {
    name: "Codex CLI",
    transport: "stdio bridge",
    files: [
      { src: "connect/codex/AGENTS.md", dest: "AGENTS.md", type: "text" },
      { src: "connect/codex/config.toml", dest: ".codex/config.toml", type: "toml" },
    ],
    url: "https://github.com/fvinciarelli/yats.ai/tree/main/connect/codex",
  },
};

function getYatsMcpConfig() {
  try {
    return JSON.parse(readFileSync(MCP_CONFIG_FILE, "utf-8"));
  } catch {
    return { mcpServers: { yats: { url: "http://localhost:5555/mcp/sse" } } };
  }
}

// ============================================================
// Install helpers
// ============================================================

function safeMergeJson(existingPath, newEntry) {
  let obj = {};
  try {
    obj = JSON.parse(readFileSync(existingPath, "utf-8"));
  } catch { /* file doesn't exist or invalid, start fresh */ }
  if (!obj.mcpServers) obj.mcpServers = {};
  obj.mcpServers = { ...obj.mcpServers, ...newEntry.mcpServers };
  return JSON.stringify(obj, null, 2) + "\n";
}

async function installFiles(agentKey) {
  const agent = AGENTS[agentKey];
  if (!agent) {
    console.error(`Unknown agent: ${agentKey}`);
    process.exit(1);
  }

  console.log("");
  console.log(`  ${Y}${B}⚠️  Before installing, back up your existing config files.${R}`);
  console.log(`  ${D}This will modify or create files in your current directory.${R}`);
  console.log("");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question(`  ${B}Proceed with install for ${agent.name}? [y/N]${R} `, resolve);
  });
  rl.close();

  if (answer.toLowerCase() !== "y") {
    console.log("");
    console.log("  Cancelled.");
    console.log("");
    process.exit(0);
  }

  console.log("");
  let installed = 0;
  let skipped = 0;

  for (const file of agent.files) {
    const destPath = file.dest;
    const mcpConfig = getYatsMcpConfig();

    if (file.type === "json") {
      const merged = safeMergeJson(destPath, mcpConfig);
      const exists = existsSync(destPath);
      mkdirSync(dirname(destPath), { recursive: true });
      writeFileSync(destPath, merged);
      if (exists) {
        console.log(`  ${Y}↻${R} Merged YATS into existing ${destPath}`);
      } else {
        console.log(`  ${G}✓${R} Created ${destPath}`);
      }
      installed++;
    } else if (file.type === "text" || file.type === "skill") {
      if (existsSync(destPath)) {
        console.log(`  ${Y}⚠${R}  ${destPath} already exists — skipped (backup and remove to replace)`);
        skipped++;
      } else {
        const content = getFileContent(file.src);
        if (content) {
          mkdirSync(dirname(destPath), { recursive: true });
          writeFileSync(destPath, content);
          console.log(`  ${G}✓${R} Created ${destPath}`);
          installed++;
        } else {
          console.log(`  ${RED}✗${R} Could not read ${file.src} — download from GitHub`);
          skipped++;
        }
      }
    } else if (file.type === "toml") {
      if (existsSync(destPath)) {
        console.log(`  ${Y}⚠${R}  ${destPath} already exists — skipped (backup and remove to replace)`);
        skipped++;
      } else {
        const content = getFileContent(file.src);
        if (content) {
          mkdirSync(dirname(destPath), { recursive: true });
          writeFileSync(destPath, content);
          console.log(`  ${G}✓${R} Created ${destPath}`);
          installed++;
        } else {
          console.log(`  ${RED}✗${R} Could not read ${file.src} — download from GitHub`);
          skipped++;
        }
      }
    }
  }

  console.log("");
  console.log(`  Done: ${installed} installed, ${skipped} skipped.`);
  console.log(`  Full instructions: ${C}${agent.url}${R}`);
  console.log("");
}

function getFileContent(srcPath) {
  // Try from node_modules first (when installed via npm)
  try {
    const pkgDir = dirname(new URL(import.meta.url).pathname);
    const installedPath = join(pkgDir, "..", srcPath);
    if (existsSync(installedPath)) {
      return readFileSync(installedPath, "utf-8");
    }
  } catch { /* not installed as npm package */ }
  return null;
}

// ============================================================
// Display helpers
// ============================================================

function showConfig(agentKey) {
  const agent = AGENTS[agentKey];
  if (!agent) {
    console.error(`Unknown agent: ${agentKey}`);
    console.log("");
    console.log(`Available: ${Object.keys(AGENTS).join(", ")}`);
    process.exit(1);
  }

  const mcpConfig = getYatsMcpConfig();

  console.log("");
  console.log(`  ${B}${agent.name}${R} — via ${agent.transport}`);
  console.log("");

  for (const file of agent.files) {
    console.log(`  ${B}${file.dest}${R}`);
    if (file.type === "json") {
      console.log(`  ${D}${safeMergeJson("", mcpConfig).replace(/\n/g, "\n  ")}${R}`);
    } else {
      const content = getFileContent(file.src);
      if (content) {
        const preview = content.split("\n").slice(0, 8).join("\n");
        console.log(`  ${D}${preview}${D}...${R}`);
      } else {
        console.log(`  ${D}(download from GitHub)${R}`);
      }
    }
    console.log("");
  }

  console.log(`  ${B}GitHub:${R} ${C}${agent.url}${R}`);
  console.log("");
  console.log(`  Run ${B}yats connect --install${R} to auto-place these files.`);
  console.log("");
}

function showLink(agentKey) {
  if (agentKey && AGENTS[agentKey]) {
    console.log(AGENTS[agentKey].url);
  } else if (agentKey) {
    console.error(`Unknown agent: ${agentKey}`);
    process.exit(1);
  } else {
    console.log("https://github.com/fvinciarelli/yats.ai/tree/main/connect");
  }
}

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return answer;
}

async function choose(prompt, options) {
  console.log(`  ${prompt}`);
  for (let i = 0; i < options.length; i++) {
    console.log(`    ${B}${i + 1}${R}. ${options[i].label}`);
  }
  console.log("");
  const answer = await ask(`  ${B}Pick [1-${options.length}]:${R} `);
  const num = parseInt(answer.trim(), 10);
  if (num >= 1 && num <= options.length) {
    return options[num - 1].value;
  }
  console.log(`  ${RED}Invalid.${R}`);
  process.exit(1);
}

// ============================================================
// Main
// ============================================================

export default async function connect(args) {
  const agentKey = args.find(a => !a.startsWith("--"));
  const isInstall = args.includes("--install");
  const isLink = args.includes("--link");

  if (isLink) {
    showLink(agentKey);
    return;
  }

  if (isInstall) {
    if (!agentKey) {
      console.error("Usage: yats connect --install <agent>");
      console.error(`  Agents: ${Object.keys(AGENTS).join(", ")}`);
      process.exit(1);
    }
    await installFiles(agentKey);
    return;
  }

  if (agentKey) {
    showConfig(agentKey);
    return;
  }

  // Interactive picker
  const picked = await choose("Which AI agent are you using?", [
    { label: "Claude Code", value: "claude" },
    { label: "Cursor", value: "cursor" },
    { label: "GitHub Copilot", value: "copilot" },
    { label: "Gemini CLI", value: "gemini" },
    { label: "Codex CLI", value: "codex" },
  ]);

  showConfig(picked);
}
