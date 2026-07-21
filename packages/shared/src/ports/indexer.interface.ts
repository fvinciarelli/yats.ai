export interface IndexResult {
  repository: string;
  symbolsFound: number;
  relationshipsFound: number;
  vectorsCreated: number;
  docsIndexed: number;
  errors: number;
  duration: number;
}

export interface Indexer {
  indexRepository(repositoryPath: string): Promise<IndexResult>;
  indexFile(repositoryName: string, filePath: string): Promise<void>;
  removeFile(repositoryName: string, filePath: string): Promise<void>;
  incrementalIndex(repositoryPath: string, sinceCommit: string): Promise<IndexResult>;
  indexDocumentation(repositoryPath: string): Promise<number>;
}
