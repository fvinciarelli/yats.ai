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
// Tool Definitions — all 24 MCP tools
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
    READ_FILE,
    WRITE_FILE,
    UPDATE_FILE,
    DELETE_FILE,
    CREATE_FILE,
    LIST_REPOSITORIES,
    INDEX_REPOSITORY,
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
  description: "Find all symbols that reference the given symbol.",
  inputSchema: {
    type: "object",
    properties: {
      symbolId: { type: "string" },
      repository: { type: "string" },
      limit: { type: "number", default: 20 },
    },
    required: ["symbolId", "repository"],
  },
};

const FIND_CALLERS: ToolDefinition = {
  name: "find_callers",
  description: "Find all functions/methods that call the given function/method.",
  inputSchema: {
    type: "object",
    properties: {
      symbolId: { type: "string" },
      repository: { type: "string" },
      limit: { type: "number", default: 20 },
    },
    required: ["symbolId", "repository"],
  },
};

const FIND_CALLEES: ToolDefinition = {
  name: "find_callees",
  description: "Find all functions/methods called by the given function/method.",
  inputSchema: {
    type: "object",
    properties: {
      symbolId: { type: "string" },
      repository: { type: "string" },
      limit: { type: "number", default: 20 },
    },
    required: ["symbolId", "repository"],
  },
};

const FIND_IMPLEMENTATIONS: ToolDefinition = {
  name: "find_implementations",
  description: "Find all implementations of an interface or abstract class/method.",
  inputSchema: {
    type: "object",
    properties: {
      symbolId: { type: "string" },
      repository: { type: "string" },
      limit: { type: "number", default: 20 },
    },
    required: ["symbolId", "repository"],
  },
};

const FIND_INHERITORS: ToolDefinition = {
  name: "find_inheritors",
  description: "Find all subclasses / types that inherit from the given class.",
  inputSchema: {
    type: "object",
    properties: {
      symbolId: { type: "string" },
      repository: { type: "string" },
      limit: { type: "number", default: 20 },
    },
    required: ["symbolId", "repository"],
  },
};

