import type { Symbol, Relationship } from "../domain/models.js";
import type { SymbolKind, RelationshipKind } from "../domain/enums.js";

export interface GraphSymbol extends Symbol {
  nodeId: number;
  labels: string[];
}

export interface Subgraph {
  nodes: GraphSymbol[];
  relationships: Relationship[];
}

export interface RepositorySummary {
  repository: string;
  totalSymbols: number;
  totalRelationships: number;
  symbolsByKind: Record<string, number>;
  symbolsByLanguage: Record<string, number>;
  languages: string[];
}

export interface RepositoryInfo {
  name: string;
  rootPath: string;
}

export interface GraphRepository {
  upsertSymbol(symbol: Symbol): Promise<void>;
  upsertSymbols(symbols: Symbol[]): Promise<void>;
  upsertRelationship(rel: Relationship): Promise<void>;
  upsertRelationships(rels: Relationship[]): Promise<void>;
  deleteSymbol(symbolId: string): Promise<void>;
  deleteSymbols(symbolIds: string[]): Promise<void>;
  deleteRelationships(symbolId: string): Promise<void>;
  clearRepository(repository: string): Promise<void>;
  findSymbol(symbolId: string): Promise<GraphSymbol | null>;
  findSymbolByName(repository: string, name: string, kind?: SymbolKind): Promise<GraphSymbol[]>;
  findReferences(symbolId: string, limit?: number): Promise<GraphSymbol[]>;
  findCallers(symbolId: string, limit?: number): Promise<GraphSymbol[]>;
  findCallees(symbolId: string, limit?: number): Promise<GraphSymbol[]>;
  findImplementations(symbolId: string, limit?: number): Promise<GraphSymbol[]>;
  findInheritors(symbolId: string, limit?: number): Promise<GraphSymbol[]>;
  findTests(symbolId: string, limit?: number): Promise<GraphSymbol[]>;
  findRoutes(repository: string): Promise<GraphSymbol[]>;
  findConfiguration(repository: string, key?: string): Promise<GraphSymbol[]>;
  expandGraph(seedIds: string[], hops: number, relationshipTypes: RelationshipKind[]): Promise<Subgraph>;
  relatedSymbols(symbolId: string, limit?: number): Promise<GraphSymbol[]>;
  repositorySummary(repository: string): Promise<RepositorySummary>;
  listSymbols(repository: string, kind?: SymbolKind, limit?: number, offset?: number): Promise<GraphSymbol[]>;
  upsertRepositoryMetadata(name: string, rootPath: string): Promise<void>;
  listRepositories(): Promise<RepositoryInfo[]>;
  findRepositoryByPath(rootPath: string): Promise<RepositoryInfo | null>;
}
