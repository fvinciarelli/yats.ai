import type { Symbol } from "../domain/models.js";

export interface RankedContextItem {
  symbol: Symbol;
  score: number;
  source: "vector" | "graph" | "both";
  relevanceReason: string;
  snippet: string;
}

export interface RetrievalDebug {
  vectorHits: number;
  graphExpanded: number;
  afterDedup: number;
  afterRanking: number;
  afterCompression: number;
}

export interface RetrievalResult {
  context: RankedContextItem[];
  tokenCount: number;
  durationMs: number;
  debug?: RetrievalDebug;
}

export interface RetrievalQuery {
  query: string;
  repository: string;
  options?: {
    maxVectorHits?: number;
    graphExpansionHops?: number;
    maxTotalResults?: number;
    maxTokens?: number;
    includeTests?: boolean;
    includeDocs?: boolean;
    rankingStrategy?: "relevance" | "diversity" | "balanced";
  };
}

export interface Retriever {
  retrieve(query: RetrievalQuery): Promise<RetrievalResult>;
}
