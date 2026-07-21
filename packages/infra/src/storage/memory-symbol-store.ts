import type { SymbolStore, Symbol, Relationship } from "@yats/shared";

/**
 * In-memory symbol store used during a single indexing run.
 * Not thread-safe — used within a single indexing pipeline invocation.
 */
export class MemorySymbolStore implements SymbolStore {
  private symbols = new Map<string, Symbol>();
  private relationships: Relationship[] = [];

  add(symbol: Symbol): void {
    this.symbols.set(symbol.id, symbol);
  }

  addRelationship(rel: Relationship): void {
    this.relationships.push(rel);
  }

  get(id: string): Symbol | undefined {
    return this.symbols.get(id);
  }

  getAll(): Symbol[] {
    return Array.from(this.symbols.values());
  }

  getRelationships(): Relationship[] {
    return this.relationships;
  }

  clear(): void {
    this.symbols.clear();
    this.relationships = [];
  }

  get size(): number {
    return this.symbols.size;
  }

  get relationshipCount(): number {
    return this.relationships.length;
  }
}
