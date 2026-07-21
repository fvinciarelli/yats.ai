// ============================================================
// Dependency Injection Tokens
// Each interface gets a unique symbol token for tsyringe
// ============================================================

export const TOKENS = {
  // Repositories
  GRAPH_REPOSITORY: Symbol.for("GraphRepository"),
  VECTOR_REPOSITORY: Symbol.for("VectorRepository"),

  // Embedding
  EMBEDDING_GENERATOR: Symbol.for("EmbeddingGenerator"),

  // Services
  INDEXER: Symbol.for("Indexer"),
  RETRIEVER: Symbol.for("Retriever"),

  // Infrastructure
  NEO4J_CONNECTION: Symbol.for("Neo4jConnection"),
  QDRANT_CONNECTION: Symbol.for("QdrantConnection"),
  FILE_SYSTEM: Symbol.for("FileSystem"),
  GIT_ADAPTER: Symbol.for("GitAdapter"),
  SYMBOL_STORE: Symbol.for("SymbolStore"),

  // Configuration
  REPOSITORIES_ROOT: Symbol.for("RepositoriesRoot"),
} as const;
