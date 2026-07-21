export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  previousPath?: string;
}

export interface Watcher {
  close(): void;
}

export interface GitAdapter {
  getCurrentCommit(repoPath: string): Promise<string>;
  getChangedFiles(repoPath: string, sinceCommit: string): Promise<ChangedFile[]>;
  getFileAtCommit(repoPath: string, filePath: string, commit: string): Promise<string>;
  watchRepository(repoPath: string, onChanges: (files: string[]) => void): Promise<Watcher>;
}
