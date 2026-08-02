export interface FileEdit {
  oldText: string;
  newText: string;
}

export interface FileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  updateFile(path: string, edits: FileEdit[]): Promise<void>;
  deleteFile(path: string): Promise<void>;
  createFile(path: string, content: string): Promise<void>;
  listFiles(directory: string, pattern?: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  resolvePath(repository: string, relativePath: string): Promise<string>;
}
