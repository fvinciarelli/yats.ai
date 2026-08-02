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
    INDEX_REPOSITORY,
    DELETE_REPOSITORY,
    REINDEX,
    INDEX_FILE,
    REMOVE_FILE,
  ];
}

const SEARCH_CODE: ToolDefinition = {
  name: "search_code",
  description: "Search indexed code using natural language. Finds relevant symbols, functions, and classes. If the repo isn't indexed yet, you'll get a hint to call index_repository first.",
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

const INDEX_REPOSITORY: ToolDefinition = {
  name: "index_repository",
  description: "Index a repository so it becomes searchable. This tool tells you the command to run — the actual indexing happens via the 'yats index' CLI on your machine, which walks local files and sends them to the YATS server.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute path to the repository to index" },
      skipDocs: { type: "boolean", description: "Skip documentation files (markdown, etc.) for faster indexing. Use true for large repos with lots of docs." },
    },
    required: ["path"],
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

const REINDEX: ToolDefinition = {
  name: "reindex",
  description: "Re-index a repository to pick up recent changes. Use this after you or the user has modified code files and the index may be stale. Only re-indexes changed files when git is available.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute path to the repository to reindex" },
    },
    required: ["path"],
  },
};

const INDEX_FILE: ToolDefinition = {
  name: "index_file",
  description: "Re-index a single file after editing it. Call this immediately after you modify a file so the knowledge graph stays up to date.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute path to the file that was modified" },
      repository: { type: "string", description: "Repository name (as shown in list_repositories)" },
    },
    required: ["path", "repository"],
  },
};

const REMOVE_FILE: ToolDefinition = {
  name: "remove_file",
  description: "Remove a deleted file from the index. Call this after you delete a file so the knowledge graph doesn't reference dead code.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute path to the file that was deleted" },
      repository: { type: "string", description: "Repository name (as shown in list_repositories)" },
    },
    required: ["path", "repository"],
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
    // Already indexed — but check if it's stale and update if needed
    if (repoPath) {
      await deps.indexer.ensureIndexed(repoPath);
    }
    return repo;
  }

  // Not indexed — if we have a path, index it now automatically
  if (repoPath) {
    const { status } = await deps.indexer.ensureIndexed(repoPath);
    if (status === "indexed" || status === "reindexed") {
      const repo = await resolveRepo(repoPath, repoName, deps.graphRepository);
      if (repo) return repo;
    }
    return {
      content: [{ type: "text", text: `Indexing failed for "${repoPath}".` }],
      isError: true,
    };
  }

  return notIndexed(repoName as string);
}

/** Return a helpful "not indexed" message with the exact command */
function notIndexed(hint?: string): ToolResult {
  const name = hint || "this repository";
  const cmd = `npx yats index ${name}`;
  return {
    content: [{
      type: "text",
      text: `Repository "${name}" is not indexed yet.\n\nRun this command to index it:\n  ${cmd}\n\nThen ask me again.`,
    }],
  };
}

/**
 * Check if the repository has a massive docs/ directory and return a warning.
 * Returns null if docs are fine to index, or a warning string if there are too many.
 */
