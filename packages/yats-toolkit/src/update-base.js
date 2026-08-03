/** yats update-base — Update YATS Docker images to the latest version */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";

export default async function updateBase() {
  const composeFile = join(homedir(), ".yats", "docker-compose.yml");
  const B = "\x1b[1m";
  const Y = "\x1b[33m";
  const G = "\x1b[32m";
  const R = "\x1b[0m";

  console.log("");
  console.log(`  ${Y}${B}⚠️  This will:${R}`);
  console.log(`    • Stop all YATS containers (Neo4j, Qdrant, YATS server)`);
  console.log(`    • Pull the latest Docker images`);
  console.log(`    • Recreate containers with the new images`);
  console.log("");
  console.log(`  ${G}✓${R} Your indexed data is preserved in Docker volumes.`);
  console.log(`  ${Y}⏳${R} Downtime: ~30-60 seconds.`);
  console.log("");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question(`  ${B}Proceed? [y/N]${R} `, resolve);
  });
  rl.close();

  if (answer.toLowerCase() !== "y") {
    console.log("");
    console.log("  Cancelled.");
    console.log("");
    process.exit(0);
  }

  console.log("");
  console.log("  Pulling latest images...");
  await run("docker", ["compose", "-f", composeFile, "pull"]);

  console.log("  Recreating containers...");
  await run("docker", ["compose", "-f", composeFile, "up", "-d", "--force-recreate"]);

  console.log("");
  console.log(`  ${G}✓${R} YATS base updated.`);
  console.log("");
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: "inherit" });
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
    proc.on("error", reject);
  });
}
