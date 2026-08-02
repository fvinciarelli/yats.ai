import type { Symbol, Relationship } from "../domain/models.js";

export interface SymbolStore {
  add(symbol: Symbol): void;
  addRelationship(rel: Relationship): void;
  get(id: string): Symbol | undefined;
  getAll(): Symbol[];
  getRelationships(): Relationship[];
  clear(): void;
}
