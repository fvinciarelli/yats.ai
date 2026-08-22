import { createLogger, type Logger } from "@yats/shared";
import type { GraphRepository, VectorRepository, EmbeddingGenerator, FileSystem, Retriever, Indexer } from "@yats/shared";
import { Language, SymbolKind, RelationshipKind, CollectionName } from "@yats/shared";
import type { RankedContextItem, RetrievalQuery } from "@yats/shared";
import * as path from "node:path";

// ============================================================
// MCP Tool Handler Types
// ============================================================

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

export interface McpDependencies {
  retriever: Retriever;
  graphRepository: GraphRepository;
  vectorRepository: VectorRepository;
  embeddings: EmbeddingGenerator;
  fileSystem: FileSystem;
  indexer: Indexer;
  repositoriesRoot: string;
}

// ============================================================
// Tool Definitions — all 23 MCP tools
// ============================================================

export function getAllToolDefinitions(): ToolDefinition[] {
  return [
    SEARCH_CODE,
    SEARCH_DOCUMENTATION,
    FIND_SYMBOL,
    FIND_REFERENCES,
    FIND_CALLERS,
    FIND_CALLEES,
    FIND_IMPLEMENTATIONS,
    FIND_INHERITORS,
    FIND_TESTS,
    FIND_ROUTES,
    FIND_CONFIGURATION,
    EXPAND_GRAPH,
    RELATED_SYMBOLS,
    LIST_SYMBOLS,
    REPOSITORY_SUMMARY,
    ARCHITECTURE_SUMMARY,
    SEARCH_SIMILAR,
    LIST_REPOSITORIES,
    DELETE_REPOSITORY,
    REBUILD_VECTORS,
  ];
}

const SEARCH_CODE: ToolDefinition = {
  name: "search_code",
  description: "Search indexed code using natural language. Finds relevant symbols, functions, and classes. If the repo isn't indexed yet, you'll get the exact command to index it from the host (yats index).",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Natural language query describing what you're looking for" },
      path: { type: "string", description: "Root path of the repository (from list_repositories or your current working directory)" },
      repository: { type: "string", description: "Repository name (alternative to path)" },
      language: { type: "string", enum: Object.values(Language) },
      kind: { type: "string", enum: Object.values(SymbolKind) },
      limit: { type: "number", default: 10, maximum: 50 },
      includeTests: { type: "boolean", default: false },
    },
    required: ["query"],
  },
};

const SEARCH_DOCUMENTATION: ToolDefinition = {
  name: "search_documentation",
  description: "Search documentation files (README, architecture docs, ADRs) indexed for a repository.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      path: { type: "string", description: "Root path of the repository" },
      repository: { type: "string", description: "Repository name (alternative to path)" },
      limit: { type: "number", default: 10 },
    },
    required: ["query"],
  },
};

const FIND_SYMBOL: ToolDefinition = {
  name: "find_symbol",
  description: "Find a specific symbol by exact or fuzzy name match.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      repository: { type: "string" },
      kind: { type: "string", enum: Object.values(SymbolKind) },
      exact: { type: "boolean", default: false },
      limit: { type: "number", default: 10 },
    },
    required: ["name"],
  },
};

const FIND_REFERENCES: ToolDefinition = {
  name: "find_references",
  description: "Find all symbols that reference the given symbol. Provide either symbolId or name+repository.",
  inputSchema: {
    type: "object",
    properties: {
      symbolId: { type: "string" },
      name: { type: "string" },
      repository: { type: "string" },
      limit: { type: "number", default: 20 },
    },
    required: ["repository"],
  },
};

const FIND_CALLERS: ToolDefinition = {
  name: "find_callers",
  description: "Find all functions/methods that call the given function/method. Provide either symbolId or name+repository.",
  inputSchema: {
    type: "object",
    properties: {
      symbolId: { type: "string" },
      name: { type: "string" },
      repository: { type: "string" },
      limit: { type: "number", default: 20 },
    },
    required: ["repository"],
  },
};

const FIND_CALLEES: ToolDefinition = {
  name: "find_callees",
  description: "Find all functions/methods called by the given function/method. Provide either symbolId or name+repository.",
  inputSchema: {
    type: "object",
    properties: {
      symbolId: { type: "string" },
      name: { type: "string" },
      repository: { type: "string" },
      limit: { type: "number", default: 20 },
    },
    required: ["repository"],
  },
};

