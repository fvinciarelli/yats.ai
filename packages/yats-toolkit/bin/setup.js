#!/usr/bin/env node
/**
 * YATS Toolkit — Code intelligence for AI agents.
 *
 * Usage:
 *   yats setup              # One-time setup wizard
 *   yats index <path>       # Index a repository
 *   yats search <query>     # Search indexed code
 *   yats list               # List indexed repositories
 *   yats summary <repo>     # Show repository summary
 *   yats clear <repo>       # Delete indexed data by name
 *   yats remove <path>      # Delete indexed data by path
 *   yats status             # Check indexed repos
 *   yats stop               # Stop all YATS services
 *   yats start              # Start YATS services
 *   yats update             # Update CLI to latest version
 *   yats update-base        # Update Docker images
 *   yats bridge             # MCP stdio ↔ HTTP proxy (for Copilot, Claude)
 *   yats benchmark          # AI agent token comparison
 *   yats watch <path>       # Watch a repo and keep the index live
 */

const cmd = process.argv[2] || "setup";
const args = process.argv.slice(3);

switch (cmd) {
  case "setup":
    import("../src/setup.js").then(m => m.default());
    break;
  case "index":
  case "add": {
    const skipDocs = args.includes("--skip-docs");
    const cleanArgs = args.filter(a => a !== "--skip-docs");
    import("../src/indexer.js").then(m => m.default(cleanArgs, { skipDocs }));
    break;
  }
  case "search":
    import("../src/search.js").then(m => m.default(args));
    break;
  case "list":
    import("../src/list.js").then(m => m.default());
    break;
  case "summary":
    import("../src/summary.js").then(m => m.default(args));
    break;
  case "clear":
    import("../src/clear.js").then(m => m.default(args));
    break;
  case "remove":
    import("../src/remove.js").then(m => m.default(args));
    break;
  case "status":
    import("../src/status.js").then(m => m.default());
    break;
  case "stop":
    import("../src/stop.js").then(m => m.default());
    break;
  case "start":
    import("../src/start.js").then(m => m.default());
    break;
  case "update":
    import("../src/update.js").then(m => m.default());
    break;
  case "update-base":
    import("../src/update-base.js").then(m => m.default());
    break;
  case "bridge":
    import("../src/bridge.js");
    break;
  case "benchmark":
    import("../src/benchmark.js").then(m => m.runBenchmark());
    break;
  case "watch":
    import("../src/watch.js");
    break;
  case "--version":
  case "-v":
    try {
      const { readFileSync } = await import("node:fs");
      const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
      console.log(`yats v${pkg.version}`);
    } catch {
      console.log("yats v0.1.10");
    }
    break;
  default:
    console.log(`YATS Toolkit — Code intelligence for AI agents`);
    console.log(``);
    console.log(`  yats setup              Setup wizard`);
    console.log(`  yats index <path>       Index a repository`);
    console.log(`  yats search <query>     Search indexed code`);
    console.log(`  yats list               List indexed repositories`);
    console.log(`  yats summary <repo>     Show repository summary`);
    console.log(`  yats clear <repo>       Delete indexed data by name`);
    console.log(`  yats remove <path>      Delete indexed data by path`);
    console.log(`  yats status             Check indexed repos`);
    console.log(`  yats stop               Stop YATS services`);
    console.log(`  yats start              Start YATS services`);
    console.log(`  yats update             Update CLI to latest version`);
    console.log(`  yats update-base        Update Docker images`);
    console.log(`  yats bridge             Stdio proxy for Copilot/Claude`);
    console.log(`  yats benchmark          AI agent token comparison`);
    console.log(`  yats watch <path>       Keep index in sync with live edits`);
    break;
}
