import type { GraphRepository, VectorRepository, Logger } from "@yats/shared";
import type { PendingRelationshipStore } from "./pending-relationships.js";

// ============================================================
// File symbol synchronization — P2: in-place updates
//
// Re-indexing a file used to delete all of its symbols with DETACH DELETE,
// which also destroyed *incoming* edges (e.g. re-indexing base.py killed
// JiraStrategy -> TicketSource because jira.py was not re-indexed at that
// moment). The graph degraded with any incremental flow.
//
// Instead we update in place:
//   - symbols that survive the re-analysis (same deterministic id) keep their
//     node and their incoming edges; only their outgoing edges are deleted
//     (they are regenerated from the new analysis);
//   - only symbols that disappeared from the new analysis are deleted.
//     Incoming edges to a disappeared symbol die with the node — acceptable
//     and documented (only re-indexing the callers could re-resolve them).
// ============================================================

export interface FileSymbolSyncDeps {
  graphRepository: Pick<
    GraphRepository,
    "listSymbolIdsByFile" | "deleteRelationships" | "deleteSymbols"
  >;
  vectorRepository: Pick<VectorRepository, "deleteVectors">;
  /** Buffer of deferred cross-file relationships (optional in unit contexts). */
  pendingRelationships?: PendingRelationshipStore;
}

/**
 * Synchronize a re-indexed file's symbols with the graph, preserving incoming
 * edges of surviving symbols.
 *
 * Also drops the file's stale buffered relationships so the pending flush
 * cannot resurrect outgoing edges from a previous analysis.
 *
 * @returns how many symbols were kept in place vs removed.
 */
export async function synchronizeFileSymbols(
  deps: FileSymbolSyncDeps,
  repository: string,
  filePath: string,
  newSymbolIds: Iterable<string>,
  logger: Logger,
): Promise<{ kept: number; removed: number }> {
  const existingIds = await deps.graphRepository.listSymbolIdsByFile(repository, filePath);
  const newIdSet = new Set(newSymbolIds);

  const kept = existingIds.filter((id) => newIdSet.has(id));
  const removed = existingIds.filter((id) => !newIdSet.has(id));

  // Surviving symbols: delete only their outgoing edges — incoming edges from
  // other files stay attached to the (still alive) node.
  if (kept.length > 0) {
    await deps.graphRepository.deleteRelationships(kept);
  }

  // Disappeared symbols: delete node (incoming edges die with it) + vectors.
  if (removed.length > 0) {
    await deps.graphRepository.deleteSymbols(removed);
    await deps.vectorRepository.deleteVectors(removed);
  }

  // The pending buffer may still hold relationships from the previous analysis
  // of this file; drop them so the flush cannot re-create dead edges.
  deps.pendingRelationships?.dropFile(repository, filePath);

  if (kept.length > 0 || removed.length > 0) {
    logger.debug(
      `File sync ${filePath}: ${kept.length} symbol(s) kept in place, ${removed.length} removed`,
    );
  }

  return { kept: kept.length, removed: removed.length };
}