const FIND_IMPLEMENTATIONS: ToolDefinition = {
  name: "find_implementations",
  description: "Find all implementations of an interface or abstract class/method. Provide either symbolId or name+repository.",
  inputSchema: {
    type: "object",
    properties: {
      symbolId: { type: "string" },
      name: { type: "string" },
      repository: { type: "string" },
      limit: { type: "number", default: 20 },
    },
    required: ["repository"],
  },
};

const FIND_INHERITORS: ToolDefinition = {
  name: "find_inheritors",
  description: "Find all subclasses/types that inherit from the given class. Provide either symbolId or name+repository.",
  inputSchema: {
    type: "object",
    properties: {
      symbolId: { type: "string" },
      name: { type: "string" },
      repository: { type: "string" },
      limit: { type: "number", default: 20 },
    },
    required: ["repository"],
  },
};

const FIND_TESTS: ToolDefinition = {
  name: "find_tests",
  description: "Find tests related to the given symbol. Provide either symbolId or name+repository.",
  inputSchema: {
    type: "object",
    properties: {
      symbolId: { type: "string" },
      name: { type: "string" },
      repository: { type: "string" },
      limit: { type: "number", default: 20 },
    },
    required: ["repository"],
  },
};

const FIND_ROUTES: ToolDefinition = {
  name: "find_routes",
  description: "Find HTTP routes / API endpoints in the repository.",
  inputSchema: {
    type: "object",
    properties: {
      repository: { type: "string" },
      method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
      path: { type: "string", description: "Partial path match" },
      limit: { type: "number", default: 30 },
    },
    required: ["repository"],
  },
};

const FIND_CONFIGURATION: ToolDefinition = {
  name: "find_configuration",
  description: "Find configuration settings, environment variables, and config files.",
  inputSchema: {
    type: "object",
    properties: {
      repository: { type: "string" },
      key: { type: "string", description: "Config key to search for (e.g., DATABASE_URL)" },
      limit: { type: "number", default: 20 },
    },
    required: ["repository"],
  },
};

const EXPAND_GRAPH: ToolDefinition = {
  name: "expand_graph",
  description: "Expand from symbol IDs through the graph to find connected symbols.",
  inputSchema: {
    type: "object",
    properties: {
      symbolIds: { type: "array", items: { type: "string" } },
      repository: { type: "string" },
      hops: { type: "number", default: 1, minimum: 1, maximum: 3 },
      relationshipTypes: {
        type: "array",
        items: { type: "string", enum: Object.values(RelationshipKind) },
      },
      limit: { type: "number", default: 30 },
    },
    required: ["symbolIds"],
  },
};

const RELATED_SYMBOLS: ToolDefinition = {
  name: "related_symbols",
  description: "Find symbols directly related to the given symbol (1-hop neighbors). Provide either symbolId or name+repository.",
  inputSchema: {
    type: "object",
    properties: {
      symbolId: { type: "string" },
      name: { type: "string" },
      repository: { type: "string" },
      limit: { type: "number", default: 30 },
    },
    required: [],
  },
};

const LIST_SYMBOLS: ToolDefinition = {
  name: "list_symbols",
  description: "List symbols in a repository, optionally filtered by kind.",
  inputSchema: {
    type: "object",
    properties: {
      repository: { type: "string" },
      kind: { type: "string", enum: Object.values(SymbolKind) },
      limit: { type: "number", default: 50 },
      offset: { type: "number", default: 0 },
    },
    required: ["repository"],
  },
};

const REPOSITORY_SUMMARY: ToolDefinition = {
  name: "repository_summary",
  description: "Get a high-level summary: symbol counts by kind and language.",
  inputSchema: {
    type: "object",
    properties: {
      repository: { type: "string" },
    },
    required: ["repository"],
  },
};

const ARCHITECTURE_SUMMARY: ToolDefinition = {
  name: "architecture_summary",
  description: "Get an architectural overview: key services, controllers, DTOs, and their relationships.",
  inputSchema: {
    type: "object",
    properties: {
      repository: { type: "string" },
    },
    required: ["repository"],
  },
};

