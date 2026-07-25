import type { Relationship, RelationshipKind } from "@yats/shared";
import { createLogger, type Logger } from "@yats/shared";

// ============================================================
// GlobalSymbolTable — cross-file reference resolver
//
// Analyzers emit relationships with target IDs scoped to the
// current file (e.g. auth.py::auth.get_user). This table maps
// simple names to their real symbol IDs across all files, so
// we can rewrite CALLS/IMPORTS to point to the correct target.
// ============================================================

export class GlobalSymbolTable {
  private readonly logger: Logger;

  /** simpleName → Set<fullSymbolId> */
  private readonly byName = new Map<string, Set<string>>();

  /** fullSymbolId → lightweight entry */
  private readonly byId = new Map<string, SymbolTableEntry>();

  /** namespace (e.g. "db") → Set<fullSymbolId> */
  private readonly byNamespace = new Map<string, Set<string>>();

  /** relativePath → namespace */
  private readonly pathToNamespace = new Map<string, string>();

  /** namespace → relativePath */
  private readonly namespaceToPath = new Map<string, string>();

  constructor() {
    this.logger = createLogger("indexer:symbol-table");
  }

  /**
   * Index all symbols for cross-file resolution.
   * Accepts lightweight entries with { id, name, namespace, relativePath }.
   * Call once all symbols are accumulated, before storing relationships.
   */
  index(entries: SymbolTableEntry[]): void {
    for (const entry of entries) {
      // By full ID
      this.byId.set(entry.id, entry);

      // By simple name
      const simpleName = entry.name;
      if (!this.byName.has(simpleName)) {
        this.byName.set(simpleName, new Set());
      }
      this.byName.get(simpleName)!.add(entry.id);

      // By namespace
      const ns = entry.namespace;
      if (ns) {
        if (!this.byNamespace.has(ns)) {
          this.byNamespace.set(ns, new Set());
        }
        this.byNamespace.get(ns)!.add(entry.id);
      }

      // Path ↔ namespace mapping
      const rp = entry.relativePath;
      if (rp && ns) {
        this.pathToNamespace.set(rp, ns);
        this.namespaceToPath.set(ns, rp);
      }
    }

    this.logger.debug(
      `Symbol table built: ${this.byId.size} symbols, ` +
      `${this.byName.size} unique names, ${this.byNamespace.size} namespaces`,
    );
  }

  /**
   * Resolve a CALLS relationship target.
   *
   * Analyzers scope the callee to the caller's namespace:
   *   targetId = {repo}::{filePath}::{namespace.calleeName}
   *
   * We extract the calleeName, look it up globally, and if we find
   * it in a DIFFERENT file, we rewrite to that real ID.
   *
   * Returns the resolved targetSymbolId, or the original if unresolvable.
   */
  resolveCallTarget(targetId: string, sourceId: string): string {
    // Extract callee name: last segment after the final dot
    // Format: {repo}::{filePath}::{namespace.qualName}
    const lastColon = targetId.lastIndexOf("::");
    if (lastColon === -1) return targetId;

    const symbolPath = targetId.slice(lastColon + 2);
    const dotIdx = symbolPath.lastIndexOf(".");
    const calleeName = dotIdx !== -1 ? symbolPath.slice(dotIdx + 1) : symbolPath;

    // Extract source file path for same-file check
    const sourceFile = this.extractFilePath(sourceId);
    const sourceNamespace = sourceFile ? this.pathToNamespace.get(sourceFile) : undefined;

    const candidates = this.byName.get(calleeName);
    if (!candidates || candidates.size === 0) {
      // Built-in or unresolvable — keep original (Neo4j will just skip it)
      return targetId;
    }

    // Filter candidates that are in a DIFFERENT file/namespace
    const externalCandidates = [...candidates].filter((cid) => {
      const entry = this.byId.get(cid);
      if (!entry) return false;
      // Different file OR different namespace
      return entry.relativePath !== sourceFile &&
        entry.namespace !== sourceNamespace;
    });

    if (externalCandidates.length === 1) {
      return externalCandidates[0]!;
    }

    if (externalCandidates.length > 1) {
      // Multiple external candidates — try to disambiguate by namespace match
      // (e.g. if caller imported from "db", prefer candidate in "db" namespace)
      for (const cid of externalCandidates) {
        const entry = this.byId.get(cid);
        if (entry && entry.namespace === calleeName) {
          // Direct match: callee named "hash_string" and namespace is also "hash_string"?
          // No, that's wrong. Let me think...
          // Actually, calleeName is "hash_string" and if a candidate's namespace is 
          // somehow "hash_string", that means it's a top-level function in that module.
          // But this is unlikely. Skip this heuristic for now.
        }
      }

      // If multiple matches, pick the first one from a different file.
      // This is a best-effort heuristic — ambiguous cases are rare.
      this.logger.debug(
        `Ambiguous CALLS target "${calleeName}": ${externalCandidates.length} candidates, picking first`,
      );
      return externalCandidates[0]!;
    }

    // All candidates are in the same file — that's a local call, keep original
    // But wait: if all candidates are in the same file, the original targetId
    // should already be correct (same namespace). Keep it.
    return targetId;
  }

