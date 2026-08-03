/** yats start — Start all YATS Docker services */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

export default async function start() {
  const composeFile = join(homedir(), ".yats", "docker-compose.yml");
  console.log("Starting YATS services...");
  await new Promise((resolve, reject) => {
    const proc = spawn("docker", ["compose", "-f", composeFile, "up", "-d"], { stdio: "inherit" });
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
    proc.on("error", reject);
  });
  console.log("YATS started.");
}
