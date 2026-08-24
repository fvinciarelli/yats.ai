import { createLogger, type Logger, Language, SymbolKind } from "@yats/shared";
import type { GraphRepository, Relationship, EmbeddingGenerator, VectorRepository } from "@yats/shared";
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
  /** Unresolved relationships held back while the symbol table is still growing. */
  private readonly retry = new Map<string, Relationship[]>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly lastActivityAt = new Map<string, number>();
  /** Per-repository flush chain — serializes flushes to avoid races. */
  private readonly flushChains = new Map<string, Promise<RelationshipFlushResult>>();

  constructor(
    private readonly graphRepository: GraphRepository,
    private readonly embeddingGenerator: EmbeddingGenerator,
    private readonly vectorRepository: VectorRepository,
  ) {
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
  async flush(repository: string, options: { final?: boolean } = {}): Promise<RelationshipFlushResult> {
    // Serialize flushes per repository — concurrent flushes (debounce timer vs
    // /index/complete) race on the pending/retry maps and drop relationships.
    const prev = this.flushChains.get(repository) ??
      Promise.resolve({ stored: 0, filtered: 0, rewritten: 0 } as RelationshipFlushResult);
    const next = prev.then(() => this.doFlush(repository, options));
    this.flushChains.set(repository, next);
    return next;
  }

  private async doFlush(repository: string, options: { final?: boolean }): Promise<RelationshipFlushResult> {
    const timer = this.timers.get(repository);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(repository);
    }

    // Process both freshly buffered and previously unresolved relationships.
    const rels = [
      ...(this.pending.get(repository) ?? []),
      ...(this.retry.get(repository) ?? []),
    ];
    this.pending.delete(repository);
    this.retry.delete(repository);

    if (rels.length === 0) {
      return { stored: 0, filtered: 0, rewritten: 0 };
    }

    const entries = await this.graphRepository.listAllSymbols(repository);
    if (entries.length === 0) {
      // Symbol table is still empty (index mid-flight) — hold everything back
      // and retry on the next flush instead of dropping it.
      this.retry.set(repository, rels);
      return { stored: 0, filtered: 0, rewritten: 0 };
    }

    const table = new GlobalSymbolTable();
    table.index(entries as SymbolTableEntry[]);

    const { resolved, rewritten } = resolveRelationships(rels, table);

    const entryIds = new Set(entries.map((e) => e.id));
    // Filter out relationships whose source or target symbol doesn't exist
    // (e.g. IMPORTS pseudo-sources like "import:get_user", builtins like len()).
    const valid = resolved.filter((rel) =>
      entryIds.has(rel.sourceSymbolId) &&
      entryIds.has(rel.targetSymbolId),
    );
    const dangling = resolved.filter((rel) =>
      !entryIds.has(rel.sourceSymbolId) || !entryIds.has(rel.targetSymbolId),
    );

    // External calls (window.matchMedia, i18n.changeLanguage) are kept as
    // first-class nodes so "where do I use X?" is answerable: the caller
    // queries find_references(external::…) or search_code finds the node.
    const externalRels = dangling.filter((rel) =>
      rel.targetSymbolId.startsWith("external::") && entryIds.has(rel.sourceSymbolId),
    );
    const unresolved = dangling.filter((rel) => !externalRels.includes(rel));

    const toStore = valid.length > 0 || externalRels.length > 0
      ? [...valid, ...externalRels]
      : [];
    if (toStore.length > 0) {
      await this.graphRepository.upsertRelationships(toStore);
    }

    if (externalRels.length > 0) {
      try {
        const externalIds = [...new Set(externalRels.map((r) => r.targetSymbolId))];
        for (const id of externalIds) {
          await this.graphRepository.upsertExternalSymbol(id, id.split("::").pop() ?? id);
        }
        // Index a minimal "ficha" per external so search_code can discover it
        // and the agent can chain find_references(external::…).
        const texts = externalIds.map((id) => `[external] ${id.split("::").pop()}`);
        const vectors = await this.embeddingGenerator.embedBatch(texts);
        await this.vectorRepository.upsertVectors(externalIds.map((id, i) => ({
          id,
          vector: vectors[i] ?? [],
          payload: {
            symbolId: id,
            language: Language.TYPESCRIPT,
            repository,
            relativePath: "",
            namespace: "external",
            className: null,
            methodName: id.split("::").pop() ?? null,
            kind: SymbolKind.EXTERNAL,
            contentHash: "",
            gitCommit: null,
            timestamp: new Date().toISOString(),
          },
        })));
      } catch (err: any) {
        this.logger.warn(`External symbol indexing failed for ${repository}: ${err.message}`);
      }
    }

    if (!options.final && unresolved.length > 0) {
      // Not the final flush: the symbol table may still be growing (index
      // mid-flight), so keep the unresolved ones and retry on the next
      // flush — dropping them now would lose real calls forever.
      this.retry.set(repository, unresolved);
      this.logger.info(
        `Deferred ${unresolved.length}/${rels.length} unresolved relationships for ${repository} ` +
        `(retrying on next flush)`,
      );
      return { stored: valid.length, filtered: 0, rewritten };
    }

    this.logger.info(
      `Stored ${valid.length + externalRels.length}/${rels.length} relationships for ${repository} ` +
      `(rewritten ${rewritten} cross-file targets, ${externalRels.length} external, filtered ${unresolved.length} dangling endpoints)`,
    );

    return { stored: valid.length + externalRels.length, filtered: unresolved.length, rewritten };
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
