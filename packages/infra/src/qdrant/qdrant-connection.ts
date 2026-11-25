import { QdrantClient } from "@qdrant/js-client-rest";
import { createLogger, type Logger, CollectionName } from "@yats/shared";
import { getCollectionConfig, type CollectionConfig } from "./collections.js";

// ============================================================
// Configuration
// ============================================================

export interface QdrantConfig {
  url: string;
  apiKey?: string;
  timeout?: number;
}

function loadConfig(): QdrantConfig {
  return {
    url: process.env.QDRANT_URL ?? "http://localhost:6333",
    apiKey: process.env.QDRANT_API_KEY,
    timeout: parseInt(process.env.QDRANT_TIMEOUT ?? "30000", 10),
  };
}

// ============================================================
// Connection manager with collection initialization
// ============================================================

export class QdrantConnection {
  private client: QdrantClient | null = null;
  private readonly config: QdrantConfig;
  private readonly logger: Logger;
  private initialized = false;
  /** True when an existing collection's dimension differs from the current embedding model. */
  dimensionMismatch = false;

  constructor(config?: Partial<QdrantConfig>) {
    this.config = { ...loadConfig(), ...config };
    this.logger = createLogger("qdrant:connection");
  }

  /** Get the underlying Qdrant client (lazy initialization) */
  getClient(): QdrantClient {
    if (!this.client) {
      this.client = new QdrantClient({
        url: this.config.url,
        apiKey: this.config.apiKey,
        timeout: this.config.timeout,
      });
    }
    return this.client;
  }

  /**
   * Initialize Qdrant: create collections if they don't exist,
   * set up payload indexes.
   */
  async initialize(vectorSizeOverride?: number): Promise<void> {
    if (this.initialized) return;

    const client = this.getClient();
    this.logger.info(`Initializing Qdrant at ${this.config.url}...`);

    for (const collectionName of [
      CollectionName.CODE,
      CollectionName.DOCUMENTATION,
    ]) {
      const config = getCollectionConfig(collectionName, vectorSizeOverride);

      let exists = false;
      try {
        const result = await client.collectionExists(collectionName);
        exists = (result as any)?.exists ?? false;
      } catch {
        // collectionExists throws if collection doesn't exist
        exists = false;
      }
      if (!exists) {
        this.logger.info(
          `Creating collection "${collectionName}" (${config.vectorSize}d, ${config.distance})...`,
        );

        await client.createCollection(collectionName, {
          vectors: {
            size: config.vectorSize,
            distance: config.distance,
          },
        });

        // Create payload indexes
        for (const index of config.payloadIndexes) {
          await client.createPayloadIndex(collectionName, {
            field_name: index.field,
            field_schema: index.type,
            wait: true,
          });
          this.logger.debug(
            `Payload index: ${collectionName}.${index.field} (${index.type})`,
          );
        }
      } else {
        // Collection already exists — verify its dimension matches the current model.
        try {
          const info = await client.getCollection(collectionName);
          const existingSize = extractVectorSize(info);
          if (existingSize != null && existingSize !== config.vectorSize) {
            this.dimensionMismatch = true;
            this.logger.error(
              `Collection "${collectionName}" is ${existingSize}d but the embedding model produces ${config.vectorSize}d. ` +
              `Semantic search will fail until the vector index is rebuilt (yats reindex --rebuild-vectors).`,
            );
          } else {
            this.logger.debug(`Collection "${collectionName}" already exists`);
          }
        } catch {
          this.logger.debug(`Collection "${collectionName}" already exists`);
        }
      }
    }

    this.initialized = true;
    this.logger.info("Qdrant initialized successfully");
    if (this.dimensionMismatch) {
      this.logger.warn("Vector index dimension mismatch detected — rebuild required (may incur API costs).");
    }
  }

  /** Delete and recreate both collections at the given vector size (used on embedding dimension change). */
  async recreateCollections(vectorSize: number): Promise<void> {
    const client = this.getClient();
    for (const collectionName of [CollectionName.CODE, CollectionName.DOCUMENTATION]) {
      try {
        await client.deleteCollection(collectionName);
      } catch {
        this.logger.debug(`Collection "${collectionName}" did not exist to delete`);
      }
      const config = getCollectionConfig(collectionName, vectorSize);
      this.logger.info(`Recreating collection "${collectionName}" (${config.vectorSize}d, ${config.distance})...`);
      await client.createCollection(collectionName, {
        vectors: { size: config.vectorSize, distance: config.distance },
      });
      for (const index of config.payloadIndexes) {
        await client.createPayloadIndex(collectionName, {
          field_name: index.field,
          field_schema: index.type,
          wait: true,
        });
      }
    }
    this.dimensionMismatch = false;
  }

  /** Health check — ping Qdrant */
  async healthCheck(): Promise<boolean> {
    try {
      const client = this.getClient();
      // Qdrant client doesn't have a direct ping, so we check if collections exist
      await client.getCollections();
      return true;
    } catch {
      return false;
    }
  }
}

/** Extract the vector size from a Qdrant collection-info response (single or named vectors). */
export function extractVectorSize(info: unknown): number | null {
  try {
    const config = (info as any)?.config;
    const vectors = config?.params?.vectors;
    if (vectors && typeof vectors === "object") {
      if (typeof vectors.size === "number") return vectors.size;
      const first = Object.values(vectors)[0] as any;
      if (first && typeof first.size === "number") return first.size;
    }
  } catch { /* ignore */ }
  return null;
}
