import type { Symbol, Relationship, SymbolKind, RelationshipKind } from "@code-indexer/shared";
import type { GraphSymbol, Subgraph, RepositorySummary } from "@code-indexer/shared";
import type { GraphRepository } from "@code-indexer/shared";
import { createLogger, type Logger } from "@code-indexer/shared";
import { Neo4jConnection } from "./neo4j-connection.js";

// ============================================================
// Neo4j implementation of GraphRepository
// ============================================================

export class Neo4jGraphRepository implements GraphRepository {
  private readonly logger: Logger;

  constructor(private readonly connection: Neo4jConnection) {
    this.logger = createLogger("neo4j:graph-repo");
  }

  // ============================================================
  // Symbol CRUD
  // ============================================================

  async upsertSymbol(symbol: Symbol): Promise<void> {
    const labels = this.buildLabels(symbol.kind);

    await this.connection.write(
      `
      MERGE (s:Symbol {id: $id})
      SET s += $properties
      ${labels.map((l) => `SET s:${l}`).join("\n      ")}
      `,
      {
        id: symbol.id,
        properties: this.symbolToProperties(symbol),
      },
    );
  }

  async upsertSymbols(symbols: Symbol[]): Promise<void> {
    if (symbols.length === 0) return;

    // Process in batches of 500 for performance
    const BATCH_SIZE = 500;
    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);
      const operations = batch.map((symbol) => {
        const labels = this.buildLabels(symbol.kind);
        const labelStatements = labels.map((l) => `SET s:${l}`).join("\n      ");

        return {
          cypher: `
            MERGE (s:Symbol {id: $id})
            SET s += $properties
            ${labelStatements}
          `,
          params: {
            id: symbol.id,
            properties: this.symbolToProperties(symbol),
          },
        };
      });