const FIND_TESTS: ToolDefinition = {
  name: "find_tests",
  description: "Find tests related to the given symbol.",
  inputSchema: {
    type: "object",
    properties: {
      symbolId: { type: "string" },
      repository: { type: "string" },
      limit: { type: "number", default: 20 },
    },
    required: ["symbolId", "repository"],
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
  description: "Find symbols directly related to the given symbol (1-hop neighbors).",
  inputSchema: {
    type: "object",
    properties: {
      symbolId: { type: "string" },
      repository: { type: "string" },
      limit: { type: "number", default: 30 },
    },
    required: ["symbolId"],
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
  description: "Index a repository so it becomes searchable. Call this before searching code in a repo that isn't indexed yet. Indexing extracts symbols, relationships, and builds the knowledge graph.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute path to the repository to index" },
    },
    required: ["path"],
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

/** Return a helpful "not indexed" message */
function notIndexed(hint?: string): ToolResult {
  const name = hint || "this directory";
  return {
    content: [{
      type: "text",
      text: `Repository "${name}" is not indexed yet. Call index_repository(path="${name}") first.`,
    }],
  };
}

// ============================================================
// Tool Handler Factory
// ============================================================

export function createToolHandlers(deps: McpDependencies): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  const logger = createLogger("mcp:tools");

  handlers.set("search_code", async (args) => {
    const repo = await resolveRepo(
      args.path as string | undefined,
      args.repository as string | undefined,
      deps.graphRepository,
    );
    if (!repo) {
      const hint = args.path || args.repository || "this directory";
      return {
        content: [{
          type: "text",
          text: `Repository "${hint}" is not indexed yet. Call index_repository(path="${hint}") first, then search again.`,
        }],
      };
    }
    const query: RetrievalQuery = {
      query: args.query as string,
      repository: repo.name,
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
    const repo = await resolveRepo(
      args.path as string | undefined,
      args.repository as string | undefined,
      deps.graphRepository,
    );
    if (!repo) return notIndexed((args.path ?? args.repository) as string);
    const result = await deps.embeddings.embed(args.query as string);
    const hits = await deps.vectorRepository.search(CollectionName.DOCUMENTATION, result, {
      limit: (args.limit as number) ?? 10,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(hits.filter(h => h.payload.repository === repo.name), null, 2) }],
    };
  });

  handlers.set("find_symbol", async (args) => {
    const repo = await resolveRepo(
      args.path as string | undefined,
      args.repository as string | undefined,
      deps.graphRepository,
    );
    if (!repo) return notIndexed((args.path ?? args.repository) as string);
    const symbols = await deps.graphRepository.findSymbolByName(
      repo.name,
      args.name as string,
      args.kind as SymbolKind | undefined,
    );
    return {
      content: [{ type: "text", text: JSON.stringify(formatSymbols(symbols), null, 2) }],
    };
  });

  handlers.set("find_references", async (args) => {
    const refs = await deps.graphRepository.findReferences(
      args.symbolId as string,
      (args.limit as number) ?? 20,
    );
    return { content: [{ type: "text", text: JSON.stringify(formatSymbols(refs), null, 2) }] };
  });

  handlers.set("find_callers", async (args) => {
    const callers = await deps.graphRepository.findCallers(
      args.symbolId as string,
      (args.limit as number) ?? 20,
    );
    return { content: [{ type: "text", text: JSON.stringify(formatSymbols(callers), null, 2) }] };
  });

  handlers.set("find_callees", async (args) => {
    const callees = await deps.graphRepository.findCallees(
      args.symbolId as string,
      (args.limit as number) ?? 20,
    );
    return { content: [{ type: "text", text: JSON.stringify(formatSymbols(callees), null, 2) }] };
  });

  handlers.set("find_implementations", async (args) => {
    const impls = await deps.graphRepository.findImplementations(
      args.symbolId as string,
      (args.limit as number) ?? 20,
    );
    return { content: [{ type: "text", text: JSON.stringify(formatSymbols(impls), null, 2) }] };
  });

  handlers.set("find_inheritors", async (args) => {
    const inheritors = await deps.graphRepository.findInheritors(
      args.symbolId as string,
      (args.limit as number) ?? 20,
    );
    return { content: [{ type: "text", text: JSON.stringify(formatSymbols(inheritors), null, 2) }] };
  });

  handlers.set("find_tests", async (args) => {
    const tests = await deps.graphRepository.findTests(
      args.symbolId as string,
      (args.limit as number) ?? 20,
    );
    return { content: [{ type: "text", text: JSON.stringify(formatSymbols(tests), null, 2) }] };
  });

  handlers.set("find_routes", async (args) => {
    const repo = await resolveRepo(
      args.path as string | undefined,
      args.repository as string | undefined,
      deps.graphRepository,
    );
    if (!repo) return notIndexed((args.path ?? args.repository) as string);
    const routes = await deps.graphRepository.findRoutes(repo.name);
    return { content: [{ type: "text", text: JSON.stringify(formatSymbols(routes), null, 2) }] };
  });

  handlers.set("find_configuration", async (args) => {
    const repo = await resolveRepo(
      args.path as string | undefined,
      args.repository as string | undefined,
      deps.graphRepository,
    );
    if (!repo) return notIndexed((args.path ?? args.repository) as string);
    const configs = await deps.graphRepository.findConfiguration(
      repo.name,
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
        nodes: formatSymbols(subgraph.nodes),
      }, null, 2) }],
    };
  });

  handlers.set("related_symbols", async (args) => {
    const related = await deps.graphRepository.relatedSymbols(
      args.symbolId as string,
      (args.limit as number) ?? 30,
    );
    return { content: [{ type: "text", text: JSON.stringify(formatSymbols(related), null, 2) }] };
  });

  handlers.set("list_symbols", async (args) => {
    const repo = await resolveRepo(
      args.path as string | undefined,
      args.repository as string | undefined,
      deps.graphRepository,
    );
    if (!repo) return notIndexed((args.path ?? args.repository) as string);
    const symbols = await deps.graphRepository.listSymbols(
      repo.name,
      args.kind as SymbolKind | undefined,
      (args.limit as number) ?? 50,
      (args.offset as number) ?? 0,
    );
    return { content: [{ type: "text", text: JSON.stringify(formatSymbols(symbols), null, 2) }] };
  });

  handlers.set("repository_summary", async (args) => {
    const repo = await resolveRepo(
      args.path as string | undefined,
      args.repository as string | undefined,
      deps.graphRepository,
    );
    if (!repo) return notIndexed((args.path ?? args.repository) as string);
    const summary = await deps.graphRepository.repositorySummary(repo.name);
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  });

  handlers.set("architecture_summary", async (args) => {
    const repo = await resolveRepo(
      args.path as string | undefined,
      args.repository as string | undefined,
      deps.graphRepository,
    );
    if (!repo) return notIndexed((args.path ?? args.repository) as string);
    const controllers = await deps.graphRepository.listSymbols(
      repo.name, SymbolKind.CONTROLLER, 20, 0,
    );
    const services = await deps.graphRepository.listSymbols(
      repo.name, SymbolKind.SERVICE, 20, 0,
    );
    const entities = await deps.graphRepository.listSymbols(
      repo.name, SymbolKind.ENTITY, 20, 0,
    );
    const routes = await deps.graphRepository.findRoutes(repo.name);

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

  // File operations
  handlers.set("read_file", async (args) => {
    const repo = await resolveRepo(
      (args.cwd ?? args.repo_path) as string | undefined,
      args.repository as string | undefined,
      deps.graphRepository,
    );
    if (!repo) return notIndexed((args.cwd ?? args.repo_path ?? args.repository) as string);
    const fullPath = path.join(repo.rootPath, args.path as string);
    let content = await deps.fileSystem.readFile(fullPath);

    const startLine = args.startLine as number | undefined;
    const endLine = args.endLine as number | undefined;

    if (startLine || endLine) {
      const lines = content.split("\n");
      const start = (startLine ?? 1) - 1;
      const end = endLine ?? lines.length;
      content = lines.slice(start, end).join("\n");
    }

    return { content: [{ type: "text", text: content }] };
  });

  handlers.set("write_file", async (args) => {
    const repo = await resolveRepo(
      (args.cwd ?? args.repo_path) as string | undefined,
      args.repository as string | undefined,
      deps.graphRepository,
    );
    if (!repo) return notIndexed((args.cwd ?? args.repo_path ?? args.repository) as string);
    const fullPath = path.join(repo.rootPath, args.path as string);
    await deps.fileSystem.writeFile(fullPath, args.content as string);
    return { content: [{ type: "text", text: `File written: ${args.path}` }] };
  });

  handlers.set("update_file", async (args) => {
    const repo = await resolveRepo(
      (args.cwd ?? args.repo_path) as string | undefined,
      args.repository as string | undefined,
      deps.graphRepository,
    );
    if (!repo) return notIndexed((args.cwd ?? args.repo_path ?? args.repository) as string);
    const fullPath = path.join(repo.rootPath, args.path as string);
    await deps.fileSystem.updateFile(
      fullPath,
      (args.edits as Array<{ oldText: string; newText: string }>),
    );
    return { content: [{ type: "text", text: `File updated: ${args.path}` }] };
  });

  handlers.set("delete_file", async (args) => {
    const repo = await resolveRepo(
      (args.cwd ?? args.repo_path) as string | undefined,
      args.repository as string | undefined,
      deps.graphRepository,
    );
    if (!repo) return notIndexed((args.cwd ?? args.repo_path ?? args.repository) as string);
    const fullPath = path.join(repo.rootPath, args.path as string);
    await deps.fileSystem.deleteFile(fullPath);
    return { content: [{ type: "text", text: `File deleted: ${args.path}` }] };
  });

  handlers.set("create_file", async (args) => {
    const repo = await resolveRepo(
      (args.cwd ?? args.repo_path) as string | undefined,
      args.repository as string | undefined,
      deps.graphRepository,
    );
    if (!repo) return notIndexed((args.cwd ?? args.repo_path ?? args.repository) as string);
    const fullPath = path.join(repo.rootPath, args.path as string);
    await deps.fileSystem.createFile(fullPath, args.content as string);
    return { content: [{ type: "text", text: `File created: ${args.path}` }] };
  });

  // Repository management
  handlers.set("list_repositories", async () => {
    const repos = await deps.graphRepository.listRepositories();
    return { content: [{ type: "text", text: JSON.stringify(repos, null, 2) }] };
  });

  handlers.set("index_repository", async (args) => {
    const repoPath = args.path as string;
    if (!repoPath) return { content: [{ type: "text", text: "Error: 'path' is required" }], isError: true };

    const result = await deps.indexer.indexRepository(repoPath);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
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
