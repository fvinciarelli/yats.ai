import type { Language, SymbolKind, CollectionName } from "../domain/enums.js";

export interface VectorPayload {
  symbolId?: string;
  docSectionId?: string;
  language: Language | "markdown";
  repository: string;
  relativePath: string;
  namespace: string;
  className: string | null;
  methodName: string | null;
  kind: SymbolKind | "doc_section";
  contentHash: string;
  gitCommit: string | null;
  timestamp: string;
}

export interface VectorPoint {
  id: string;
  vector: number[];
  payload: VectorPayload;
}

export interface SearchOptions {
  limit?: number;
  scoreThreshold?: number;
  offset?: number;
}

export interface VectorFilters {
  language?: Language | Language[];
  repository?: string;
  kind?: SymbolKind | SymbolKind[];
  namespace?: string;
  className?: string;
}

export interface SearchHit {
  id: string;
  score: number;
  payload: VectorPayload;
}

export interface VectorRepository {
  upsertVectors(points: VectorPoint[]): Promise<void>;
  deleteVectors(symbolIds: string[]): Promise<void>;
  clearCollection(collection: CollectionName): Promise<void>;
  clearVectorsByRepository(repository: string): Promise<void>;
  search(collection: CollectionName, queryVector: number[], options: SearchOptions): Promise<SearchHit[]>;
  searchWithFilters(collection: CollectionName, queryVector: number[], filters: VectorFilters, options: SearchOptions): Promise<SearchHit[]>;
}
