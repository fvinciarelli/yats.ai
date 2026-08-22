export interface IndexTimings {
  walkMs: number;
  analyzeMs: number;
  embedMs: number;
  storeMs: number;
  docsMs: number;
  totalMs: number;
}

export interface IndexResult {
  repository: string;
  symbolsFound: number;
  relationshipsFound: number;
  vectorsCreated: number;
  docsIndexed: number;
  errors: number;
  duration: number;
  timings: IndexTimings;
}

export interface Indexer {
  /**
   * Register repository metadata without walking the filesystem.
   * Used by the host CLI (`yats index`) — the server may not have access
   * to host paths, so indexing itself always happens via per-file HTTP.
   */
  registerRepository(repositoryName: string, rootPath: string): Promise<void>;
  indexFileContent(repositoryName: string, filePath: string, content: string): Promise<void>;
  removeFile(repositoryName: string, filePath: string): Promise<{ removed: number }>;
  /**
   * Flush pending per-file relationships for a repository: resolve cross-file
   * references against the full symbol table and store them in the graph.
   * Called automatically after a quiet period, or explicitly via POST /index/complete.
   */
  finalizeRepository(repositoryName: string): Promise<{
    stored: number;
    filtered: number;
    rewritten: number;
  }>;
  rebuildVectors(): Promise<{ repositories: number; symbols: number; errors: number }>;
}
