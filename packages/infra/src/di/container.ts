import "reflect-metadata";
import { container } from "tsyringe";
import { createLogger } from "@yats/shared";

import { TOKENS } from "./tokens.js";

// Infrastructure
import { Neo4jConnection } from "../neo4j/neo4j-connection.js";
import { Neo4jGraphRepository } from "../neo4j/neo4j-graph-repository.js";
import { QdrantConnection } from "../qdrant/qdrant-connection.js";
import { QdrantVectorRepository } from "../qdrant/qdrant-vector-repository.js";

// Embeddings
import { OllamaEmbeddingGenerator } from "../embeddings/ollama-embedding-generator.js";
import { OpenAIEmbeddingGenerator } from "../embeddings/openai-embedding-generator.js";

// Storage & Git
import { LocalFileSystem } from "../storage/local-file-system.js";
import { MemorySymbolStore } from "../storage/memory-symbol-store.js";
import { SimpleGitAdapter } from "../git/simple-git-adapter.js";

const logger = createLogger("di:container");

// ============================================================
// Configuration (from environment)
// ============================================================

const repositoriesRoot =
  process.env.REPOSITORIES_PATH ?? "/repositories";

// ============================================================
// Register singletons
// ============================================================

/**
 * Neo4j Connection — single instance shared across the app
 */
let _neo4jConn: Neo4jConnection | null = null;
container.register(TOKENS.NEO4J_CONNECTION, {
  useFactory: () => {
    if (!_neo4jConn) _neo4jConn = new Neo4jConnection();
    return _neo4jConn;
  },
});

/**
 * Graph Repository — depends on Neo4jConnection
 */
container.register(TOKENS.GRAPH_REPOSITORY, {
  useFactory: (c) => {
    const conn = c.resolve(TOKENS.NEO4J_CONNECTION) as Neo4jConnection;
    return new Neo4jGraphRepository(conn);
  },
});

/**
 * Qdrant Connection — single instance
 */
let _qdrantConn: QdrantConnection | null = null;
container.register(TOKENS.QDRANT_CONNECTION, {
  useFactory: () => {
    if (!_qdrantConn) _qdrantConn = new QdrantConnection();
    return _qdrantConn;
  },
});

/**
 * Vector Repository — depends on QdrantConnection
 */
container.register(TOKENS.VECTOR_REPOSITORY, {
  useFactory: (c) => {
    const conn = c.resolve(TOKENS.QDRANT_CONNECTION) as QdrantConnection;
    return new QdrantVectorRepository(conn);
  },
});

/**
 * Embedding Generator — Ollama by default, OpenAI if API key is set
 */
container.register(TOKENS.EMBEDDING_GENERATOR, {
  useFactory: () => {
    const provider = process.env.EMBEDDING_PROVIDER ?? "ollama";
    const openaiKey = process.env.OPENAI_API_KEY;

    if (provider === "openai" && openaiKey) {
      logger.info("Using OpenAI for embeddings (text-embedding-3-small)");
      return new OpenAIEmbeddingGenerator({ apiKey: openaiKey });
    }

    logger.info("Using Ollama for embeddings (nomic-embed-text)");
    return new OllamaEmbeddingGenerator();
  },
});

/**
 * File System
 */
container.register(TOKENS.FILE_SYSTEM, {
  useFactory: () => new LocalFileSystem(repositoriesRoot),
});

/**
 * Git Adapter
 */
let _gitAdapter: SimpleGitAdapter | null = null;
container.register(TOKENS.GIT_ADAPTER, {
  useFactory: () => {
    if (!_gitAdapter) _gitAdapter = new SimpleGitAdapter();
    return _gitAdapter;
  },
});

/**
 * Symbol Store — transient (new instance per indexing run)
 */
container.register(TOKENS.SYMBOL_STORE, {
  useFactory: () => new MemorySymbolStore(),
});

/**
 * Repositories root path
 */
container.register(TOKENS.REPOSITORIES_ROOT, {
  useValue: repositoriesRoot,
});

// ============================================================
// Connection lifecycle
// ============================================================

/**
 * Initialize all connections.
 * Call once at application startup.
 */
export async function initializeConnections(): Promise<void> {
  logger.info("Initializing infrastructure connections...");

  const neo4j = container.resolve(TOKENS.NEO4J_CONNECTION) as Neo4jConnection;
  const qdrant = container.resolve(TOKENS.QDRANT_CONNECTION) as QdrantConnection;

  await neo4j.connect();
  await neo4j.runMigrations();

  // Check embedding dimensions for Qdrant
  const embeddings = container.resolve(TOKENS.EMBEDDING_GENERATOR) as { dimensions: number };
  await qdrant.initialize(embeddings.dimensions);

  logger.info("All connections initialized");
}

/**
 * Shutdown all connections gracefully.
 * Call on SIGTERM/SIGINT.
 */
export async function shutdownConnections(): Promise<void> {
  logger.info("Shutting down connections...");

  const neo4j = container.resolve(TOKENS.NEO4J_CONNECTION) as Neo4jConnection;
  await neo4j.close();

  logger.info("All connections closed");
}

export { container };
