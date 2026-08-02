import type { Symbol, RetrievalDebug } from "@yats/shared";
import type {
  RankedContextItem,
  RetrievalQuery,
  RetrievalResult,
  Retriever,
} from "@yats/shared";
import type {
  GraphRepository,
  VectorRepository,
  EmbeddingGenerator,
} from "@yats/shared";
import { CollectionName } from "@yats/shared";
import { createLogger, type Logger } from "@yats/shared";
import { RankerService } from "./ranker.service.js";
import { DeduplicatorService } from "./deduplicator.service.js";
import { TokenBudgetService } from "./token-budget.service.js";
import { ContextCompressorService } from "./context-compressor.service.js";

// ============================================================
// Retriever Service — Hybrid Retrieval Pipeline
// ============================================================

const DEFAULTS = {
  maxVectorHits: 20,
  graphExpansionHops: 1,
  maxTotalResults: 30,
  maxTokens: 8000,
  includeTests: true,
  includeDocs: true,
  rankingStrategy: "balanced" as const,
};

export class RetrieverService implements Retriever {
  private readonly logger: Logger;
  private readonly ranker: RankerService;
  private readonly deduplicator: DeduplicatorService;
  private readonly tokenBudget: TokenBudgetService;
  private readonly compressor: ContextCompressorService;

  constructor(
    private readonly graphRepo: GraphRepository,
    private readonly vectorRepo: VectorRepository,
    private readonly embeddings: EmbeddingGenerator,
  ) {
    this.logger = createLogger("retriever:service");
    this.ranker = new RankerService();
    this.deduplicator = new DeduplicatorService();
    this.tokenBudget = new TokenBudgetService();
    this.compressor = new ContextCompressorService();
  }

  // ============================================================
  // Main Retrieval Method
  // ============================================================

  async retrieve(query: RetrievalQuery): Promise<RetrievalResult> {
    const startTime = Date.now();
    const options = { ...DEFAULTS, ...query.options };

    const debug: RetrievalDebug = {
      vectorHits: 0,
      graphExpanded: 0,
      afterDedup: 0,
      afterRanking: 0,
      afterCompression: 0,
    };

    try {
      // 1. Generate query embedding
      const queryVector = await this.embeddings.embed(query.query);

      // 2. Vector search in code collection
      const codeHits = await this.vectorRepo.search(
        CollectionName.CODE,
        queryVector,
        { limit: options.maxVectorHits },
      );

      // 3. Vector search in documentation (if enabled)
      let docHits: Awaited<ReturnType<typeof this.vectorRepo.search>> = [];
      if (options.includeDocs) {
        docHits = await this.vectorRepo.search(
          CollectionName.DOCUMENTATION,
          queryVector,
          { limit: 5 },
        );
      }

      debug.vectorHits = codeHits.length + docHits.length;

      // 4. Resolve symbol IDs from vector hits
      const symbolIds = codeHits
        .filter((h) => h.payload.symbolId)
        .map((h) => h.payload.symbolId!);

      // 5. Graph expansion from vector hits
      let graphItems: RankedContextItem[] = [];
      if (symbolIds.length > 0 && options.graphExpansionHops > 0) {
        const subgraph = await this.graphRepo.expandGraph(
          symbolIds.slice(0, 10), // Expand from top-10 hits
          options.graphExpansionHops,
          [],
        );

        debug.graphExpanded = subgraph.nodes.length;

        graphItems = subgraph.nodes.map((node) => ({
          symbol: node,
          score: 0.5, // Base score for graph neighbors
          source: "graph" as const,
          relevanceReason: "graph-neighbor",
          snippet: node.sourceSnippet || node.signature || node.name,
        }));
      }

      // 6. Build vector items
      const vectorItems: RankedContextItem[] = [];
      for (const hit of codeHits) {
        if (hit.payload.symbolId) {
          const symbol = await this.graphRepo.findSymbol(hit.payload.symbolId);
          if (symbol) {
            vectorItems.push({
              symbol,
              score: hit.score,
              source: "vector",
              relevanceReason: `vector-similarity:${hit.score.toFixed(2)}`,
              snippet: symbol.sourceSnippet || symbol.signature || symbol.name,
            });
          }
        }
      }

      // 7. Merge vector + graph results
      let merged: RankedContextItem[] = [...vectorItems, ...graphItems];

      // 8. Deduplicate
      merged = this.deduplicator.deduplicate(merged, {
        fileLevelLimit: 3,
      });
      debug.afterDedup = merged.length;

      // 9. Rank
      merged = this.ranker.rank(merged, options.rankingStrategy);
      debug.afterRanking = merged.length;

      // 10. Compress for token budget
      merged = this.compressor.compress(merged, {
        includeTests: options.includeTests,
      });
      debug.afterCompression = merged.length;

      // 11. Fit within token budget
      merged = this.tokenBudget.fitWithinBudget(
        merged,
        options.maxTokens,
      );

      const tokenCount = merged.reduce(
        (sum, item) => sum + this.tokenBudget.estimateTokens(item.snippet),
        0,
      );

      return {
        context: merged.slice(0, options.maxTotalResults),
        tokenCount,
        durationMs: Date.now() - startTime,
        debug: process.env.LOG_LEVEL === "debug" ? debug : undefined,
      };
    } catch (err: any) {
      this.logger.error(`Retrieval failed: ${err.message}`);
      return {
        context: [],
        tokenCount: 0,
        durationMs: Date.now() - startTime,
        debug: process.env.LOG_LEVEL === "debug" ? debug : undefined,
      };
    }
  }
}
