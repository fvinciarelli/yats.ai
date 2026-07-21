#!/usr/bin/env node
/**
 * YATS — Yet Another Token Saver
 * 
 * Usage:
 *   npx yats setup              # One-time setup wizard
 *   npx yats index <path>       # Index a repository
 *   npx yats status             # Check indexed repos
 *   npx yats stop               # Stop all YATS services
 *   npx yats bridge             # MCP stdio ↔ HTTP proxy (for Copilot, Claude)
 */

const cmd = process.argv[2] || "setup";
const args = process.argv.slice(3);

switch (cmd) {
  case "setup":
    import("../src/setup.js").then(m => m.default());
    break;
  case "index":
  case "add":
    import("../src/indexer.js").then(m => m.default(args));
    break;
  case "status":
    import("../src/status.js").then(m => m.default());
    break;
  case "stop":
    import("../src/stop.js").then(m => m.default());
    break;
  case "bridge":
    import("../src/bridge.js");
    break;
  case "--version":
  case "-v":
    console.log("yats v0.1.0");
    break;
  default:
    console.log(`YATS — Yet Another Token Saver`);
    console.log(``);
    console.log(`  npx yats setup              Setup wizard`);
    console.log(`  npx yats index <path>       Index a repository`);
    console.log(`  npx yats status             Check indexed repos`);
    console.log(`  npx yats stop               Stop YATS services`);
    console.log(`  npx yats bridge             Stdio proxy for Copilot/Claude`);
    break;
}
