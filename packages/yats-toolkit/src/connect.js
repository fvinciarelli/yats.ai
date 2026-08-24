/**
 * yats connect — Set up YATS MCP config for your AI agent.
 *
 * Usage:
 *   yats connect              Pick agent interactively, show config
 *   yats connect <agent>      Show config for specific agent
 *   yats connect --install    Place files in current directory
 *   yats connect --link       Show GitHub links
 *
 * Install behavior (never breaks the user's files):
 *   - File does not exist  → create it
 *   - JSON files           → merge `mcpServers` (existing entries preserved)
 *   - TOML/Codex config    → append only the `[mcp_servers.yats]` section
 *   - Text/Skill files     → warn, show what will be added, ask, then append
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
      { src: "connect/claude/SKILL.md", dest: ".claude/skills/yats/SKILL.md", type: "skill" },
      { src: "connect/claude/mcp.json", dest: ".mcp.json", type: "json" },
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
      { src: "connect/copilot/instructions.md", dest: ".github/copilot-instructions.md", type: "text" },
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

function getFileContent(srcPath) {
  // Templates ship inside the package (connect/ dir) — resolves from src/ → ../connect/
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
// Render / template helpers
// ============================================================

function renderContent(srcPath) {
  const content = getFileContent(srcPath);
  if (content === null) {
    console.log(`  ${RED}✗${R} Missing template ${srcPath} — reinstall yats-toolkit`);
    return null;
  }
  // YATS identifies repos by their full rootPath — instruct the full path,
  // not the basename, so the server matches by path and never by name.
  return content.replaceAll("__REPO_PATH__", process.cwd());
}

// Split YAML frontmatter from the body (only meaningful at the top of a file)
function splitFrontmatter(content) {
  if (content.startsWith("---")) {
    const end = content.indexOf("\n---", 3);
    if (end !== -1) {
      return {
        frontmatter: content.slice(0, end + 4),
        body: content.slice(end + 5),
      };
    }
  }
  return { frontmatter: "", body: content };
}

function appendMarker(agentKey) {
  return `\n---\n\n<!-- Added by \`yats connect ${agentKey}\` — YATS code intelligence. Remove this block if you don't need it. -->\n\n`;
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

// Single shared readline so piped stdin keeps working across multiple prompts
// Prompt helper that works both interactively (TTY) and with piped stdin
// (e.g. `printf 'y\n' | yats connect --install codex`). readline.question()
// hangs on a finished pipe stream, so piped input is collected upfront.
// Always call close() when done — an open readline keeps the process alive.
function makePrompter() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  if (process.stdin.isTTY) {
    return {
      ask: (question) => new Promise((resolve) => rl.question(question, resolve)),
      close: () => rl.close(),
    };
  }
  const all = (async () => {
    const lines = [];
    for await (const line of rl) lines.push(line);
    return lines;
  })();
  let idx = 0;
  return {
    ask: async (question) => {
      process.stdout.write(question);
      const lines = await all;
      return idx < lines.length ? lines[idx++] : "";
    },
    close: () => rl.close(),
  };
}

function previewBlock(label, content) {
  console.log(`  ${D}${label}:${R}`);
  for (const line of content.trimEnd().split("\n")) {
    console.log(`  ${D}  │ ${line}${R}`);
  }
  console.log("");
}

function tomlHasMcpYats(content) {
  return /\[mcp_servers\.yats\]/.test(content);
}

// Append the [mcp_servers.yats] section (+ multi_agent=false if [features] exists without it)
function tomlAppendYats(content) {
  let out = content.trimEnd();
  if (!/^\[features\]/m.test(out)) {
    out += `\n\n[features]\nmulti_agent = false  # REQUIRED: force direct MCP tool usage\n`;
  } else if (!/^multi_agent\s*=/m.test(out)) {
    out = out.replace(/^\[features\]/m, "[features]\nmulti_agent = false  # REQUIRED: force direct MCP tool usage");
  }
  out += `\n\n# Added by \`yats connect codex\` — YATS MCP stdio bridge\n[mcp_servers.yats]\ncommand = "yats"\nargs = ["bridge"]\n`;
  return out;
}

async function installFiles(agentKey) {
  const agent = AGENTS[agentKey];
  if (!agent) {
    console.error(`Unknown agent: ${agentKey}`);
    process.exit(1);
  }

  console.log("");
  console.log(`  ${Y}${B}⚠️  This will add YATS config files to your current directory.${R}`);
  console.log(`  ${D}Existing files are never overwritten — YATS content is merged or appended.${R}`);
  console.log("");

  const prompter = makePrompter();
  const proceed = (await prompter.ask(`  ${B}Proceed with install for ${agent.name}? [y/N]${R} `)).toLowerCase() === "y";
  if (!proceed) {
    prompter.close();
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
      const exists = existsSync(destPath);
      const merged = safeMergeJson(destPath, mcpConfig);
      mkdirSync(dirname(destPath), { recursive: true });
      writeFileSync(destPath, merged);
      if (exists) {
        console.log(`  ${Y}↻${R} Merged YATS into existing ${destPath}`);
        const entry = mcpConfig.mcpServers.yats;
        console.log(`  ${D}  Added: mcpServers.yats → ${JSON.stringify(entry)}${R}`);
        console.log(`  ${D}  Your existing entries are preserved.${R}`);
      } else {
        console.log(`  ${G}✓${R} Created ${destPath}`);
      }
      installed++;
    } else if (file.type === "toml") {
      const exists = existsSync(destPath);
      mkdirSync(dirname(destPath), { recursive: true });
      if (!exists) {
        const content = renderContent(file.src);
        if (content === null) { skipped++; continue; }
        writeFileSync(destPath, content);
        console.log(`  ${G}✓${R} Created ${destPath}`);
        installed++;
      } else {
        const existing = readFileSync(destPath, "utf-8");
        if (tomlHasMcpYats(existing)) {
          console.log(`  ${Y}✓${R} ${destPath} already has [mcp_servers.yats] — nothing to add.`);
          skipped++;
        } else {
          console.log(`  ${Y}⚠${R} ${destPath} exists without YATS config.`);
          const addition = tomlAppendYats(existing);
          previewBlock("Will append", addition.replace(existing, "").trimStart());
          if ((await prompter.ask(`  ${B}Append YATS section to ${destPath}? [y/N]${R} `)).toLowerCase() === "y") {
            writeFileSync(destPath, addition);
            console.log(`  ${G}✓${R} Appended YATS section to ${destPath}`);
            installed++;
          } else {
            console.log(`  ${Y}—${R} Skipped ${destPath}`);
            skipped++;
          }
        }
      }
    } else { // text / skill
      const destExists = existsSync(destPath);
      mkdirSync(dirname(destPath), { recursive: true });
      if (!destExists) {
        const content = renderContent(file.src);
        if (content === null) { skipped++; continue; }
        writeFileSync(destPath, content);
        console.log(`  ${G}✓${R} Created ${destPath}`);
        installed++;
      } else {
        console.log(`  ${Y}⚠${R} ${destPath} already exists — your content is preserved.`);
        const content = renderContent(file.src);
        if (content === null) { skipped++; continue; }
        // Skills have YAML frontmatter that only makes sense at the top → append the body only
        const block = file.type === "skill" ? splitFrontmatter(content).body : content;
        previewBlock("Will append", appendMarker(agentKey) + "\n" + block.trimStart());
        if ((await prompter.ask(`  ${B}Append YATS block to ${destPath}? [y/N]${R} `)).toLowerCase() === "y") {
          writeFileSync(destPath, readFileSync(destPath, "utf-8").trimEnd() + "\n" + appendMarker(agentKey) + block.trimStart() + "\n");
          console.log(`  ${G}✓${R} Appended YATS block to ${destPath}`);
          installed++;
        } else {
          console.log(`  ${Y}—${R} Skipped ${destPath}`);
          skipped++;
        }
      }
    }
  }

  console.log("");
  console.log(`  Done: ${installed} installed, ${skipped} skipped.`);
  console.log(`  Full instructions: ${C}${agent.url}${R}`);
  console.log("");
  prompter.close();
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
      const content = renderContent(file.src);
      if (content) {
        const preview = content.split("\n").slice(0, 8).join("\n");
        console.log(`  ${D}${preview}${D}...${R}`);
      } else {
        console.log(`  ${RED}(missing template)${R}`);
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
  const prompter = makePrompter();
  const answer = await prompter.ask(question);
  prompter.close();
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
