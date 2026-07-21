import { QdrantClient } from "@qdrant/js-client-rest";
import { createLogger, type Logger, CollectionName } from "@code-indexer/shared";
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

      const exists = await client.collectionExists(collectionName);
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
        this.logger.debug(`Collection "${collectionName}" already exists`);
      }
    }

    this.initialized = true;
    this.logger.info("Qdrant initialized successfully");
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
