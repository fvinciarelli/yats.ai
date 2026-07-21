import type { RankedContextItem } from "@code-indexer/shared";

// ============================================================
// Deduplication — removes duplicate search results
// ============================================================

export interface DedupOptions {
  /** Maximum number of results from the same file */
  fileLevelLimit?: number;
}

const DEFAULT_FILE_LIMIT = 3;

export class DeduplicatorService {
  /**
   * Remove duplicates, keeping the highest-scoring copy.
   * Also limits results per file.
   */
  deduplicate(
    items: RankedContextItem[],
    options: DedupOptions = {},
  ): RankedContextItem[] {
    const fileLimit = options.fileLevelLimit ?? DEFAULT_FILE_LIMIT;

    // Phase 1: Dedup by symbol ID
    const seen = new Map<string, RankedContextItem>();
    for (const item of items) {
      const existing = seen.get(item.symbol.id);
      if (!existing || item.score > existing.score) {
        seen.set(item.symbol.id, item);
      }
    }

    // Phase 2: Limit per file
    const byFile = new Map<string, RankedContextItem[]>();
    for (const item of seen.values()) {
      const file = item.symbol.location.relativePath;
      const list = byFile.get(file) ?? [];
      list.push(item);
      byFile.set(file, list);
    }

    // Sort each file's items by score and take top fileLimit
    const result: RankedContextItem[] = [];
    for (const [, fileItems] of byFile) {
      fileItems.sort((a, b) => b.score - a.score);
      result.push(...fileItems.slice(0, fileLimit));
    }

    // Final sort by score
    result.sort((a, b) => b.score - a.score);

    return result;
  }
}
