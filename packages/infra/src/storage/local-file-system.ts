import { createLogger, type Logger } from "@code-indexer/shared";
import type { FileSystem, FileEdit } from "@code-indexer/shared";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// ============================================================
// Local FileSystem implementation
// ============================================================

export class LocalFileSystem implements FileSystem {
  private readonly logger: Logger;

  constructor(private readonly repositoriesRoot: string = "/repositories") {
    this.logger = createLogger("fs:local");
  }

  async readFile(filePath: string): Promise<string> {
    this.validatePath(filePath);
    return fs.readFile(filePath, "utf-8");
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    this.validatePath(filePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
    this.logger.debug(`Written: ${filePath}`);
  }

  async updateFile(filePath: string, edits: FileEdit[]): Promise<void> {
    this.validatePath(filePath);
    let content = await this.readFile(filePath);

    for (const edit of edits) {
      if (!content.includes(edit.oldText)) {
        throw new Error(
          `Could not find text to replace in ${filePath}: "${edit.oldText.substring(0, 80)}..."`,
        );
      }
      content = content.replace(edit.oldText, edit.newText);
    }

    await fs.writeFile(filePath, content, "utf-8");
    this.logger.debug(`Updated: ${filePath} (${edits.length} edits)`);
  }

  async deleteFile(filePath: string): Promise<void> {
    this.validatePath(filePath);
    await fs.unlink(filePath);
    this.logger.debug(`Deleted: ${filePath}`);
  }

  async createFile(filePath: string, content: string): Promise<void> {
    this.validatePath(filePath);

    const exists = await this.exists(filePath);
    if (exists) {
      throw new Error(`File already exists: ${filePath}`);
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
    this.logger.debug(`Created: ${filePath}`);
  }

  async listFiles(
    directory: string,
    pattern?: string,
  ): Promise<string[]> {
    this.validatePath(directory);

    const entries = await fs.readdir(directory, {
      recursive: true,
      withFileTypes: true,
    });

    let files = entries
      .filter((e) => e.isFile())
      .map((e) => path.join(e.parentPath ?? directory, e.name));

    if (pattern) {
      const regex = new RegExp(pattern);
      files = files.filter((f) => regex.test(f));
    }

    return files;
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async resolvePath(
    repository: string,
    relativePath: string,
  ): Promise<string> {
    const resolved = path.resolve(
      this.repositoriesRoot,
      repository,
      relativePath,
    );

    // Path traversal prevention
    const repoRoot = path.resolve(this.repositoriesRoot, repository);
    if (!resolved.startsWith(repoRoot)) {
      throw new Error(
        `Path traversal detected: "${relativePath}" resolves outside repository root`,
      );
    }

    return resolved;
  }

  /**
   * Validate that a path doesn't contain obvious traversal attempts.
   */
  private validatePath(filePath: string): void {
    const normalized = path.normalize(filePath);

    // Block obvious attempts
    if (normalized.includes("..")) {
      // Allow .. inside a valid path, but check the resolved result
      const resolved = path.resolve(normalized);
      if (!resolved.startsWith(this.repositoriesRoot) && !resolved.startsWith("/")) {
        // For absolute paths, verify they're within repositoriesRoot
        if (
          resolved.startsWith("/") &&
          !resolved.startsWith(this.repositoriesRoot)
        ) {
          throw new Error(
            `Path traversal blocked: "${filePath}" is outside allowed directories`,
          );
        }
      }
    }
  }
}