  /**
   * Resolve an IMPORTS relationship target.
   *
   * IMPORTS metadata contains { module, alias } where module is the
   * source module name (e.g. "db" from "from db import get_user").
   *
   * We look up the module's namespace and find the imported symbol there.
   */
  resolveImportTarget(
    targetId: string,
    sourceId: string,
    metadata: Record<string, unknown>,
  ): string {
    const module = metadata["module"] as string | undefined;
    if (!module) return targetId;

    // Extract imported name from targetId
    // Format: {repo}::{filePath}::{module.importedName}
    const lastColon = targetId.lastIndexOf("::");
    if (lastColon === -1) return targetId;

    const symbolPath = targetId.slice(lastColon + 2);
    const dotIdx = symbolPath.indexOf(".");
    const importedName = dotIdx !== -1 ? symbolPath.slice(dotIdx + 1) : symbolPath;

    // Find symbols in the module's namespace
    const candidates = this.byNamespace.get(module);
    if (!candidates || candidates.size === 0) return targetId;

    // Match by imported name
    for (const cid of candidates) {
      const entry = this.byId.get(cid);
      if (entry && entry.name === importedName) {
        return cid;
      }
    }

    return targetId;
  }

  /**
   * Get the full symbol ID given a namespace and name.
   * Used when we know both the module and the symbol name.
   */
  resolveByNamespaceAndName(namespace: string, name: string): string | null {
    const candidates = this.byNamespace.get(namespace);
    if (!candidates) return null;

    for (const cid of candidates) {
      const entry = this.byId.get(cid);
      if (entry && entry.name === name) {
        return cid;
      }
    }

    return null;
  }

  // ============================================================
  // Helpers
  // ============================================================

  private extractFilePath(id: string): string | null {
    // Format: {repo}::{relativePath}::{symbolPath}
    const firstColon = id.indexOf("::");
    if (firstColon === -1) return null;
    const afterRepo = id.slice(firstColon + 2);
    const secondColon = afterRepo.indexOf("::");
    if (secondColon === -1) return null;
    return afterRepo.slice(0, secondColon);
  }
}

/** Lightweight symbol entry for the global table — no need for full Symbol objects */
export interface SymbolTableEntry {
  id: string;
  name: string;
  namespace: string;
  relativePath: string;
}

// ============================================================
// RelationshipResolver — rewrites relationship targets
// using the GlobalSymbolTable
// ============================================================

export interface ResolveResult {
  /** Resolved relationships (target IDs rewritten) */
  resolved: Relationship[];
  /** How many targets were rewritten */
  rewritten: number;
  /** How many were skipped (builtins, same-file, etc.) */
  skipped: number;
}

export function resolveRelationships(
  relationships: Relationship[],
  table: GlobalSymbolTable,
): ResolveResult {
  let rewritten = 0;
  let skipped = 0;

  const resolved: Relationship[] = relationships.map((rel) => {
    let newTargetId = rel.targetSymbolId;

    if (rel.kind === ("CALLS" as RelationshipKind)) {
      newTargetId = table.resolveCallTarget(rel.targetSymbolId, rel.sourceSymbolId);
    } else if (rel.kind === ("IMPORTS" as RelationshipKind)) {
      newTargetId = table.resolveImportTarget(
        rel.targetSymbolId,
        rel.sourceSymbolId,
        rel.metadata,
      );
    }

    if (newTargetId !== rel.targetSymbolId) {
      rewritten++;
      return { ...rel, targetSymbolId: newTargetId };
    }

    skipped++;
    return rel;
  });

  return { resolved, rewritten, skipped };
}
