import { createLogger, type Logger } from "@yats/shared";
import type { GraphRepository, Relationship } from "@yats/shared";
import { GlobalSymbolTable, resolveRelationships, type SymbolTableEntry } from "./global-symbol-table.js";

// ============================================================
// PendingRelationshipStore — deferred cross-file resolution
//
// The per-file ingestion path (/index/file, watch mode) analyzes and
// stores symbols immediately, but relationships reference symbols in
// other files that may not be indexed yet. Storing them raw would
// silently drop every cross-file edge (Neo4j MATCH requires both
// endpoints to exist).
//
// Instead we buffer relationships per repository and flush them once
// the indexing session goes quiet (or on explicit /index/complete),
// resolving targets against the full repo symbol table first.
// ============================================================

const FLUSH_DEBOUNCE_MS = parseInt(process.env.YATS_REL_DEBOUNCE_MS ?? "3000", 10);

/** How long after the last file activity a repo is still considered "indexing". */
const IDLE_THRESHOLD_MS = 15_000;

export interface RelationshipFlushResult {
  stored: number;
  filtered: number;
  rewritten: number;
}

export interface IndexingStatus {
  indexing: boolean;
  pendingRelationships: number;
}

export class PendingRelationshipStore {
  private readonly logger: Logger;
  private readonly pending = new Map<string, Relationship[]>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly lastActivityAt = new Map<string, number>();

  constructor(private readonly graphRepository: GraphRepository) {
    this.logger = createLogger("indexer:pending-rels");
  }

  /** Buffer relationships for a repository and schedule a debounced flush. */
  add(repository: string, relationships: Relationship[]): void {
    if (relationships.length === 0) return;
    this.touch(repository);
    const existing = this.pending.get(repository) ?? [];
    this.pending.set(repository, existing.concat(relationships));
    this.scheduleFlush(repository);
  }

  /** Record that files for this repository are still arriving (indexing in progress). */
  touch(repository: string): void {
    this.lastActivityAt.set(repository, Date.now());
  }

  /**
   * Whether the repository is mid-indexing (relationships incomplete).
   * True while relationships are buffered, a flush timer is pending, or files
   * arrived within the idle threshold.
   */
  status(repository: string): IndexingStatus {
    const pendingRelationships = this.pending.get(repository)?.length ?? 0;
    const timerActive = this.timers.has(repository);
    const lastActivity = this.lastActivityAt.get(repository) ?? 0;
    const recentlyActive = Date.now() - lastActivity < IDLE_THRESHOLD_MS;
    return {
      indexing: pendingRelationships > 0 || timerActive || recentlyActive,
      pendingRelationships,
    };
  }

  /** Flush now (used by /index/complete and by the debounce timer). */
  async flush(repository: string): Promise<RelationshipFlushResult> {
    const timer = this.timers.get(repository);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(repository);
    }

    const rels = this.pending.get(repository);
    if (!rels || rels.length === 0) {
      return { stored: 0, filtered: 0, rewritten: 0 };
    }
    // Take ownership of the buffer first so concurrent flushes can't double-store.
    this.pending.delete(repository);

    const entries = await this.graphRepository.listAllSymbols(repository);
    if (entries.length === 0) {
      this.logger.debug(`No symbols for ${repository}, skipping ${rels.length} pending relationships`);
      return { stored: 0, filtered: rels.length, rewritten: 0 };
    }

    const table = new GlobalSymbolTable();
    table.index(entries as SymbolTableEntry[]);

    const { resolved, rewritten } = resolveRelationships(rels, table);

    // Filter out relationships whose source or target symbol doesn't exist
    // (e.g. IMPORTS pseudo-sources like "import:get_user", builtins like len()).
    const valid = resolved.filter((rel) =>
      entries.some((e) => e.id === rel.sourceSymbolId) &&
      entries.some((e) => e.id === rel.targetSymbolId),
    );
    const filtered = resolved.length - valid.length;

    if (valid.length > 0) {
      await this.graphRepository.upsertRelationships(valid);
    }

    this.logger.info(
      `Stored ${valid.length}/${rels.length} relationships for ${repository} ` +
      `(rewritten ${rewritten} cross-file targets, filtered ${filtered} dangling endpoints)`,
    );

    return { stored: valid.length, filtered, rewritten };
  }

  private scheduleFlush(repository: string): void {
    const existing = this.timers.get(repository);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      void this.flush(repository).catch((err) => {
        this.logger.error(`Pending relationship flush failed for ${repository}: ${err.message}`);
      });
    }, FLUSH_DEBOUNCE_MS);
    timer.unref?.();
    this.timers.set(repository, timer);
  }
}
