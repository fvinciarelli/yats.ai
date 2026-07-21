import { createHash } from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import { createLogger, type Logger } from "@yats/shared";
import type {
  VectorRepository,
  VectorPoint,
  SearchHit,
  SearchOptions,
  VectorFilters,
} from "@yats/shared";
import { CollectionName } from "@yats/shared";
import { QdrantConnection } from "./qdrant-connection.js";

// ============================================================
// Qdrant implementation of VectorRepository
// ============================================================

/** Convert a string ID to a UUID v5-like format for Qdrant compatibility */
function stringToUUID(str: string): string {
  const hash = createHash("sha1").update(str).digest("hex");
  // Format as UUID: 8-4-4-4-12
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_SCORE_THRESHOLD = 0.3;
const MAX_UPSERT_BATCH = 1000;

export class QdrantVectorRepository implements VectorRepository {
  private readonly client: QdrantClient;
  private readonly logger: Logger;

  constructor(connection: QdrantConnection) {
    this.client = connection.getClient();
    this.logger = createLogger("qdrant:vector-repo");
  }

  // ============================================================
  // Write Operations
  // ============================================================

  async upsertVectors(points: VectorPoint[]): Promise<void> {
    if (points.length === 0) return;

    // Group by collection
    const byCollection = new Map<CollectionName, VectorPoint[]>();
    for (const point of points) {
      // Determine collection from payload kind
      const collection =
        point.payload.kind === "doc_section"
          ? CollectionName.DOCUMENTATION
          : CollectionName.CODE;

      const batch = byCollection.get(collection) ?? [];
      batch.push(point);
      byCollection.set(collection, batch);
    }

    // Upsert each collection in batches
    for (const [collection, batch] of byCollection) {
      for (let i = 0; i < batch.length; i += MAX_UPSERT_BATCH) {
        const chunk = batch.slice(i, i + MAX_UPSERT_BATCH);

        await this.client.upsert(collection, {
          wait: true,
          points: chunk.map((p) => ({
            id: stringToUUID(p.id),
            vector: p.vector,
            payload: p.payload as unknown as Record<string, unknown>,
          })),
        });
      }

      this.logger.debug(
        `Upserted ${batch.length} vectors to "${collection}"`,
      );
    }
  }

  async deleteVectors(symbolIds: string[]): Promise<void> {
    if (symbolIds.length === 0) return;

    for (const collection of [
      CollectionName.CODE,
      CollectionName.DOCUMENTATION,
    ]) {
      try {
        await this.client.delete(collection, {
          wait: true,
          points: symbolIds.map(stringToUUID),
        });
      } catch {
        // Collection may not exist yet — that's ok
        this.logger.debug(
          `Could not delete from "${collection}" (may not exist)`,
        );
      }
    }
  }

  async clearVectorsByRepository(repository: string): Promise<void> {
    for (const collection of [CollectionName.CODE, CollectionName.DOCUMENTATION]) {
      try {
        await this.client.delete(collection, {
          wait: true,
          filter: {
            must: [{ key: "repository", match: { value: repository } }],
          },
        });
        this.logger.info(`Cleared vectors for "${repository}" from "${collection}"`);
      } catch {
        this.logger.debug(`No vectors to clear in "${collection}" for "${repository}"`);
      }
    }
  }

  async clearCollection(collection: CollectionName): Promise<void> {
    // Qdrant doesn't have a "clear" — delete and recreate would lose schema.
    // Instead, use a scroll + delete approach for large collections,
    // or simply delete the collection and let the connection recreate it.
    this.logger.warn(
      `clearCollection is destructive for "${collection}". Deleting collection...`,
    );
    try {
      await this.client.deleteCollection(collection);
      this.logger.info(`Collection "${collection}" deleted`);
    } catch {
      this.logger.debug(
        `Collection "${collection}" did not exist to delete`,
      );
    }
  }

  // ============================================================
  // Read Operations
  // ============================================================

  async search(
    collection: CollectionName,
    queryVector: number[],
    options: SearchOptions = {},
  ): Promise<SearchHit[]> {
    const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const scoreThreshold = options.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;
    const offset = options.offset ?? 0;

    const results = await this.client.search(collection, {
      vector: queryVector,
      limit: limit + offset,
      score_threshold: scoreThreshold,
      with_payload: true,
    });

    // Apply offset manually
    const sliced = results.slice(offset, offset + limit);

    return sliced.map((r) => ({
      id: String(r.id),
      score: r.score,
      payload: r.payload as any,
    }));
  }

  async searchWithFilters(
    collection: CollectionName,
    queryVector: number[],
    filters: VectorFilters,
    options: SearchOptions = {},
  ): Promise<SearchHit[]> {
    const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const scoreThreshold = options.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;
    const offset = options.offset ?? 0;

    // Build Qdrant filter
    const must: any[] = [];
    if (filters.repository) {
      must.push({ key: "repository", match: { value: filters.repository } });
    }
    if (filters.language) {
      const langs = Array.isArray(filters.language)
        ? filters.language
        : [filters.language];
      must.push({
        key: "language",
        match: { any: langs },
      });
    }
    if (filters.kind) {
      const kinds = Array.isArray(filters.kind)
        ? filters.kind
        : [filters.kind];
      must.push({
        key: "kind",
        match: { any: kinds },
      });
    }
    if (filters.namespace) {
      must.push({
        key: "namespace",
        match: { text: filters.namespace },
      });
    }
    if (filters.className) {
      must.push({
        key: "className",
        match: { text: filters.className },
      });
    }

    const filter = must.length > 0 ? { must } : undefined;

    const results = await this.client.search(collection, {
      vector: queryVector,
      filter,
      limit: limit + offset,
      score_threshold: scoreThreshold,
      with_payload: true,
    });

    const sliced = results.slice(offset, offset + limit);

    return sliced.map((r) => ({
      id: String(r.id),
      score: r.score,
      payload: r.payload as any,
    }));
  }
}