const SEARCH_SIMILAR: ToolDefinition = {
  name: "search_similar",
  description: "Find code semantically similar to a given symbol.",
  inputSchema: {
    type: "object",
    properties: {
      symbolId: { type: "string" },
      repository: { type: "string" },
      limit: { type: "number", default: 10 },
    },
    required: ["symbolId", "repository"],
  },
};

const READ_FILE: ToolDefinition = {
  name: "read_file",
  description: "Read a file from the repository.",
  inputSchema: {
    type: "object",
    properties: {
      repository: { type: "string" },
      path: { type: "string", description: "Relative path within the repository" },
      startLine: { type: "number" },
      endLine: { type: "number" },
    },
    required: ["repository", "path"],
  },
};

const WRITE_FILE: ToolDefinition = {
  name: "write_file",
  description: "Write content to a file. Creates if it doesn't exist, overwrites if it does.",
  inputSchema: {
    type: "object",
    properties: {
      repository: { type: "string" },
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["repository", "path", "content"],
  },
};

const UPDATE_FILE: ToolDefinition = {
  name: "update_file",
  description: "Update a file with one or more precise text replacements.",
  inputSchema: {
    type: "object",
    properties: {
      repository: { type: "string" },
      path: { type: "string" },
      edits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            oldText: { type: "string" },
            newText: { type: "string" },
          },
          required: ["oldText", "newText"],
        },
      },
    },
    required: ["repository", "path", "edits"],
  },
};

const DELETE_FILE: ToolDefinition = {
  name: "delete_file",
  description: "Delete a file from the repository.",
  inputSchema: {
    type: "object",
    properties: {
      repository: { type: "string" },
      path: { type: "string" },
    },
    required: ["repository", "path"],
  },
};

