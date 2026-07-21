// @code-indexer/infra — Infrastructure implementations

// Neo4j
export { Neo4jConnection } from "./neo4j/neo4j-connection.js";
export type { Neo4jConfig } from "./neo4j/neo4j-connection.js";
export { Neo4jGraphRepository } from "./neo4j/neo4j-graph-repository.js";

// Qdrant
export { QdrantConnection } from "./qdrant/qdrant-connection.js";
export type { QdrantConfig } from "./qdrant/qdrant-connection.js";
export { QdrantVectorRepository } from "./qdrant/qdrant-vector-repository.js";
export { COLLECTIONS, getCollectionConfig } from "./qdrant/collections.js";
export type { CollectionConfig } from "./qdrant/collections.js";

// Embeddings
export { OllamaEmbeddingGenerator } from "./embeddings/ollama-embedding-generator.js";
export type { OllamaConfig } from "./embeddings/ollama-embedding-generator.js";
export { OpenAIEmbeddingGenerator } from "./embeddings/openai-embedding-generator.js";
export type { OpenAIConfig } from "./embeddings/openai-embedding-generator.js";

// Storage
export { LocalFileSystem } from "./storage/local-file-system.js";
export { MemorySymbolStore } from "./storage/memory-symbol-store.js";

// Git
export { SimpleGitAdapter } from "./git/simple-git-adapter.js";

// DI
export { TOKENS } from "./di/tokens.js";
export { container, initializeConnections, shutdownConnections } from "./di/container.js";