      await this.connection.writeBatch(operations);
    }
  }

  async deleteSymbol(symbolId: string): Promise<void> {
    await this.connection.write(
      `MATCH (s:Symbol {id: $id}) DETACH DELETE s`,
      { id: symbolId },
    );
  }

  async deleteSymbols(symbolIds: string[]): Promise<void> {
    if (symbolIds.length === 0) return;

    await this.connection.write(
      `
      UNWIND $ids AS id
      MATCH (s:Symbol {id: id})
      DETACH DELETE s
      `,
      { ids: symbolIds },
    );
  }

  async clearRepository(repository: string): Promise<void> {
    await this.connection.write(
      `
      MATCH (s:Symbol {repository: $repository})
      DETACH DELETE s
      `,
      { repository },
    );

    await this.connection.write(
      `
      MATCH (r:Repository {name: $repository})
      DELETE r
      `,
      { repository },
    );

    this.logger.info(`Cleared all data for repository: ${repository}`);
  }

  // ============================================================
  // Relationship CRUD
  // ============================================================

  async upsertRelationship(rel: Relationship): Promise<void> {
    await this.connection.write(
      `
      MATCH (source:Symbol {id: $sourceId})
      MATCH (target:Symbol {id: $targetId})
      MERGE (source)-[r:${rel.kind} {id: $relId}]->(target)
      SET r += $metadata
      `,
      {
        sourceId: rel.sourceSymbolId,
        targetId: rel.targetSymbolId,
        relId: rel.id,
        metadata: rel.metadata,
      },
    );
  }

  async upsertRelationships(rels: Relationship[]): Promise<void> {
    if (rels.length === 0) return;

    const BATCH_SIZE = 500;
    for (let i = 0; i < rels.length; i += BATCH_SIZE) {
      const batch = rels.slice(i, i + BATCH_SIZE);
      const operations = batch.map((rel) => ({
        cypher: `
          MATCH (source:Symbol {id: $sourceId})
          MATCH (target:Symbol {id: $targetId})
          MERGE (source)-[r:${rel.kind} {id: $relId}]->(target)
          SET r += $metadata
        `,
        params: {
          sourceId: rel.sourceSymbolId,
          targetId: rel.targetSymbolId,
          relId: rel.id,
          metadata: rel.metadata,
        },
      }));

      await this.connection.writeBatch(operations);
    }
  }

  async deleteRelationships(symbolId: string): Promise<void> {
    await this.connection.write(
      `
      MATCH (s:Symbol {id: $id})-[r]-()
      DELETE r
      `,
      { id: symbolId },
    );
  }

  // ============================================================
  // Symbol Lookups
  // ============================================================

  async findSymbol(symbolId: string): Promise<GraphSymbol | null> {
    const rows = await this.connection.read<any>(
      `
      MATCH (s:Symbol {id: $id})
      RETURN s, labels(s) AS labels, id(s) AS nodeId
      `,
      { id: symbolId },
    );

    if (rows.length === 0) return null;
    return this.rowToGraphSymbol(rows[0]!);
  }

  async findSymbolByName(
    repository: string,
    name: string,
    kind?: SymbolKind,
  ): Promise<GraphSymbol[]> {
    let cypher: string;
    let params: Record<string, unknown>;

    if (kind) {
      cypher = `
        MATCH (s:Symbol {repository: $repository})
        WHERE toLower(s.name) CONTAINS toLower($name)
          AND s.kind = $kind
        RETURN s, labels(s) AS labels, id(s) AS nodeId
        LIMIT $limit
      `;
      params = { repository, name, kind, limit: 50 };
    } else {
      cypher = `
        MATCH (s:Symbol {repository: $repository})
        WHERE toLower(s.name) CONTAINS toLower($name)
        RETURN s, labels(s) AS labels, id(s) AS nodeId
        LIMIT $limit
      `;
      params = { repository, name, limit: 50 };
    }

    const rows = await this.connection.read<any>(cypher, params);
    return rows.map((r) => this.rowToGraphSymbol(r));
  }

  async listSymbols(
    repository: string,
    kind?: SymbolKind,
    limit = 50,
    offset = 0,
  ): Promise<GraphSymbol[]> {
    const kindFilter = kind ? "AND s.kind = $kind" : "";

    const rows = await this.connection.read<any>(
      `
      MATCH (s:Symbol {repository: $repository})
      WHERE 1=1 ${kindFilter}
      RETURN s, labels(s) AS labels, id(s) AS nodeId
      ORDER BY s.name
      SKIP $offset
      LIMIT $limit
      `,
      { repository, kind, offset, limit },
    );

    return rows.map((r) => this.rowToGraphSymbol(r));
  }

  // ============================================================
  // Reference & Call Resolution
  // ============================================================

  async findReferences(
    symbolId: string,
    limit = 20,
  ): Promise<GraphSymbol[]> {
    const rows = await this.connection.read<any>(
      `
      MATCH (target:Symbol {id: $symbolId})
      MATCH (source:Symbol)-[r:REFERENCES|CALLS|IMPORTS|INSTANTIATES]->(target)
      RETURN DISTINCT source AS s, labels(source) AS labels, id(source) AS nodeId, type(r) AS relType
      LIMIT $limit
      `,
      { symbolId, limit },
    );

    return rows.map((r) => this.rowToGraphSymbol(r));
  }

  async findCallers(
    symbolId: string,
    limit = 20,
  ): Promise<GraphSymbol[]> {
    const rows = await this.connection.read<any>(
      `
      MATCH (target:Symbol {id: $symbolId})
      MATCH (caller:Symbol)-[r:CALLS]->(target)
      RETURN caller AS s, labels(caller) AS labels, id(caller) AS nodeId
      LIMIT $limit
      `,
      { symbolId, limit },
    );

    return rows.map((r) => this.rowToGraphSymbol(r));
  }

  async findCallees(
    symbolId: string,
    limit = 20,
  ): Promise<GraphSymbol[]> {
    const rows = await this.connection.read<any>(
      `
      MATCH (source:Symbol {id: $symbolId})
      MATCH (source)-[r:CALLS]->(callee:Symbol)
      RETURN callee AS s, labels(callee) AS labels, id(callee) AS nodeId
      LIMIT $limit
      `,
      { symbolId, limit },
    );

    return rows.map((r) => this.rowToGraphSymbol(r));
  }

  // ============================================================
  // Inheritance & Implementation
  // ============================================================

  async findImplementations(
    symbolId: string,
    limit = 20,
  ): Promise<GraphSymbol[]> {
    const rows = await this.connection.read<any>(
      `
      MATCH (iface:Symbol {id: $symbolId})
      MATCH (impl:Symbol)-[r:IMPLEMENTS]->(iface)
      RETURN impl AS s, labels(impl) AS labels, id(impl) AS nodeId
      LIMIT $limit
      `,
      { symbolId, limit },
    );

    return rows.map((r) => this.rowToGraphSymbol(r));
  }

  async findInheritors(
    symbolId: string,
    limit = 20,
  ): Promise<GraphSymbol[]> {
    const rows = await this.connection.read<any>(
      `
      MATCH (parent:Symbol {id: $symbolId})
      MATCH (child:Symbol)-[r:INHERITS]->(parent)
      RETURN child AS s, labels(child) AS labels, id(child) AS nodeId
      LIMIT $limit
      `,
      { symbolId, limit },
    );

    return rows.map((r) => this.rowToGraphSymbol(r));
  }

  // ============================================================
  // Specialized Searches
  // ============================================================

  async findTests(
    symbolId: string,
    limit = 20,
  ): Promise<GraphSymbol[]> {
    // Both directions: find tests that test this symbol, and find what this test tests
    const rows = await this.connection.read<any>(
      `
      MATCH (a:Symbol {id: $symbolId})
      OPTIONAL MATCH (a)-[r:TESTS]->(b:Symbol)
      OPTIONAL MATCH (c:Symbol)-[r2:TESTS]->(a)
      RETURN DISTINCT COALESCE(b, c) AS s, labels(COALESCE(b, c)) AS labels, id(COALESCE(b, c)) AS nodeId
      LIMIT $limit
      `,
      { symbolId, limit },
    );

    return rows
      .filter((r: any) => r.s !== null)
      .map((r: any) => this.rowToGraphSymbol(r));
  }

  async findRoutes(repository: string): Promise<GraphSymbol[]> {
    const rows = await this.connection.read<any>(
      `
      MATCH (s:Route {repository: $repository})
      RETURN s, labels(s) AS labels, id(s) AS nodeId
      LIMIT 100
      `,
      { repository },
    );
    return rows.map((r) => this.rowToGraphSymbol(r));
  }

  async findConfiguration(
    repository: string,
    key?: string,
  ): Promise<GraphSymbol[]> {
    let cypher: string;
    let params: Record<string, unknown>;

    if (key) {
      cypher = `
        MATCH (s:Config {repository: $repository})
        WHERE toLower(s.name) CONTAINS toLower($key)
        RETURN s, labels(s) AS labels, id(s) AS nodeId
        LIMIT 30
      `;
      params = { repository, key };
    } else {
      cypher = `
        MATCH (s:Config {repository: $repository})
        RETURN s, labels(s) AS labels, id(s) AS nodeId
        LIMIT 50
      `;
      params = { repository };
    }

    const rows = await this.connection.read<any>(cypher, params);
    return rows.map((r) => this.rowToGraphSymbol(r));
  }

  // ============================================================
  // Graph Expansion
  // ============================================================

  async expandGraph(
    seedIds: string[],
    hops: number,
    relationshipTypes: RelationshipKind[],
  ): Promise<Subgraph> {
    if (seedIds.length === 0 || hops < 1) {
      return { nodes: [], relationships: [] };
    }

    const relFilter =
      relationshipTypes.length > 0
        ? `WHERE type(r) IN $relTypes`
        : "";

    const rows = await this.connection.read<any>(
      `
      MATCH (seed:Symbol)
      WHERE seed.id IN $seedIds
      MATCH path = (seed)-[*1..${hops}]-(neighbor:Symbol)
      WHERE ALL(r IN relationships(path) WHERE $relTypesCheck OR type(r) IN $relTypes)
      RETURN DISTINCT neighbor AS s, labels(neighbor) AS labels, id(neighbor) AS nodeId
      LIMIT 200
      `,
      {
        seedIds,
        relTypes: relationshipTypes,
        relTypesCheck: relationshipTypes.length === 0,
      },
    );

    const nodes = rows.map((r) => this.rowToGraphSymbol(r));

    // Also include seed nodes
    const seedRows = await this.connection.read<any>(
      `
      MATCH (s:Symbol)
      WHERE s.id IN $seedIds
      RETURN s, labels(s) AS labels, id(s) AS nodeId
      `,
      { seedIds },
    );

    const seedNodes = seedRows.map((r) => this.rowToGraphSymbol(r));
    const allNodes = [...seedNodes, ...nodes];
    const uniqueNodes = dedupBy(allNodes, (n) => n.id);

    return {
      nodes: uniqueNodes,
      relationships: [], // Only nodes for now; full subgraph with rels can be added later
    };
  }

  async relatedSymbols(
    symbolId: string,
    limit = 30,
  ): Promise<GraphSymbol[]> {
    const rows = await this.connection.read<any>(
      `
      MATCH (s:Symbol {id: $symbolId})-[r]-(neighbor:Symbol)
      RETURN DISTINCT neighbor AS s, labels(neighbor) AS labels, id(neighbor) AS nodeId, type(r) AS relType
      LIMIT $limit
      `,
      { symbolId, limit },
    );

    return rows.map((r) => this.rowToGraphSymbol(r));
  }

  // ============================================================
  // Summary
  // ============================================================

  async repositorySummary(
    repository: string,
  ): Promise<RepositorySummary> {
    const kindRows = await this.connection.read<{ kind: string; count: number }>(
      `
      MATCH (s:Symbol {repository: $repository})
      RETURN s.kind AS kind, count(s) AS count
      ORDER BY count DESC
      `,
      { repository },
    );

    const langRows = await this.connection.read<{ language: string; count: number }>(
      `
      MATCH (s:Symbol {repository: $repository})
      RETURN s.language AS language, count(s) AS count
      ORDER BY count DESC
      `,
      { repository },
    );

    const relCount = await this.connection.read<{ cnt: number }>(
      `
      MATCH (s:Symbol {repository: $repository})-[r]-()
      RETURN count(r) AS cnt
      `,
      { repository },
    );

    const totalSymbols = kindRows.reduce((sum, r) => sum + r.count, 0);
    const symbolsByKind: Record<string, number> = {};
    const symbolsByLanguage: Record<string, number> = {};
    const languages: string[] = [];

    for (const row of kindRows) {
      symbolsByKind[row.kind] = row.count;
    }
    for (const row of langRows) {
      symbolsByLanguage[row.language] = row.count;
      if (row.language) languages.push(row.language);
    }

    return {
      repository,
      totalSymbols,
      totalRelationships: relCount[0]?.cnt ?? 0,
      symbolsByKind,
      symbolsByLanguage,
      languages,
    };
  }

  // ============================================================
  // ============================================================
  // Repository Metadata
  // ============================================================

  async upsertRepositoryMetadata(name: string, rootPath: string): Promise<void> {
    await this.connection.write(
      `
      MERGE (r:Repository {name: $name})
      SET r.rootPath = $rootPath, r.updatedAt = $updatedAt
      `,
      { name, rootPath, updatedAt: new Date().toISOString() },
    );
  }

  async listRepositories(): Promise<Array<{name: string, rootPath: string}>> {
    const results = await this.connection.read<{name: string, rootPath: string}>(
      `MATCH (r:Repository) RETURN r.name AS name, r.rootPath AS rootPath`,
    );
    return results.map((r: any) => ({ name: r.name, rootPath: r.rootPath }));
  }

  async findRepositoryByPath(rootPath: string): Promise<{name: string, rootPath: string} | null> {
    const results = await this.connection.read<{name: string, rootPath: string}>(
      `MATCH (r:Repository {rootPath: $rootPath}) RETURN r.name AS name, r.rootPath AS rootPath`,
      { rootPath },
    );
    return results.length > 0 ? { name: (results[0] as any).name, rootPath: (results[0] as any).rootPath } : null;
  }

  // ============================================================
  // Helpers
  // ============================================================

  /**
   * Generate Neo4j labels from symbol kind.
   * Every node gets :Symbol plus kind-specific labels.
   */
  private buildLabels(kind: string): string[] {
    const labels: string[] = [];
    // Capitalize first letter for Neo4j convention
    const label = kind.charAt(0).toUpperCase() + kind.slice(1);
    labels.push(label);
    return labels;
  }

  /**
   * Convert a Symbol domain object to a Neo4j properties map.
   */
  private symbolToProperties(symbol: Symbol): Record<string, unknown> {
    return {
      id: symbol.id,
      name: symbol.name,
      kind: symbol.kind,
      language: symbol.language,
      repository: symbol.location.repository,
      namespace: symbol.namespace,
      parentClass: symbol.parentClass,
      signature: symbol.signature ?? null,
      docComment: symbol.docComment ?? null,
      contentHash: symbol.contentHash,
      relativePath: symbol.location.relativePath,
      startLine: symbol.location.startLine,
      endLine: symbol.location.endLine,
      startColumn: symbol.location.startColumn,
      endColumn: symbol.location.endColumn,
      metadata: JSON.stringify(symbol.metadata ?? {}),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Convert a Neo4j result row to a GraphSymbol.
   */
  private rowToGraphSymbol(row: any): GraphSymbol {
    const s = row.s || row.source || row.caller || row.callee || row.impl || row.child || row.neighbor;
    if (!s) {
      throw new Error(`Cannot extract symbol from row: ${JSON.stringify(Object.keys(row))}`);
    }

    const props = s.properties ?? s;

    return {
      id: props.id,
      name: props.name,
      kind: props.kind,
      location: {
        repository: props.repository,
        relativePath: props.relativePath,
        startLine: props.startLine?.toNumber?.() ?? props.startLine ?? 1,
        endLine: props.endLine?.toNumber?.() ?? props.endLine ?? 1,
        startColumn: props.startColumn?.toNumber?.() ?? props.startColumn ?? 0,
        endColumn: props.endColumn?.toNumber?.() ?? props.endColumn ?? 0,
      },
      language: props.language,
      namespace: props.namespace ?? "",
      parentClass: props.parentClass ?? null,
      signature: props.signature ?? null,
      docComment: props.docComment ?? null,
      sourceSnippet: "",
      contentHash: props.contentHash ?? "",
      metadata: typeof props.metadata === "string"
        ? JSON.parse(props.metadata)
        : (props.metadata ?? {}),
      nodeId: row.nodeId?.toNumber?.() ?? row.nodeId ?? 0,
      labels: row.labels ?? [],
    };
  }
}

function dedupBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
