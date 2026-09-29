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
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

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
      // VS Code Chat / Copilot Agent Host reads the portable .mcp.json at the
      // repo root (mcpServers format), not .copilot/mcp.json (CLI-only format).
      { src: "connect/copilot/mcp.json", dest: ".mcp.json", type: "json" },
    ],
    url: "https://github.com/fvinciarelli/yats.ai/tree/main/connect/copilot",
  },
  vscode: {
    name: "VS Code (native MCP)",
    transport: "stdio bridge",
    files: [
      // Native VS Code workspace MCP config (servers format).
      { src: "connect/vscode/mcp.json", dest: ".vscode/mcp.json", type: "json" },
    ],
    url: "https://github.com/fvinciarelli/yats.ai/tree/main/connect/vscode",
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
  let cfg = { mcpServers: { yats: { url: "http://localhost:5555/mcp" } } };
  try {
    cfg = JSON.parse(readFileSync(MCP_CONFIG_FILE, "utf-8"));
  } catch { /* no config yet — use the default above */ }
  // Normalize legacy /mcp/sse URLs to the Streamable HTTP endpoint.
  const url = cfg?.mcpServers?.yats?.url;
  if (typeof url === "string" && url.endsWith("/mcp/sse")) {
    cfg.mcpServers.yats.url = url.slice(0, -4);
  }
  return cfg;
}

