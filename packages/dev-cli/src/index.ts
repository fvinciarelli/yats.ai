#!/usr/bin/env node
/**
 * yats-dev — Start/stop the YATS MCP server locally for development.
 *
 * Usage:
 *   yats-dev start                        # stdio transport
 *   yats-dev start --http                 # HTTP+SSE on port 5555
 *   yats-dev start --http --port 3000
 *   yats-dev stop                         # Kill running yats-dev server
 */
import "dotenv/config";
import "reflect-metadata";

import { createLogger, Language } from "@yats/shared";
import { container, initializeConnections, shutdownConnections, TOKENS } from "@yats/infra";
import type {
  GraphRepository,
  VectorRepository,
  EmbeddingGenerator,
  FileSystem,
  GitAdapter,
} from "@yats/shared";
import { AnalyzerFactory } from "@yats/analyzer-interface";
import { TypeScriptAnalyzer } from "@yats/analyzer-typescript";
import { GoAnalyzer } from "@yats/analyzer-go";
import { CSharpAnalyzer } from "@yats/analyzer-csharp";
import { PythonAnalyzer } from "@yats/analyzer-python";
import { IndexerService } from "@yats/indexing";
import { RetrieverService } from "@yats/retrieval";
import { McpServer } from "@yats/mcp-server";
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const logger = createLogger("dev-cli");
const PID_FILE = join(homedir(), ".yats", "dev-server.pid");

// ============================================================
// Commands
// ============================================================

const cmd = process.argv[2] || "start";
const args = process.argv.slice(3);

switch (cmd) {
  case "start":
    await start(args);
    break;
  case "stop":
    await stop();
    break;
  case "--help":
  case "-h":
    help();
    break;
  default:
    console.error(`Unknown command: ${cmd}`);
    help();
    process.exit(1);
}

// ============================================================
// Help
// ============================================================

function help() {
  console.log(`yats-dev — Start/stop the YATS MCP server locally

  yats-dev start                        stdio transport
  yats-dev start --http                 HTTP+SSE on port 5555
  yats-dev start --http --port N        HTTP+SSE on custom port
  yats-dev stop                         Kill running yats-dev server
  yats-dev --help                       This help`);
}

// ============================================================
// Start
// ============================================================

async function start(args: string[]) {
  process.on("uncaughtException", (err: any) => {
    if (err.code === "EPIPE" || err.code === "ECONNRESET") {
      console.error(`[yats-dev] Caught ${err.code}, ignoring (connection dropped)`);
      return;
    }
    console.error("[yats-dev] Fatal:", err);
    process.exit(1);
  });

  const http = args.includes("--http");
  const portIdx = args.indexOf("--port");
  const portArg = portIdx !== -1 ? args[portIdx + 1] : undefined;
  const port = portArg ? parseInt(portArg, 10) : 5555;

  try {
    // Bootstrap
    const analyzerFactory = new AnalyzerFactory();
    const tsAnalyzer = new TypeScriptAnalyzer();
    analyzerFactory.register(tsAnalyzer);
    analyzerFactory.register(tsAnalyzer, Language.JAVASCRIPT);
    analyzerFactory.register(new GoAnalyzer());
    analyzerFactory.register(new CSharpAnalyzer());
    analyzerFactory.register(new PythonAnalyzer());

    await initializeConnections();

    const graphRepo = container.resolve(TOKENS.GRAPH_REPOSITORY) as GraphRepository;
    const vectorRepo = container.resolve(TOKENS.VECTOR_REPOSITORY) as VectorRepository;
    const embeddings = container.resolve(TOKENS.EMBEDDING_GENERATOR) as EmbeddingGenerator;
    const fileSystem = container.resolve(TOKENS.FILE_SYSTEM) as FileSystem;
    const gitAdapter = container.resolve(TOKENS.GIT_ADAPTER) as GitAdapter;

    const indexer = new IndexerService({
      graphRepository: graphRepo,
      vectorRepository: vectorRepo,
      embeddingGenerator: embeddings,
      fileSystem,
      analyzerFactory,
      gitAdapter,
    });

    const retriever = new RetrieverService(graphRepo, vectorRepo, embeddings);

    // Write PID file for stop command
    if (http) {
      const { mkdirSync } = await import("node:fs");
      mkdirSync(join(homedir(), ".yats"), { recursive: true });
      writeFileSync(PID_FILE, String(process.pid));
      process.on("exit", () => { try { unlinkSync(PID_FILE); } catch {} });
      process.on("SIGINT", () => { try { unlinkSync(PID_FILE); } catch {}; process.exit(0); });
      process.on("SIGTERM", () => { try { unlinkSync(PID_FILE); } catch {}; process.exit(0); });
    }

    const mcpServer = new McpServer({
      retriever,
      graphRepository: graphRepo,
      vectorRepository: vectorRepo,
      embeddings,
      fileSystem,
      indexer,
      repositoriesRoot: process.env.REPOSITORIES_PATH ?? "/repos",
    });

    logger.info(`Starting MCP server (${http ? `HTTP+SSE :${port}` : "stdio"})...`);

    if (http) {
      await mcpServer.start({ transport: "http", port });
    } else {
      await mcpServer.start({ transport: "stdio" });
    }
  } catch (err: any) {
    console.error(`❌ MCP server failed: ${err.message}`);
  } finally {
    await shutdownConnections();
  }
}

// ============================================================
// Stop
// ============================================================

async function stop() {
  if (!existsSync(PID_FILE)) {
    // Try to find by port
    try {
      const out = execSync("lsof -ti :5555 2>/dev/null || true", { encoding: "utf-8" }).trim();
      if (out) {
        const pids = out.split("\n");
        for (const pid of pids) {
          try { process.kill(parseInt(pid), "SIGTERM"); } catch {}
        }
        console.log(`✓ Killed ${pids.length} process(es) on port 5555`);
        return;
      }
    } catch {}
    console.log("No running yats-dev server found.");
    return;
  }

  const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
  if (isNaN(pid)) {
    console.log("Invalid PID file. Removing it.");
    unlinkSync(PID_FILE);
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    console.log(`✓ Stopped yats-dev server (PID ${pid})`);
    try { unlinkSync(PID_FILE); } catch {}
  } catch (err: any) {
    if (err.code === "ESRCH") {
      console.log("Server was not running. Removing stale PID file.");
      try { unlinkSync(PID_FILE); } catch {}
    } else {
      console.error(`Failed to stop: ${err.message}`);
    }
  }
}
