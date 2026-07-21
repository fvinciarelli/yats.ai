import type { Symbol, Relationship } from "@yats/shared";

// ============================================================
// Symbol Differ — compares old and new symbol sets
// ============================================================

export interface SymbolDelta {
  added: Symbol[];
  modified: Symbol[];
  deleted: Symbol[];
  unchanged: Symbol[];
  addedRelationships: Relationship[];
  deletedRelationships: Relationship[];
}

export class SymbolDiffer {
  /**
   * Compare two sets of symbols and produce a delta.
   * Uses contentHash for change detection.
   */
  diff(
    oldSymbols: Symbol[],
    newSymbols: Symbol[],
    oldRelationships: Relationship[] = [],
    newRelationships: Relationship[] = [],
  ): SymbolDelta {
    const oldMap = new Map(oldSymbols.map((s) => [s.id, s]));
    const newMap = new Map(newSymbols.map((s) => [s.id, s]));

    const added: Symbol[] = [];
    const modified: Symbol[] = [];
    const deleted: Symbol[] = [];
    const unchanged: Symbol[] = [];

    // Find added and modified
    for (const newSym of newSymbols) {
      const oldSym = oldMap.get(newSym.id);
      if (!oldSym) {
        added.push(newSym);
      } else if (oldSym.contentHash !== newSym.contentHash) {
        modified.push(newSym);
      } else {
        unchanged.push(newSym);
      }
    }

    // Find deleted
    for (const oldSym of oldSymbols) {
      if (!newMap.has(oldSym.id)) {
        deleted.push(oldSym);
      }
    }

    // Relationship diff
    const oldRelSet = new Set(oldRelationships.map((r) => r.id));
    const newRelSet = new Set(newRelationships.map((r) => r.id));

    const addedRelationships = newRelationships.filter((r) => !oldRelSet.has(r.id));
    const deletedRelationships = oldRelationships.filter((r) => !newRelSet.has(r.id));

    return {
      added,
      modified,
      deleted,
      unchanged,
      addedRelationships,
      deletedRelationships,
    };
  }

  /**
   * Quick check: do any symbols in a file need re-indexing?
   */
  hasChanges(delta: SymbolDelta): boolean {
    return (
      delta.added.length > 0 ||
      delta.modified.length > 0 ||
      delta.deleted.length > 0
    );
  }

  /**
   * Summary stats for logging.
   */
  summarize(delta: SymbolDelta): string {
    return [
      `+${delta.added.length} added`,
      `~${delta.modified.length} modified`,
      `-${delta.deleted.length} deleted`,
      `=${delta.unchanged.length} unchanged`,
    ].join(", ");
  }
}
