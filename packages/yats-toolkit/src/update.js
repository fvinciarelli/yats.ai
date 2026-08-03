/** yats update — Update YATS CLI to the latest version */
import { spawn } from "node:child_process";

export default async function update() {
  console.log("Updating yats-toolkit to latest version...");
  await new Promise((resolve, reject) => {
    const proc = spawn("npm", ["install", "-g", "yats-toolkit@latest"], { stdio: "inherit" });
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
    proc.on("error", reject);
  });
  console.log("YATS CLI updated.");
}
