import type { Symbol } from "../domain/models.js";

export interface SearchResultItem {
  symbol: Symbol;
  score: number;
  relevanceReason: string;
  snippet: string;
}

export interface SearchResult {
  items: SearchResultItem[];
  totalHits: number;
  queryTimeMs: number;
}
