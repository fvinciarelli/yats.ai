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
   * Priority order (most deterministic first):
   * 1. Explicit receiver metadata from the bridge (receiverType / className /
   *    resolved signature) — match candidates by containing class.
   * 2. Module metadata (Python `Mod.func()`) — match by namespace.
   * 3. Class qualifier in the raw target (C# `Ns.Class.method`) — same match.
   * 4. Legacy name-based heuristic — only when unambiguous.
   *
   * Philosophy: an ambiguous match is NOT resolved at all (the edge is
   * dropped downstream by the endpoint filter). A wrong edge is worse than a
   * missing edge for agent queries.
   *
   * Returns the resolved targetSymbolId, or the original if unresolvable.
   */
  resolveCallTarget(
    targetId: string,
    sourceId: string,
    metadata: Record<string, unknown> = {},
  ): string {
    const calleeName = this.extractCalleeName(targetId);
    if (!calleeName) return targetId;

    // 1. Explicit receiver metadata from the bridge
    const explicitReceiver = this.receiverTypeFromMetadata(metadata);
    if (explicitReceiver) {
      const typed = this.typedCandidates(calleeName, explicitReceiver);
      if (typed.length === 1) return typed[0]!;
      if (typed.length > 1) {
        this.logger.debug(
          `Ambiguous receiver-typed CALLS target "${explicitReceiver}.${calleeName}": ` +
          `${typed.length} candidates — not rewriting`,
        );
      }
      // Explicit receiver with no match = call on an external type — keep
      // the raw target; the endpoint filter drops it. Do NOT fall through to
      // name-based guessing: an unrelated same-named method is a wrong edge.
      return targetId;
    }

    // 2. Module-qualified calls (Python `Mod.func()`)
    const moduleName = metadata["module"] as string | undefined;
    if (moduleName) {
      const matches = this.candidatesInModule(calleeName, moduleName);
      if (matches.length === 1) return matches[0]!;
      return targetId;
    }

    // 3. Class qualifier in the raw target ({Ns}.{Class}.{method} — C#)
    const pathReceiver = this.receiverTypeFromPath(targetId);
    if (pathReceiver) {
      const typed = this.typedCandidates(calleeName, pathReceiver);
      if (typed.length === 1) return typed[0]!;
      if (typed.length > 1) {
        this.logger.debug(
          `Ambiguous class-qualified CALLS target "${pathReceiver}.${calleeName}" — not rewriting`,
        );
        return targetId;
      }
      // 0 matches — fall through to name-based (the qualifier may be a
      // synthetic local-variable path, e.g. TypeScript `apiClient.start()`).
    }

    // 4. Legacy name-based heuristic — unambiguous cases only
    const sourceFile = this.extractFilePath(sourceId);
    const sourceNamespace = sourceFile ? this.pathToNamespace.get(sourceFile) : undefined;

    const candidates = this.byName.get(calleeName);
    if (!candidates || candidates.size === 0) {
      return targetId;
    }

    const externalCandidates = [...candidates].filter((cid) => {
      const entry = this.byId.get(cid);
      if (!entry) return false;
      return entry.relativePath !== sourceFile &&
        entry.namespace !== sourceNamespace;
    });

    if (externalCandidates.length === 1) {
      return externalCandidates[0]!;
    }

    if (externalCandidates.length === 0 && candidates.size === 1) {
      const only = [...candidates][0]!;
      if (only !== targetId) return only;
      return targetId;
    }

    if (externalCandidates.length > 1) {
      this.logger.debug(
        `Ambiguous CALLS target "${calleeName}": ${externalCandidates.length} candidates — not rewriting`,
      );
    }

    return targetId;
  }

  /** Receiver type from explicit bridge metadata (C#/Go receiverType, PHP className, Java resolved). */
  private receiverTypeFromMetadata(metadata: Record<string, unknown>): string | null {
    const rt = metadata["receiverType"] as string | undefined;
    if (rt) return rt;

    const className = metadata["className"] as string | undefined;
    if (className) {
      // PHP fully-qualified names: App\Services\OrderService → OrderService
      const simple = className.split("\\").pop();
      return simple && simple.length > 0 ? simple : null;
    }

    const resolved = metadata["resolved"] as string | undefined;
    if (resolved) {
      // Java qualified signature: com.acme.OrderRepository.FetchAll(...)
      const bare = resolved.split("(")[0]!;
      const parts = bare.split(".");
      if (parts.length >= 2) return parts[parts.length - 2]!;
    }

    return null;
  }

  /** Class qualifier embedded in the raw target: {Ns}.{Class}.{method}. */
  private receiverTypeFromPath(targetId: string): string | null {
    const symbolPath = this.extractSymbolPath(targetId);
    if (!symbolPath) return null;
    const parts = symbolPath.split(".");
    if (parts.length < 3) return null;
    return parts[parts.length - 2]!;
  }

  private typedCandidates(calleeName: string, receiverType: string): string[] {
    const candidates = this.byName.get(calleeName);
    if (!candidates || candidates.size === 0) return [];
    return [...candidates].filter((cid) => {
      const entry = this.byId.get(cid);
      if (!entry) return false;
      if (entry.parentClass === receiverType) return true;
      return (
        entry.namespace === receiverType ||
        entry.namespace.endsWith(`.${receiverType}`)
      );
    });
  }

  private candidatesInModule(calleeName: string, moduleName: string): string[] {
    const matches: string[] = [];
    for (const [ns, ids] of this.byNamespace) {
      // Python __init__.py files get namespace "...module.__init__" —
      // normalize so `Mod.func()` matches the package's __init__ too.
      const bare = ns.endsWith(".__init__")
        ? ns.slice(0, -".__init__".length)
        : ns;
      if (bare !== moduleName && !bare.endsWith(`.${moduleName}`)) continue;
      for (const cid of ids) {
        const entry = this.byId.get(cid);
        if (entry && entry.name === calleeName) matches.push(cid);
      }
    }
    return matches;
  }

  private extractCalleeName(targetId: string): string | null {
    const lastColon = targetId.lastIndexOf("::");
    if (lastColon === -1) return null;
    const symbolPath = targetId.slice(lastColon + 2);
    const dotIdx = symbolPath.lastIndexOf(".");
    return dotIdx !== -1 ? symbolPath.slice(dotIdx + 1) : symbolPath;
  }

  private extractSymbolPath(targetId: string): string | null {
    const lastColon = targetId.lastIndexOf("::");
    if (lastColon === -1) return null;
    return targetId.slice(lastColon + 2);
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
  /** Containing class (Java/PHP members), when known. */
  parentClass?: string;
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
      newTargetId = table.resolveCallTarget(
        rel.targetSymbolId,
        rel.sourceSymbolId,
        rel.metadata,
      );
    } else if (rel.kind === ("IMPORTS" as RelationshipKind)) {
      newTargetId = table.resolveImportTarget(
        rel.targetSymbolId,
        rel.sourceSymbolId,
        rel.metadata,
      );
    } else if (
      rel.kind === ("IMPLEMENTS" as RelationshipKind) ||
      rel.kind === ("INHERITS" as RelationshipKind)
    ) {
      newTargetId = table.resolveCallTarget(
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
