import { CollectionName } from "@yats/shared";

// ============================================================
// Qdrant Collection Definitions
// ============================================================

export interface CollectionConfig {
  name: CollectionName;
  vectorSize: number;
  distance: "Cosine" | "Euclid" | "Dot";
  payloadIndexes: Array<{
    field: string;
    type: "keyword" | "integer" | "float" | "geo";
  }>;
}

export const COLLECTIONS: Record<CollectionName, CollectionConfig> = {
  [CollectionName.CODE]: {
    name: CollectionName.CODE,
    vectorSize: 768, // nomic-embed-text dimension
    distance: "Cosine",
    payloadIndexes: [
      { field: "language", type: "keyword" },
      { field: "repository", type: "keyword" },
      { field: "kind", type: "keyword" },
      { field: "namespace", type: "keyword" },
      { field: "className", type: "keyword" },
      { field: "relativePath", type: "keyword" },
    ],
  },

  [CollectionName.DOCUMENTATION]: {
    name: CollectionName.DOCUMENTATION,
    vectorSize: 768,
    distance: "Cosine",
    payloadIndexes: [
      { field: "repository", type: "keyword" },
      { field: "relativePath", type: "keyword" },
      { field: "kind", type: "keyword" },
    ],
  },
};

/**
 * Get collection config by name.
 * Allows vector size to be overridden (e.g., 1536 for OpenAI embeddings).
 */
export function getCollectionConfig(
  name: CollectionName,
  vectorSizeOverride?: number,
): CollectionConfig {
  const config = { ...COLLECTIONS[name], payloadIndexes: [...COLLECTIONS[name].payloadIndexes] };
  if (vectorSizeOverride) {
    config.vectorSize = vectorSizeOverride;
  }
  return config;
}
