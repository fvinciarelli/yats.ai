import type { RankedContextItem } from "@code-indexer/shared";

// ============================================================
// Token Budgeting — ensures results fit within context window
// ============================================================

export class TokenBudgetService {
  /**
   * Estimate the number of tokens in a text.
   * Uses a conservative character-based heuristic.
   * For production use, integrate with tiktoken or similar.
   */
  estimateTokens(text: string): number {
    if (!text) return 0;
    // Conservative: ~3.5 chars per token for code
    return Math.ceil(text.length / 3.5);
  }

  /**
   * Fit items within a token budget.
   * Truncates or removes items until the budget is satisfied.
   */
  fitWithinBudget(
    items: RankedContextItem[],
    maxTokens: number,
  ): RankedContextItem[] {
    const result: RankedContextItem[] = [];
    let usedTokens = 0;

    for (const item of items) {
      const snippetTokens = this.estimateTokens(item.snippet ?? "");

      if (usedTokens + snippetTokens <= maxTokens) {
        // Full snippet fits
        result.push(item);
        usedTokens += snippetTokens;
      } else if (item.symbol.signature) {
        // Try signature-only fallback
        const sigTokens = this.estimateTokens(item.symbol.signature);
        if (usedTokens + sigTokens <= maxTokens) {
          result.push({
            ...item,
            snippet: item.symbol.signature,
          });
          usedTokens += sigTokens;
        }
        // If signature doesn't fit either, skip this item
      }
      // No more budget
      else {
        break;
      }
    }

    return result;
  }
}