async function checkDocsWarning(
  repoPath: string,
  deps: McpDependencies,
): Promise<string | null> {
  const MAX_DOC_FILES = 300;
  const docsDir = `${repoPath}/docs`;
  try {
    const exists = await deps.fileSystem.exists(docsDir);
    if (!exists) return null;
    const files = await deps.fileSystem.listFiles(docsDir);
    const mdFiles = files.filter(f => f.endsWith(".md")).length;
    if (mdFiles > MAX_DOC_FILES) {
      return (
        `docs/ has ${mdFiles} .md files (threshold: ${MAX_DOC_FILES}). ` +
        `Indexing all of them will take a long time.\n\n` +
        `- Call index_repository with skipDocs: true to skip documentation\n` +
        `- Call index_repository with skipDocs: false (or omit it) to index docs anyway`
      );
    }
  } catch { /* can't access docs — ignore */ }
  return null;
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

export function createToolHandlers(deps: McpDependencies): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  const logger = createLogger("mcp:tools");

  handlers.set("search_code", async (args) => {
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
    return { content: [{ type: "text", text: JSON.stringify(formatSymbols(refs), null, 2) }] };
  });

  handlers.set("find_callers", async (args) => {
    const sid = await resolveSymbolId(args, deps);
    if (typeof sid !== "string") return sid;
    const callers = await deps.graphRepository.findCallers(sid, (args.limit as number) ?? 20);
    return { content: [{ type: "text", text: JSON.stringify(formatSymbols(callers), null, 2) }] };
  });

  handlers.set("find_callees", async (args) => {
    const sid = await resolveSymbolId(args, deps);
    if (typeof sid !== "string") return sid;
    const callees = await deps.graphRepository.findCallees(sid, (args.limit as number) ?? 20);
    return { content: [{ type: "text", text: JSON.stringify(formatSymbols(callees), null, 2) }] };
  });

  handlers.set("find_implementations", async (args) => {
    const sid = await resolveSymbolId(args, deps);
    if (typeof sid !== "string") return sid;
    const impls = await deps.graphRepository.findImplementations(sid, (args.limit as number) ?? 20);
    return { content: [{ type: "text", text: JSON.stringify(formatSymbols(impls), null, 2) }] };
  });

  handlers.set("find_inheritors", async (args) => {
    const sid = await resolveSymbolId(args, deps);
    if (typeof sid !== "string") return sid;
    const inheritors = await deps.graphRepository.findInheritors(sid, (args.limit as number) ?? 20);
    return { content: [{ type: "text", text: JSON.stringify(formatSymbols(inheritors), null, 2) }] };
  });

  handlers.set("find_tests", async (args) => {
    const sid = await resolveSymbolId(args, deps);
    if (typeof sid !== "string") return sid;
    const tests = await deps.graphRepository.findTests(sid, (args.limit as number) ?? 20);
    return { content: [{ type: "text", text: JSON.stringify(formatSymbols(tests), null, 2) }] };
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
    return {
      content: [{ type: "text", text: JSON.stringify({
        nodeCount: subgraph.nodes.length,
        relationshipCount: subgraph.relationships.length,
        nodes: formatSymbols(subgraph.nodes),
        relationships: subgraph.relationships.map((rel) => ({
          sourceId: rel.sourceSymbolId,
          targetId: rel.targetSymbolId,
          kind: rel.kind,
        })),
      }, null, 2) }],
    };
  });

  handlers.set("related_symbols", async (args) => {
    const sid = await resolveSymbolId(args, deps);
    if (typeof sid !== "string") return sid;
    const related = await deps.graphRepository.relatedSymbols(sid, (args.limit as number) ?? 30);
    return { content: [{ type: "text", text: JSON.stringify(formatSymbols(related), null, 2) }] };
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

    const summary = await deps.graphRepository.repositorySummary(resolved.name);
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

  handlers.set("index_repository", async (args) => {
    const repoPath = args.path as string;
    if (!repoPath) return { content: [{ type: "text", text: "Error: 'path' is required" }], isError: true };

    // Reject dangerous paths that would scan the entire filesystem
    const dangerous = ["/", "/root", "/etc", "/dev", "/proc", "/sys", "/var", "/usr", "/home", "/tmp"];
    const isWindowsRoot = /^[A-Z]:\?$/i.test(repoPath);
    if (dangerous.includes(repoPath) || isWindowsRoot || repoPath === "/" || !repoPath.includes("/") || repoPath.length < 3) {
      return {
        content: [{ type: "text", text: `Refusing to index "${repoPath}" — this would scan the entire filesystem. Please provide a specific project path like /home/user/my-project or C:\\Users\\user\\project.` }],
        isError: true,
      };
    }

    const skipDocs = args.skipDocs === true;
    const repoName = repoPath.split("/").pop() || repoPath;
    const skipDocsFlag = skipDocs ? " --skip-docs" : "";

    return {
      content: [{
        type: "text",
        text: `Tell the user:\n\n"I'm going to index ${repoPath}. This will analyze your code, generate embeddings, and store the knowledge graph. It may take a few minutes depending on the repo size."\n\nTell the user to run:\n\n  yats index ${repoPath}${skipDocsFlag}\n\nAfter the command finishes, poll with:\n\n  repository_summary(repository: "${repoName}")\n\nWait until 'relationships' stops increasing between two consecutive checks. Then show the user the final summary.\n\nOnce indexing is complete, suggest keeping the index live:\n\n  "I can watch this repo for changes and keep the index up to date while we work. Run: yats watch ${repoPath}"\n\nThis starts a file watcher that automatically re-indexes modified files and removes deleted ones. The agent should offer this — if the user says yes, run the command. If the user is in autonomous mode (AGENTS.md/SKILL.md says the agent can execute commands directly), just run it.\n\nIf the user doesn't want to wait, tell them they can ask for the status anytime with 'repository_summary'.`,
      }],
    };
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

  handlers.set("reindex", async (args) => {
    const repoPath = args.path as string;
    if (!repoPath) return { content: [{ type: "text", text: "Error: 'path' is required" }], isError: true };

    const { status, result } = await deps.indexer.ensureIndexed(repoPath);

    if (status === "fresh") {
      return { content: [{ type: "text", text: `Repository at "${repoPath}" is already up to date. No reindex needed.` }] };
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status,
          summary: result ? {
            symbolsFound: result.symbolsFound,
            relationshipsFound: result.relationshipsFound,
            duration: `${(result.duration / 1000).toFixed(1)}s`,
          } : null,
        }, null, 2),
      }],
    };
  });

  handlers.set("index_file", async (args) => {
    const filePath = args.path as string;
    const repoName = args.repository as string;
    if (!filePath) return { content: [{ type: "text", text: "Error: 'path' (absolute file path) is required" }], isError: true };
    if (!repoName) return { content: [{ type: "text", text: "Error: 'repository' is required" }], isError: true };

    try {
      await deps.indexer.indexFile(repoName, filePath);
      return {
        content: [{ type: "text", text: `✅ File "${filePath}" re-indexed successfully in repository "${repoName}".` }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `❌ Failed to index file "${filePath}": ${err.message}` }],
        isError: true,
      };
    }
  });

  handlers.set("remove_file", async (args) => {
    const filePath = args.path as string;
    const repoName = args.repository as string;
    if (!filePath) return { content: [{ type: "text", text: "Error: 'path' (absolute file path) is required" }], isError: true };
    if (!repoName) return { content: [{ type: "text", text: "Error: 'repository' is required" }], isError: true };

    try {
      const result = await deps.indexer.removeFile(repoName, filePath);
      return {
        content: [{
          type: "text",
          text: `✅ Removed ${result.removed} symbols from index for deleted file "${filePath}" in repository "${repoName}".`,
        }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `❌ Failed to remove file "${filePath}" from index: ${err.message}` }],
        isError: true,
      };
    }
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
