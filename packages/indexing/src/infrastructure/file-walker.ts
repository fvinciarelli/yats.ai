import { createLogger, type Logger } from "@code-indexer/shared";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { detectLanguage } from "./language-detector.js";

// ============================================================
// File system walker with filtering and .gitignore
// ============================================================

const ALWAYS_IGNORE = new Set([
  "node_modules",
  "vendor",
  ".git",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  ".cache",
  ".idea",
  ".vscode",
  ".vs",
  "bin",
  "obj",
  "target",
  "Debug",
  "Release",
]);

export interface WalkOptions {
  /** Only include files matching these extensions (e.g., [".ts", ".py"]) */
  extensions?: string[];
  /** Glob patterns to exclude */
  exclude?: string[];
  /** Custom root directories to skip */
  skipDirs?: Set<string>;
  /** Maximum file size in bytes to process (default 10MB) */
  maxFileSize?: number;
}

export interface WalkedFile {
  /** Absolute path */
  absolutePath: string;
  /** Path relative to root */
  relativePath: string;
  /** Detected language (null if unsupported) */
  language: string | null;
  /** File size in bytes */
  size: number;
}

export class FileWalker {
  private readonly logger: Logger;

  constructor(private readonly skipDirs: Set<string> = ALWAYS_IGNORE) {
    this.logger = createLogger("indexer:file-walker");
  }

  /**
   * Walk a directory tree and yield file paths matching the criteria.
   */
  async walk(
    rootPath: string,
    options: WalkOptions = {},
  ): Promise<WalkedFile[]> {
    const files: WalkedFile[] = [];
    const maxSize = options.maxFileSize ?? 10 * 1024 * 1024; // 10MB

    // Load .gitignore
    const gitignorePatterns = await this.loadGitignore(rootPath);

    await this.walkDir(rootPath, rootPath, options, gitignorePatterns, maxSize, files);

    this.logger.info(`Walked ${files.length} files in ${rootPath}`);
    return files;
  }

  private async walkDir(
    rootPath: string,
    currentPath: string,
    options: WalkOptions,
    gitignorePatterns: string[],
    maxSize: number,
    files: WalkedFile[],
  ): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch (err: any) {
      this.logger.warn(`Cannot read directory ${currentPath}: ${err.message}`);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      const relativePath = path.relative(rootPath, fullPath);

      if (entry.isDirectory()) {
        // Skip ignored directories
        if (this.skipDirs.has(entry.name)) continue;
        if (options.skipDirs?.has(entry.name)) continue;

        // Skip hidden directories (except .github, .vscode/doc specific)
        if (entry.name.startsWith(".") && entry.name !== ".github") continue;

        // Check gitignore
        if (this.isGitignored(relativePath + "/", gitignorePatterns)) continue;

        await this.walkDir(rootPath, fullPath, options, gitignorePatterns, maxSize, files);
      } else if (entry.isFile()) {
        // Skip hidden files
        if (entry.name.startsWith(".")) continue;

        // Check gitignore
        if (this.isGitignored(relativePath, gitignorePatterns)) continue;

        // Extension filter
        if (options.extensions?.length) {
          const ext = path.extname(entry.name).toLowerCase();
          if (!options.extensions.includes(ext)) continue;
        }

        // Size check
        try {
          const stat = await fs.stat(fullPath);
          if (stat.size > maxSize) {
            this.logger.debug(`Skipping large file: ${relativePath} (${stat.size} bytes)`);
            continue;
          }

          files.push({
            absolutePath: fullPath,
            relativePath,
            language: detectLanguage(relativePath),
            size: stat.size,
          });
        } catch (err: any) {
          this.logger.warn(`Cannot stat ${fullPath}: ${err.message}`);
        }
      }
    }
  }

  // ============================================================
  // .gitignore support
  // ============================================================

  private async loadGitignore(rootPath: string): Promise<string[]> {
    try {
      const content = await fs.readFile(
        path.join(rootPath, ".gitignore"),
        "utf-8",
      );
      return content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
    } catch {
      return [];
    }
  }

  private isGitignored(
    relativePath: string,
    patterns: string[],
  ): boolean {
    for (const pattern of patterns) {
      if (this.matchGitignore(relativePath, pattern)) return true;
    }
    return false;
  }

  private matchGitignore(filePath: string, pattern: string): boolean {
    // Simple glob matching
    if (pattern.endsWith("/")) {
      // Directory pattern
      return filePath.startsWith(pattern) || filePath.includes("/" + pattern);
    }

    if (pattern.includes("*")) {
      const regex = new RegExp(
        "^" +
          pattern
            .replace(/\./g, "\\.")
            .replace(/\*\*/g, "§§DOUBLESTAR§§")
            .replace(/\*/g, "[^/]*")
            .replace(/§§DOUBLESTAR§§/g, ".*") +
          "$",
      );
      return regex.test(filePath);
    }

    return filePath === pattern || filePath.startsWith(pattern);
  }
}
