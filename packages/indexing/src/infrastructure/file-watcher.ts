import { createLogger, type Logger } from "@code-indexer/shared";
import { watch, type FSWatcher } from "node:fs";

// ============================================================
// File Watcher — monitors repository for changes
// ============================================================

export interface WatchCallback {
  (changedFiles: string[]): void | Promise<void>;
}

export class FileWatcherService {
  private readonly logger: Logger;
  private watchers: FSWatcher[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;
  private pendingFiles = new Set<string>();

  constructor(debounceMs = 500) {
    this.logger = createLogger("indexer:file-watcher");
    this.debounceMs = debounceMs;
  }

  /**
   * Watch a repository directory for file changes.
   * Debounces rapid changes and calls the callback with changed file paths.
   */
  async watch(
    repositoryPath: string,
    callback: WatchCallback,
  ): Promise<() => void> {
    this.logger.info(`Watching: ${repositoryPath}`);

    const watcher = watch(
      repositoryPath,
      { recursive: true },
      (_eventType, filename) => {
        if (!filename) return;

        // Skip hidden files and directories
        if (filename.startsWith(".")) return;
        if (filename.includes("node_modules/")) return;
        if (filename.includes("vendor/")) return;
        if (filename.includes("__pycache__/")) return;
        if (filename.includes(".git/")) return;

        this.pendingFiles.add(filename);

        // Debounce
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(async () => {
          const files = Array.from(this.pendingFiles);
          this.pendingFiles.clear();

          this.logger.debug(`Changes detected: ${files.length} files`);
          try {
            await callback(files);
          } catch (err: any) {
            this.logger.error(`Watch callback error: ${err.message}`);
          }
        }, this.debounceMs);
      },
    );

    this.watchers.push(watcher);

    // Return cleanup function
    return () => {
      watcher.close();
      this.watchers = this.watchers.filter((w) => w !== watcher);
      this.logger.info(`Stopped watching: ${repositoryPath}`);
    };
  }

  /**
   * Stop all watchers.
   */
  closeAll(): void {
    for (const w of this.watchers) {
      w.close();
    }
    this.watchers = [];
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.logger.info("All file watchers stopped");
  }
}
