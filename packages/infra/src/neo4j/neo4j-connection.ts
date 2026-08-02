import neo4j, { type Driver, type Session, type SessionMode, int } from "neo4j-driver";
import { createLogger, type Logger } from "@yats/shared";

/** Convert Neo4j Integer objects to plain JS numbers (recursive) */
function toPlainObject(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (neo4j.isInt(obj)) return obj.toNumber();
  if (Array.isArray(obj)) return obj.map(toPlainObject);
  if (typeof obj === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = toPlainObject(v);
    }
    return out;
  }
  return obj;
}

/** Ensure limit/offset/hops params are Neo4j integers */
function neo4jParams(params?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!params) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if ((k === "limit" || k === "offset" || k === "hops") && typeof v === "number") {
      out[k] = neo4j.int(Math.floor(v));
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ============================================================
// Configuration
// ============================================================

export interface Neo4jConfig {
  uri: string;
  user: string;
  password: string;
  maxConnectionPoolSize?: number;
  connectionTimeout?: number;
}

function loadConfig(): Neo4jConfig {
  return {
    uri: process.env.NEO4J_URI ?? "bolt://localhost:7687",
    user: process.env.NEO4J_USER ?? "neo4j",
    password: process.env.NEO4J_PASSWORD ?? "password",
    maxConnectionPoolSize: parseInt(process.env.NEO4J_POOL_SIZE ?? "100", 10),
    connectionTimeout: parseInt(process.env.NEO4J_CONN_TIMEOUT ?? "30000", 10),
  };
}

// ============================================================
// Connection manager with retry logic
// ============================================================

const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 16000;

export class Neo4jConnection {
  private driver: Driver | null = null;
  private readonly config: Neo4jConfig;
  private readonly logger: Logger;
  private connected = false;

  constructor(config?: Partial<Neo4jConfig>) {
    this.config = { ...loadConfig(), ...config };
    this.logger = createLogger("neo4j:connection");
  }

  /**
   * Establish connection with exponential backoff retry.
   * Safe to call multiple times (idempotent).
   */
  async connect(): Promise<void> {
    if (this.driver && this.connected) return;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        this.logger.info(
          `Connecting to Neo4j at ${this.config.uri} (attempt ${attempt}/${MAX_RETRIES})...`,
        );

        this.driver = neo4j.driver(
          this.config.uri,
          neo4j.auth.basic(this.config.user, this.config.password),
          {
            maxConnectionPoolSize: this.config.maxConnectionPoolSize,
            connectionTimeout: this.config.connectionTimeout,
          },
        );

        // Verify connectivity
        await this.driver.verifyConnectivity();
        this.connected = true;
        this.logger.info("Connected to Neo4j successfully");
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.logger.warn(
          `Neo4j connection attempt ${attempt} failed: ${lastError.message}`,
        );

        if (this.driver) {
          await this.driver.close().catch(() => {});
          this.driver = null;
        }

        if (attempt < MAX_RETRIES) {
          const backoff = Math.min(
            INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1),
            MAX_BACKOFF_MS,
          );
          this.logger.debug(`Retrying in ${backoff}ms...`);
          await sleep(backoff);
        }
      }
    }

    throw new Error(
      `Failed to connect to Neo4j after ${MAX_RETRIES} attempts: ${lastError?.message}`,
    );
  }

  /**
   * Get a session from the connection pool.
   * Throws if not connected.
   */
  getSession(mode: SessionMode = "READ"): Session {
    if (!this.driver) {
      throw new Error("Neo4j not connected. Call connect() first.");
    }
    return this.driver.session({
      defaultAccessMode: mode,
      database: "neo4j",
    });
  }

  /**
   * Execute a Cypher query within a read transaction.
   */
  async read<T>(
    cypher: string,
    params?: Record<string, unknown>,
  ): Promise<T[]> {
    const session = this.getSession("READ");
    try {
      const result = await session.executeRead((tx) =>
        tx.run(cypher, neo4jParams(params)),
      );
      return result.records.map((r) => toPlainObject(r.toObject()) as T);
    } finally {
      await session.close();
    }
  }

  /**
   * Execute a Cypher query within a write transaction.
   */
  async write<T>(
    cypher: string,
    params?: Record<string, unknown>,
  ): Promise<T[]> {
    const session = this.getSession("WRITE");
    try {
      const result = await session.executeWrite((tx) =>
        tx.run(cypher, neo4jParams(params)),
      );
      return result.records.map((r) => toPlainObject(r.toObject()) as T);
    } finally {
      await session.close();
    }
  }

  /**
   * Execute multiple write operations in a single transaction.
   */
  async writeBatch(
    operations: Array<{ cypher: string; params?: Record<string, unknown> }>,
  ): Promise<void> {
    const session = this.getSession("WRITE");
    try {
      await session.executeWrite(async (tx) => {
        for (const op of operations) {
          await tx.run(op.cypher, op.params);
        }
      });
    } finally {
      await session.close();
    }
  }

  /**
   * Run the schema migration script.
   */
  async runMigrations(): Promise<void> {
    this.logger.info("Running Neo4j schema migrations...");

    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    const migrationsDir = path.join(
      import.meta.dirname,
      "..",
      "migrations",
    );

    try {
      const files = await fs.readdir(migrationsDir);
      const cypherFiles = files
        .filter((f) => f.endsWith(".cypher"))
        .sort();

      for (const file of cypherFiles) {
        const content = await fs.readFile(
          path.join(migrationsDir, file),
          "utf-8",
        );
        const statements = content
          .split(";")
          .map((s) => s.trim())
          .filter((s) => s && !s.startsWith("//"));

        for (const stmt of statements) {
          await this.write(stmt);
        }

        this.logger.debug(`Migration applied: ${file}`);
      }

      this.logger.info("Migrations complete");
    } catch (err) {
      this.logger.error(`Migration failed: ${err}`);
      throw err;
    }
  }

  /** Health check — returns true if connection is alive */
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.driver) return false;
      await this.driver.verifyConnectivity();
      return true;
    } catch {
      return false;
    }
  }

  /** Gracefully close the connection */
  async close(): Promise<void> {
    if (this.driver) {
      this.logger.info("Closing Neo4j connection...");
      await this.driver.close();
      this.driver = null;
      this.connected = false;
    }
  }

  /** Check if connected */
  get isConnected(): boolean {
    return this.connected;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
