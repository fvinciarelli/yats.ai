export interface IndexRepositoryCommand {
  repositoryPath: string;
  incremental?: boolean;
  sinceCommit?: string;
  watch?: boolean;
}

export type { IndexResult } from "../ports/indexer.interface.js";