function getFileContent(srcPath) {
  // Templates ship inside the package (connect/ dir) — resolves from src/ → ../connect/.
  // fileURLToPath handles percent-encoded paths (spaces, unicode) and Windows drives.
  try {
    const pkgDir = dirname(fileURLToPath(import.meta.url));
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

export function renderContent(srcPath) {
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

/** Read an existing JSON config as an object, or null if missing/invalid. */
function readJsonObject(path) {
  try {
    const obj = JSON.parse(readFileSync(path, "utf-8"));
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
}

/**
 * Merge an agent template into an existing JSON config. Templates carry one
 * of two shapes — `mcpServers` (Claude/Copilot/Gemini/Cursor) or `servers`
 * (VS Code native) — both objects keyed by server name. Existing entries are
 * preserved; only the YATS entry is added or updated.
 */
export function mergeServerConfig(existing, template) {
  const out = {};
  for (const key of Object.keys(existing)) out[key] = existing[key];
  for (const key of Object.keys(template)) {
    const tpl = template[key];
    if (tpl && typeof tpl === "object" && !Array.isArray(tpl)) {
      const base =
        out[key] && typeof out[key] === "object" && !Array.isArray(out[key])
          ? out[key]
          : {};
      out[key] = { ...base, ...tpl };
    } else {
      out[key] = tpl;
    }
  }
  return out;
}

/**
 * Install one agent's JSON config file from its template.
 * The template is the source of truth (correct format + transport per
 * agent: stdio bridge for copilot/claude/gemini/vscode, HTTP for cursor) —
 * never the global ~/.yats/mcp-config.json, which is HTTP-only and generic.
 * Non-destructive: existing files are merged, other entries preserved.
 */
function installJsonFile(file) {
  const templateContent = renderContent(file.src);
  if (templateContent === null) {
    console.log(`  ${RED}✗${R} Missing template ${file.src} — reinstall yats-toolkit`);
    return false;
  }

  let templateObj;
  try {
    templateObj = JSON.parse(templateContent);
  } catch {
    console.log(`  ${RED}✗${R} Invalid template ${file.src}`);
    return false;
  }

  const destPath = file.dest;
  const exists = existsSync(destPath);
  let merged = templateObj;
  if (exists) {
    const existing = readJsonObject(destPath);
    if (existing === null) {
      console.log(`  ${Y}⚠${R} ${destPath} exists but is not valid JSON — left untouched.`);
      return false;
    }
    merged = mergeServerConfig(existing, templateObj);
  }

  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, JSON.stringify(merged, null, 2) + "\n");
  if (exists) {
    console.log(`  ${Y}↻${R} Merged YATS into existing ${destPath}`);
    console.log(`  ${D}  Added/updated: ${JSON.stringify(templateObj)}${R}`);
    console.log(`  ${D}  Your existing entries are preserved.${R}`);
  } else {
    console.log(`  ${G}✓${R} Created ${destPath}`);
  }
  return true;
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

async function installFiles(agentKey, prompter) {
  const agent = AGENTS[agentKey];
  if (!agent) {
    console.error(`Unknown agent: ${agentKey}`);
    process.exit(1);
  }

  console.log("");
  console.log(`  ${Y}${B}⚠️  This will add YATS config files to your current directory.${R}`);
  console.log(`  ${D}Existing files are never overwritten — YATS content is merged or appended.${R}`);
  console.log("");

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

    if (file.type === "json") {
      if (installJsonFile(file)) installed++;
      else skipped++;
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

  // Copilot switched from .copilot/mcp.json (CLI format) to the portable
  // .mcp.json at the repo root (Agent Host format). Point out the legacy file
  // so the old config doesn't linger unnoticed.
  if (agentKey === "copilot" && existsSync(".copilot/mcp.json")) {
    console.log(`  ${Y}⚠${R} Legacy .copilot/mcp.json found — Copilot now reads .mcp.json (Agent Host format).`);
    console.log(`  ${D}  Remove the old file if unused.${R}`);
    console.log("");
  }
}

// ============================================================
// Claude Code MCP activation
// ============================================================

/**
 * After installing Claude config files, ask how to activate the YATS MCP
 * server. Claude Code doesn't load project-scoped servers (.mcp.json)
 * without explicit approval, so offer the two no-approval scopes (local /
 * user) or leaving activation to the user (/mcp or session restart).
 */
async function claudeMcpActivation(prompter) {
  const mcpConfig = getYatsMcpConfig();
  const yatsUrl = mcpConfig?.mcpServers?.yats?.url;
  if (!yatsUrl) return;

  console.log("");
  console.log(`  ${Y}${B}⚠️  Claude Code doesn't load project MCP servers without approval.${R}`);
  console.log(`  ${D}Activate the YATS MCP server now (local/user scopes need no approval):${R}`);
  console.log("");
  console.log(`    ${B}1${R}. This project only  (--scope local)`);
  console.log(`    ${B}2${R}. All your projects  (--scope user)`);
  console.log(`    ${B}3${R}. Do nothing (activate later with /mcp or by restarting the session)`);
  console.log("");
  const choice = await prompter.ask(`  ${B}Pick [1-3]:${R} `);

  const scope = choice === "1" ? "local" : choice === "2" ? "user" : null;
  if (!scope) {
    console.log("");
    console.log(`  ${Y}—${R} Skipped. Remember: restart the Claude session and approve yats (${D}/mcp${R}) to load YATS tools.`);
    return;
  }

  const args = ["mcp", "add", "--scope", scope, "--transport", "sse", "yats", yatsUrl];
  console.log(`  ${D}Running: claude ${args.join(" ")}${R}`);
  console.log("");
  const res = spawnSync("claude", args, { stdio: "inherit" });
  if (res.error) {
    console.error(`  ${RED}✗${R} Could not run 'claude' (${res.error.message}).`);
  } else if (res.status !== 0) {
    console.error(`  ${RED}✗${R} 'claude mcp add' failed (exit ${res.status}).`);
  } else {
    console.log(`  ${G}✓${R} YATS MCP activated with scope '${scope}'. Restart the Claude session to load it.`);
  }
  if (res.error || res.status !== 0) {
    console.error(`  ${RED}  Run it manually: claude mcp add --scope ${scope} --transport sse yats ${yatsUrl}${R}`);
  }
  console.log("");
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

  console.log("");
  console.log(`  ${B}${agent.name}${R} — via ${agent.transport}`);
  console.log("");

  for (const file of agent.files) {
    console.log(`  ${B}${file.dest}${R}`);
    if (file.type === "json") {
      const templateContent = renderContent(file.src);
      if (templateContent) {
        try {
          const tpl = JSON.parse(templateContent);
          const existing = existsSync(file.dest) ? readJsonObject(file.dest) : null;
          const preview = existing ? mergeServerConfig(existing, tpl) : tpl;
          console.log(`  ${D}${JSON.stringify(preview, null, 2).replace(/\n/g, "\n  ")}${R}`);
        } catch {
          console.log(`  ${D}${templateContent.replace(/\n/g, "\n  ")}${R}`);
        }
      } else {
        console.log(`  ${RED}(missing template)${R}`);
      }
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
    const prompter = makePrompter();
    await installFiles(agentKey, prompter);
    if (agentKey === "claude") {
      await claudeMcpActivation(prompter);
    }
    prompter.close();
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
    { label: "VS Code (native MCP)", value: "vscode" },
    { label: "Gemini CLI", value: "gemini" },
    { label: "Codex CLI", value: "codex" },
  ]);

  showConfig(picked);
}
