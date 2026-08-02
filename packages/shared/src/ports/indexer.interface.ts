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
  indexRepository(repositoryPath: string, options?: { skipDocs?: boolean }): Promise<IndexResult>;
  indexFile(repositoryName: string, filePath: string): Promise<void>;
  indexFileContent(repositoryName: string, filePath: string, content: string): Promise<void>;
  removeFile(repositoryName: string, filePath: string): Promise<{ removed: number }>;
  incrementalIndex(repositoryPath: string, sinceCommit: string): Promise<IndexResult>;
  indexDocumentation(repositoryPath: string): Promise<number>;
  ensureIndexed(repositoryPath: string, options?: { skipDocs?: boolean }): Promise<{
    status: "indexed" | "reindexed" | "fresh";
    result?: IndexResult;
  }>;
}
