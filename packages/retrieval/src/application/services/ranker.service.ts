import type { RankedContextItem } from "@code-indexer/shared";
import { SymbolKind } from "@code-indexer/shared";

// ============================================================
// Ranking — scores and sorts search results
// ============================================================

const KIND_BOOST: Record<string, number> = {
  [SymbolKind.SERVICE]: 0.2,
  [SymbolKind.CONTROLLER]: 0.2,
  [SymbolKind.ENTITY]: 0.15,
  [SymbolKind.REPOSITORY]: 0.15,
  [SymbolKind.COMMAND]: 0.1,
  [SymbolKind.QUERY]: 0.1,
  [SymbolKind.EVENT]: 0.1,
  [SymbolKind.COMPONENT]: 0.1,
  [SymbolKind.CLASS]: 0.05,
  [SymbolKind.INTERFACE]: 0.05,
};

const SOURCE_BOOST: Record<string, number> = {
  vector: 0.1,
  graph: 0.0,
  both: 0.15,
};

export class RankerService {
  /**
   * Rank items by a composite score.
   */
  rank(
    items: RankedContextItem[],
    strategy: "relevance" | "diversity" | "balanced" = "balanced",
  ): RankedContextItem[] {
    if (strategy === "diversity") {
      return this.rankDiverse(items);
    }
    return this.rankRelevance(items);
  }

  private rankRelevance(items: RankedContextItem[]): RankedContextItem[] {
    return [...items].sort((a, b) => {
      const scoreA = this.computeScore(a);
      const scoreB = this.computeScore(b);
      return scoreB - scoreA; // descending
    });
  }

  private rankDiverse(items: RankedContextItem[]): RankedContextItem[] {
    // First by relevance, then spread by file
    const sorted = [...items].sort((a, b) => {
      const scoreA = this.computeScore(a);
      const scoreB = this.computeScore(b);
      return scoreB - scoreA;
    });

    // Ensure file diversity: at most 3 from same file in top positions
    const result: RankedContextItem[] = [];
    const fileCounts = new Map<string, number>();

    for (const item of sorted) {
      const file = item.symbol.location.relativePath;
      const count = fileCounts.get(file) ?? 0;
      if (count < 3) {
        result.push(item);
        fileCounts.set(file, count + 1);
      } else {
        // Push to the end
      }
    }

    // Append the rest
    for (const item of sorted) {
      if (!result.includes(item)) {
        result.push(item);
      }
    }

    return result;
  }

  private computeScore(item: RankedContextItem): number {
    let score = item.score;

    // Kind boost
    const kindBoost = KIND_BOOST[item.symbol.kind] ?? 0;
    score += kindBoost;

    // Source boost
    const sourceBoost = SOURCE_BOOST[item.source] ?? 0;
    score += sourceBoost;

    // Prefer items with doc comments (they're better documented)
    if (item.symbol.docComment) {
      score += 0.05;
    }

    // Prefer shorter symbols (more specific) over very long ones
    const snippetLen = item.snippet?.length ?? 0;
    if (snippetLen > 0 && snippetLen < 500) {
      score += 0.03;
    }

    return score;
  }
}
