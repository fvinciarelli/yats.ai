import { createLogger, type Logger } from "@code-indexer/shared";
import type { GitAdapter, ChangedFile, Watcher } from "@code-indexer/shared";
import { execSync } from "node:child_process";

// ============================================================
// Simple Git Adapter — wraps git CLI
// ============================================================

export class SimpleGitAdapter implements GitAdapter {
  private readonly logger: Logger;

  constructor() {
    this.logger = createLogger("git:adapter");
  }

  async getCurrentCommit(repoPath: string): Promise<string> {
    return this.exec(repoPath, "git rev-parse HEAD").trim();
  }

  async getChangedFiles(
    repoPath: string,
    sinceCommit: string,
  ): Promise<ChangedFile[]> {
    const output = this.exec(
      repoPath,
      `git diff --name-status ${sinceCommit} HEAD`,
    );

    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const parts = line.split("\t");
        const statusCode = parts[0]!;
        const filePath = parts[parts.length - 1]!;

        const statusMap: Record<string, ChangedFile["status"]> = {
          A: "added",
          M: "modified",
          D: "deleted",
          R: "renamed",
        };

        const status = statusMap[statusCode.charAt(0)] ?? "modified";

        const result: ChangedFile = { path: filePath, status };

        // Handle renames: "R100\told.ts\tnew.ts"
        if (status === "renamed" && parts.length >= 3) {
          result.previousPath = parts[1];
          result.path = parts[2]!;
        }

        return result;
      });
  }

  async getFileAtCommit(
    repoPath: string,
    filePath: string,
    commit: string,
  ): Promise<string> {
    return this.exec(repoPath, `git show ${commit}:${filePath}`);
  }

  async watchRepository(
    _repoPath: string,
    _onChanges: (files: string[]) => void,
  ): Promise<Watcher> {
    // File watching is handled by chokidar in the indexer,
    // not via git. This is a placeholder.
    return { close: () => {} };
  }

  // ============================================================
  // Private
  // ============================================================

  private exec(cwd: string, command: string): string {
    try {
      return execSync(command, {
        cwd,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024, // 10MB
        timeout: 30000,
      });
    } catch (err: any) {
      this.logger.error(`Git command failed: ${command}`, err.message);
      throw new Error(`Git command failed in ${cwd}: ${command} — ${err.message}`);
    }
  }
}