const CREATE_FILE: ToolDefinition = {
  name: "create_file",
  description: "Create a new file. Fails if it already exists.",
  inputSchema: {
    type: "object",
    properties: {
      repository: { type: "string" },
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["repository", "path", "content"],
  },
};

const LIST_REPOSITORIES: ToolDefinition = {
  name: "list_repositories",
  description: "List all indexed repositories with their root paths. Call this when you start working in a directory to discover which repos are available for code search.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
};

const DELETE_REPOSITORY: ToolDefinition = {
  name: "delete_repository",
  description: "Delete an indexed repository from YATS (removes all symbols, relationships, and vectors). CAUTION: this is irreversible. The source code files are NOT deleted — only the indexed data.",
  inputSchema: {
    type: "object",
    properties: {
      repository: { type: "string", description: "Exact name of the repository to delete (from list_repositories)" },
      path: { type: "string", description: "Alternatively, resolve the repository by its path. If it matches an indexed repo, it will be deleted." },
      confirm: { type: "boolean", description: "REQUIRED: set to true to confirm deletion. The first call without this returns a warning asking for confirmation." },
    },
    required: [],
  },
};

const REBUILD_VECTORS: ToolDefinition = {
  name: "rebuild_vectors",
  description: "Rebuild the vector index after the embedding model/dimension changed. Re-embeds all symbols and may incur API costs — always ask the user before proceeding.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
};

// ============================================================
// Helpers
// ============================================================

/** Resolve a path or repository name to a repository name.
 * Returns null with a helpful message if not found. */
async function resolveRepo(
  pathOrRepo: string | undefined,
  fallbackRepo: string | undefined,
  graphRepo: GraphRepository,
): Promise<{name: string; rootPath: string} | null> {
  if (pathOrRepo) {
    const repo = await graphRepo.findRepositoryByPath(pathOrRepo);
    if (repo) return { name: repo.name, rootPath: repo.rootPath };
    return null;
  }
  if (fallbackRepo) {
    // Look up rootPath from stored repos
    const repos = await graphRepo.listRepositories();
    const found = repos.find(r => r.name === fallbackRepo);
    if (found) return { name: found.name, rootPath: found.rootPath };
    return null;
  }
  return null;
}

/**
 * Resolve a repo and auto-index if it hasn't been indexed yet.
 * This is the main entry point for all search/query tools — it ensures
 * the repo is indexed before the tool does its work.
 */
async function ensureRepoIndexed(
  args: Record<string, unknown>,
  deps: McpDependencies,
): Promise<{ name: string; rootPath: string } | ToolResult> {
  const repoPath = args.path as string | undefined;
  const repoName = args.repository as string | undefined;

  // Try to resolve from already-indexed repos
  const repo = await resolveRepo(repoPath, repoName, deps.graphRepository);
  if (repo) {
    return repo;
  }

  // Not indexed — the YATS server never walks the host filesystem (it may run
  // in a container without access to host paths). Indexing happens exclusively
  // through the thin host CLI, which streams files over HTTP.
  if (repoPath) {
    return notIndexed(repoPath);
  }
  return notIndexed(repoName as string);
}

/** Return a helpful "not indexed" message with the exact command to run on the host */
function notIndexed(hint?: string): ToolResult {
  const name = hint || "this repository";
  const repoArg = name.startsWith("/") ? name : `"${name}"`;
  const cmd = `yats index ${repoArg}`;
  return {
    content: [{
      type: "text",
      text: `Repository "${name}" is not indexed yet.\n\nRun this command in a terminal on the host machine (I can run it for you):\n\n  ${cmd}\n\nThen poll with:\n\n  repository_summary(repository: "${name.split("/").pop() ?? name}")\n\nuntil 'relationships' stops increasing between two consecutive checks.`, 
    }],
  };
}

// ============================================================
// Indexing-in-progress notice
// ============================================================

/** Human/agent-readable notice shown while a repository is mid-indexing. */
function indexingNoticeText(repository: string, pending: number): string {
  return (
    `⏳ Repository "${repository}" is currently being indexed ` +
    `(${pending} relationships pending resolution). ` +
    `The relationship graph is only complete once indexing finishes. ` +
    `Wait a few seconds, then query repository_summary again.`
  );
}

/**
 * Prepend the indexing notice to a tool result when the repository is
 * mid-indexing. Never throws — status errors must not block queries.
 */
async function withIndexingNotice(
  repository: string,
  deps: McpDependencies,
  text: string,
): Promise<string> {
  if (!repository) return text;
  try {
    const status = await deps.indexer.getIndexingStatus(repository);
    if (!status.indexing) return text;
    return `${indexingNoticeText(repository, status.pendingRelationships)}\n\n${text}`;
  } catch {
    return text;
  }
}

/** Extract the repository name from a symbol ID ({repo}::{path}::{symbolPath}). */
function repoFromSymbolId(symbolId: string): string {
  return symbolId.split("::")[0] ?? "";
}

// ============================================================
// Resolve symbol ID from name
// ============================================================

async function resolveSymbolId(
  args: Record<string, unknown>,
  deps: McpDependencies,
): Promise<string | ToolResult> {
  // If symbolId is directly provided, use it
  const symbolId = args.symbolId as string | undefined;
  if (symbolId) return symbolId;

  // Otherwise, resolve from name + repository
  const name = args.name as string | undefined;
  const repoName = args.repository as string | undefined;

  if (!name || !repoName) {
    return {
      content: [{ type: "text", text: "Either 'symbolId' or both 'name' and 'repository' are required." }],
      isError: true,
    };
  }

  const symbols = await deps.graphRepository.findSymbolByName(repoName, name);
  if (symbols.length === 0) {
    return {
      content: [{ type: "text", text: `Symbol "${name}" not found in repository "${repoName}".` }],
      isError: true,
    };
  }

  // Prefer exact name match (findSymbolByName uses CONTAINS, so "Greeter"
  // might return "SpanishGreeter" before "Greeter")
  const exactMatch = symbols.find((s) => s.name === name);
  return (exactMatch ?? symbols[0]!).id;
}

// ============================================================
// Tool Handler Factory
// ============================================================

function vectorIndexMismatchMessage(): string {
  return [
    "The vector index dimension does not match the current embedding model — semantic search is degraded.",
    "",
    "This happens when the embedding provider/model changed since the last index.",
    "",
    "To fix it, the vector index must be rebuilt. This re-embeds every indexed symbol via the current",
    "embedding provider and MAY INCUR API COSTS.",
    "",
    "Tell the user the impact and ask for explicit confirmation. If they confirm, run:",
    "  yats reindex --rebuild-vectors",
    "",
    "Graph-only tools (find_symbol, find_callers, find_references, etc.) still work without the vector index.",
  ].join("\n");
}

export function createToolHandlers(deps: McpDependencies): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  const logger = createLogger("mcp:tools");

  handlers.set("search_code", async (args) => {
    if (deps.vectorRepository.dimensionMismatch) {
      return { content: [{ type: "text", text: vectorIndexMismatchMessage() }], isError: true };
    }
    const resolved = await ensureRepoIndexed(args, deps);
    if ("content" in resolved) return resolved;

    const query: RetrievalQuery = {
      query: args.query as string,
      repository: resolved.name,
      options: {
        maxVectorHits: 20,
        maxTotalResults: (args.limit as number) ?? 10,
        includeTests: (args.includeTests as boolean) ?? false,
      },
    };
    const result = await deps.retriever.retrieve(query);
    return {
      content: [{ type: "text", text: JSON.stringify(formatContextItems(result.context), null, 2) }],
    };
  });

  handlers.set("search_documentation", async (args) => {
    if (deps.vectorRepository.dimensionMismatch) {
      return { content: [{ type: "text", text: vectorIndexMismatchMessage() }], isError: true };
    }
    const resolved = await ensureRepoIndexed(args, deps);
    if ("content" in resolved) return resolved;

    const result = await deps.embeddings.embed(args.query as string);
    const hits = await deps.vectorRepository.search(CollectionName.DOCUMENTATION, result, {
      limit: (args.limit as number) ?? 10,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(hits.filter(h => h.payload.repository === resolved.name), null, 2) }],
    };
  });

  handlers.set("find_symbol", async (args) => {
    const resolved = await ensureRepoIndexed(args, deps);
    if ("content" in resolved) return resolved;

    const symbols = await deps.graphRepository.findSymbolByName(
      resolved.name,
      args.name as string,
      args.kind as SymbolKind | undefined,
    );
    return {
      content: [{ type: "text", text: JSON.stringify(formatSymbols(symbols), null, 2) }],
    };
  });

  handlers.set("find_references", async (args) => {
    const sid = await resolveSymbolId(args, deps);
    if (typeof sid !== "string") return sid;
    const refs = await deps.graphRepository.findReferences(sid, (args.limit as number) ?? 20);
    return { content: [{ type: "text", text: await withIndexingNotice(repoFromSymbolId(sid), deps, JSON.stringify(formatSymbols(refs), null, 2)) }] };
  });

  handlers.set("find_callers", async (args) => {
    const sid = await resolveSymbolId(args, deps);
    if (typeof sid !== "string") return sid;
    const callers = await deps.graphRepository.findCallers(sid, (args.limit as number) ?? 20);
    return { content: [{ type: "text", text: await withIndexingNotice(repoFromSymbolId(sid), deps, JSON.stringify(formatSymbols(callers), null, 2)) }] };
  });

  handlers.set("find_callees", async (args) => {
    const sid = await resolveSymbolId(args, deps);
    if (typeof sid !== "string") return sid;
    const callees = await deps.graphRepository.findCallees(sid, (args.limit as number) ?? 20);
    return { content: [{ type: "text", text: await withIndexingNotice(repoFromSymbolId(sid), deps, JSON.stringify(formatSymbols(callees), null, 2)) }] };
  });

  handlers.set("find_implementations", async (args) => {
    const sid = await resolveSymbolId(args, deps);
    if (typeof sid !== "string") return sid;
    const impls = await deps.graphRepository.findImplementations(sid, (args.limit as number) ?? 20);
    return { content: [{ type: "text", text: await withIndexingNotice(repoFromSymbolId(sid), deps, JSON.stringify(formatSymbols(impls), null, 2)) }] };
  });

  handlers.set("find_inheritors", async (args) => {
    const sid = await resolveSymbolId(args, deps);
    if (typeof sid !== "string") return sid;
    const inheritors = await deps.graphRepository.findInheritors(sid, (args.limit as number) ?? 20);
    return { content: [{ type: "text", text: await withIndexingNotice(repoFromSymbolId(sid), deps, JSON.stringify(formatSymbols(inheritors), null, 2)) }] };
  });

  handlers.set("find_tests", async (args) => {
    const sid = await resolveSymbolId(args, deps);
    if (typeof sid !== "string") return sid;
    const tests = await deps.graphRepository.findTests(sid, (args.limit as number) ?? 20);
    return { content: [{ type: "text", text: await withIndexingNotice(repoFromSymbolId(sid), deps, JSON.stringify(formatSymbols(tests), null, 2)) }] };
  });

  handlers.set("find_routes", async (args) => {
    const resolved = await ensureRepoIndexed(args, deps);
    if ("content" in resolved) return resolved;

    const routes = await deps.graphRepository.findRoutes(resolved.name);
    return { content: [{ type: "text", text: JSON.stringify(formatSymbols(routes), null, 2) }] };
  });

  handlers.set("find_configuration", async (args) => {
    const resolved = await ensureRepoIndexed(args, deps);
    if ("content" in resolved) return resolved;

    const configs = await deps.graphRepository.findConfiguration(
      resolved.name,
      args.key as string | undefined,
    );
    return { content: [{ type: "text", text: JSON.stringify(formatSymbols(configs), null, 2) }] };
  });

  handlers.set("expand_graph", async (args) => {
    const subgraph = await deps.graphRepository.expandGraph(
      args.symbolIds as string[],
      (args.hops as number) ?? 1,
      (args.relationshipTypes as RelationshipKind[]) ?? [],
    );
    const resultText = JSON.stringify({
      nodeCount: subgraph.nodes.length,
      relationshipCount: subgraph.relationships.length,
      nodes: formatSymbols(subgraph.nodes),
      relationships: subgraph.relationships.map((rel) => ({
        sourceId: rel.sourceSymbolId,
        targetId: rel.targetSymbolId,
        kind: rel.kind,
      })),
    }, null, 2);
    return {
      content: [{
        type: "text",
        text: await withIndexingNotice(
          repoFromSymbolId((args.symbolIds as string[])[0] ?? ""),
          deps,
          resultText,
        ),
      }],
    };
  });

  handlers.set("related_symbols", async (args) => {
    const sid = await resolveSymbolId(args, deps);
    if (typeof sid !== "string") return sid;
    const related = await deps.graphRepository.relatedSymbols(sid, (args.limit as number) ?? 30);
    return { content: [{ type: "text", text: await withIndexingNotice(repoFromSymbolId(sid), deps, JSON.stringify(formatSymbols(related), null, 2)) }] };
  });

  handlers.set("list_symbols", async (args) => {
    const resolved = await ensureRepoIndexed(args, deps);
    if ("content" in resolved) return resolved;

    const symbols = await deps.graphRepository.listSymbols(
      resolved.name,
      args.kind as SymbolKind | undefined,
      (args.limit as number) ?? 50,
      (args.offset as number) ?? 0,
    );
    return { content: [{ type: "text", text: JSON.stringify(formatSymbols(symbols), null, 2) }] };
  });

  handlers.set("repository_summary", async (args) => {
    const resolved = await ensureRepoIndexed(args, deps);
    if ("content" in resolved) return resolved;

    const summary: any = await deps.graphRepository.repositorySummary(resolved.name);
    try {
      const status = await deps.indexer.getIndexingStatus(resolved.name);
      if (status.indexing) {
        summary.indexing = true;
        summary.pendingRelationships = status.pendingRelationships;
        summary.notice = indexingNoticeText(resolved.name, status.pendingRelationships);
      }
    } catch { /* never block queries on status errors */ }
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  });

  handlers.set("architecture_summary", async (args) => {
    const resolved = await ensureRepoIndexed(args, deps);
    if ("content" in resolved) return resolved;

    const controllers = await deps.graphRepository.listSymbols(
      resolved.name, SymbolKind.CONTROLLER, 20, 0,
    );
    const services = await deps.graphRepository.listSymbols(
      resolved.name, SymbolKind.SERVICE, 20, 0,
    );
    const entities = await deps.graphRepository.listSymbols(
      resolved.name, SymbolKind.ENTITY, 20, 0,
    );
    const routes = await deps.graphRepository.findRoutes(resolved.name);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          controllers: formatSymbols(controllers),
          services: formatSymbols(services),
          entities: formatSymbols(entities),
          routes: formatSymbols(routes),
        }, null, 2),
      }],
    };
  });

  handlers.set("search_similar", async (args) => {
    if (deps.vectorRepository.dimensionMismatch) {
      return { content: [{ type: "text", text: vectorIndexMismatchMessage() }], isError: true };
    }
    const symbol = await deps.graphRepository.findSymbol(args.symbolId as string);
    if (!symbol) {
      return { content: [{ type: "text", text: "Symbol not found" }], isError: true };
    }

    const vector = await deps.embeddings.embed(symbol.name);
    const hits = await deps.vectorRepository.search(CollectionName.CODE, vector, {
      limit: (args.limit as number) ?? 10,
    });

    const results = [];
    for (const hit of hits) {
      if (hit.payload.symbolId) {
        const sym = await deps.graphRepository.findSymbol(hit.payload.symbolId);
        if (sym) results.push({ ...formatSymbol(sym), score: hit.score });
      }
    }

    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  });

  // Repository management
  handlers.set("list_repositories", async () => {
    const repos = await deps.graphRepository.listRepositories();
    return { content: [{ type: "text", text: JSON.stringify(repos, null, 2) }] };
  });

  handlers.set("delete_repository", async (args) => {
    const repoName = (args.repository as string) || undefined;
    const repoPath = (args.path as string) || undefined;
    const confirm = args.confirm === true;

    // Resolve repository name
    let targetName: string | null = null;
    if (repoName) {
      const repos = await deps.graphRepository.listRepositories();
      const found = repos.find(r => r.name === repoName);
      if (found) targetName = found.name;
    } else if (repoPath) {
      const repo = await deps.graphRepository.findRepositoryByPath(repoPath);
      if (repo) targetName = repo.name;
    }

    if (!targetName) {
      const hint = repoName || repoPath || "(nothing provided)";
      return {
        content: [{ type: "text", text: `Repository "${hint}" not found in indexed repos. Use list_repositories to see available repos.` }],
        isError: true,
      };
    }

    // Get summary for the confirmation message
    let summary = "";
    try {
      const s = await deps.graphRepository.repositorySummary(targetName);
      summary = ` (${s.totalSymbols} symbols, ${s.totalRelationships} relationships)`;
    } catch { /* ignore */ }

    if (!confirm) {
      return {
        content: [{
          type: "text",
          text: `⚠️  About to delete "${targetName}"${summary}.\n\nThis will permanently remove all indexed data (symbols, relationships, vectors). The source code files will NOT be affected.\n\nAsk the user for confirmation, then call delete_repository again with confirm: true.`,
        }],
      };
    }

    // Confirmed — delete
    try {
      await deps.graphRepository.clearRepository(targetName);
      await deps.vectorRepository.clearVectorsByRepository(targetName);
      // Also remove the Repository node itself
      await deps.graphRepository.deleteRepositoryNode(targetName);
      return {
        content: [{ type: "text", text: `✅ Repository "${targetName}" deleted successfully${summary}.` }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `❌ Failed to delete "${targetName}": ${err.message}` }],
        isError: true,
      };
    }
  });

  // === Repository reindex & single-file index ===

  handlers.set("rebuild_vectors", async () => {
    return {
      content: [{
        type: "text",
        text: [
          "The vector index needs to be rebuilt — the embedding model or its dimension changed.",
          "",
          "⚠️  IMPORTANT: Rebuilding re-embeds every indexed symbol using the current embedding provider",
          "and MAY INCUR API COSTS. Do NOT run this automatically.",
          "",
          "Tell the user:",
          "  - Semantic search is degraded until the vector index matches the current embedding model.",
          "  - Rebuilding re-embeds all symbols across all indexed repositories and may cost money.",
          "  - Ask for explicit confirmation before proceeding.",
          "",
          "If the user confirms, run:",
          "  yats reindex --rebuild-vectors",
          "",
          "If the user declines, graph-only tools (find_symbol, find_callers, find_references, etc.) still work.",
        ].join("\n"),
      }],
    };
  });

  logger.info(`Registered ${handlers.size} tool handlers`);
  return handlers;
}

// ============================================================
// Formatting helpers
// ============================================================

function formatSymbols(symbols: any[]): any[] {
  return symbols.map(formatSymbol);
}

function formatSymbol(s: any): any {
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    language: s.language,
    file: s.location?.relativePath ?? s.relativePath,
    line: s.location?.startLine ?? s.startLine,
    namespace: s.namespace,
    signature: s.signature,
    parentClass: s.parentClass,
  };
}

function formatContextItems(items: RankedContextItem[]): any[] {
  return items.map((item) => ({
    name: item.symbol.name,
    kind: item.symbol.kind,
    file: item.symbol.location.relativePath,
    line: item.symbol.location.startLine,
    score: item.score,
    source: item.source,
    reason: item.relevanceReason,
    snippet: item.snippet?.slice(0, 500),
  }));
}
