/**
 * End-to-end tests — MCP server JSON-RPC protocol.
 *
 * Tests tool listing, tool calls, validation, and error handling
 * using mocked dependencies (no Neo4j/Qdrant required).
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

import { McpServer } from "./server.js";
import type { McpDependencies } from "../tools/all-tools.js";
import { getAllToolDefinitions } from "../tools/all-tools.js";

// ============================================================
// Mock dependencies
// ============================================================

/** Mutable indexing status used by the indexer mock — tests flip this. */
let mockIndexing: { indexing: boolean; pendingRelationships: number } = {
  indexing: false,
  pendingRelationships: 0,
};

let lastFindRoutesCall: { repo: string; options?: any } | null = null;

function makeMockDeps(): McpDependencies {
  return {
    retriever: {
      retrieve: async () => ({
        context: [],
        tokenCount: 0,
        durationMs: 10,
      }),
    },
    graphRepository: {
      findSymbol: async () => null,
      findSymbolByName: async () => [],
      findReferences: async () => [],
      findCallers: async () => [],
      findCallees: async () => [],
      findImplementations: async () => [],
      findInheritors: async () => [],
      findTests: async () => [],
      findRoutes: async (repo: string, options?: any) => {
        lastFindRoutesCall = { repo, options };
        return [];
      },
      findConfiguration: async () => [],
      expandGraph: async () => ({ nodes: [], relationships: [] }),
      relatedSymbols: async () => [],
      listSymbols: async () => [],
      repositorySummary: async () => ({
        repository: "test-repo",
        totalSymbols: 42,
        totalRelationships: 15,
        symbolsByKind: {},
        symbolsByLanguage: {},
        languages: [],
      }),
      listRepositories: async () => [{ name: "test-repo", rootPath: "/tmp/test-repo" }],
      findRepositoryByPath: async (p: string) =>
        p === "/tmp/test-repo" ? { name: "test-repo", rootPath: "/tmp/test-repo" } : null,
      upsertSymbols: async () => {},
      upsertRelationships: async () => {},
      upsertRepositoryMetadata: async () => {},
      setLastIndexedCommit: async () => {},
      getLastIndexedCommit: async () => null,
      deleteSymbols: async () => {},
      clearRepository: async () => ({ symbols: 0, files: 0 }),
      deleteRepositoryNode: async () => {},
    },
    vectorRepository: {
      upsertVectors: async () => {},
      deleteVectors: async () => {},
      clearVectorsByRepository: async () => {},
      search: async () => [],
      searchWithFilters: async () => [],
    },
    embeddings: {
      embed: async () => new Array(768).fill(0.1),
      embedBatch: async (texts: string[]) => texts.map(() => new Array(768).fill(0.1)),
      isAvailable: async () => true,
    },
    fileSystem: {
      readFile: async () => "",
      writeFile: async () => {},
      createFile: async () => {},
      deleteFile: async () => {},
      updateFile: async () => {},
      listFiles: async () => [],
      exists: async () => true,
      resolvePath: async () => "/tmp/test-repo",
    },
    indexer: {
      registerRepository: async () => {},
      indexFileContent: async () => {},
      removeFile: async () => ({ removed: 3 }),
      finalizeRepository: async () => ({ stored: 0, filtered: 0, rewritten: 0 }),
      rebuildVectors: async () => ({ repositories: 1, symbols: 10, errors: 0 }),
      getIndexingStatus: async () => ({ ...mockIndexing }),
    },
    repositoriesRoot: "/tmp/repos",
  };
}

// ============================================================
// MCP Server — JSON-RPC tests
// ============================================================

describe("MCP Server — protocol", () => {
  let server: McpServer;
  let deps: McpDependencies;

  before(() => {
    deps = makeMockDeps();
    server = new McpServer(deps);
  });

  it("responds to initialize", async () => {
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0" },
      },
    });

    assert.equal(response.id, 1);
    assert.ok((response as any).result, "initialize should return a result");
    assert.ok((response as any).result.serverInfo, "should include server info");
    assert.equal((response as any).result.serverInfo.name, "yats");
  });

  it("responds to ping", async () => {
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "ping",
    });

    assert.equal(response.id, 2);
    // ping returns {} as result
  });

  it("lists all tools", async () => {
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/list",
    });

    assert.equal(response.id, 3);
    const tools = (response as any).result?.tools;
    assert.ok(Array.isArray(tools), "tools should be an array");
    assert.ok(tools.length >= 20, `should have at least 20 tools, got ${tools.length}`);

    // Verify key tools exist
    const toolNames = tools.map((t: any) => t.name);
    assert.ok(toolNames.includes("search_code"), "search_code should exist");
    assert.ok(toolNames.includes("find_symbol"), "find_symbol should exist");
    assert.ok(toolNames.includes("list_repositories"), "list_repositories should exist");

    // Indexing tools were removed — the server never walks the host filesystem.
    // Indexing happens exclusively through the host CLI (`yats index`).
    assert.ok(!toolNames.includes("index_repository"), "index_repository should NOT exist");
    assert.ok(!toolNames.includes("reindex"), "reindex should NOT exist");
    assert.ok(!toolNames.includes("index_file"), "index_file should NOT exist");
    assert.ok(!toolNames.includes("remove_file"), "remove_file should NOT exist");
  });

  it("each tool has required fields", async () => {
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/list",
    });

    const tools = (response as any).result?.tools;
    for (const tool of tools) {
      assert.ok(tool.name, `tool should have name`);
      assert.ok(typeof tool.name === "string", `tool name should be string`);
      assert.ok(tool.description, `${tool.name} should have description`);
      assert.ok(tool.inputSchema, `${tool.name} should have inputSchema`);
      assert.equal(tool.inputSchema.type, "object", `${tool.name} inputSchema should be object`);
    }
  });

  it("calls list_repositories tool", async () => {
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "list_repositories",
        arguments: {},
      },
    });

    assert.equal(response.id, 5);
    assert.ok((response as any).result, "should have result");
    const content = (response as any).result.content;
    assert.ok(Array.isArray(content), "content should be array");
    const parsed = JSON.parse(content[0].text);
    assert.ok(Array.isArray(parsed), "should be a JSON array of repos");
    assert.equal(parsed[0].name, "test-repo");
  });

  it("calls repository_summary tool", async () => {
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "repository_summary",
        arguments: { repository: "test-repo" },
      },
    });

    assert.equal(response.id, 6);
    const content = (response as any).result.content;
    const parsed = JSON.parse(content[0].text);
    assert.equal(parsed.totalSymbols, 42);
    assert.equal(parsed.indexing, undefined, "no indexing notice when idle");
  });

  it("repository_summary returns indexing notice while indexing", async () => {
    mockIndexing = { indexing: true, pendingRelationships: 137 };
    try {
      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "repository_summary",
          arguments: { repository: "test-repo" },
        },
      });
      const parsed = JSON.parse((response as any).result.content[0].text);
      assert.equal(parsed.indexing, true);
      assert.equal(parsed.pendingRelationships, 137);
      assert.ok(
        parsed.notice.includes("currently being indexed"),
        "notice should explain indexing is in progress",
      );
      assert.ok(
        parsed.notice.includes("repository_summary"),
        "notice should tell the agent to re-query",
      );
    } finally {
      mockIndexing = { indexing: false, pendingRelationships: 0 };
    }
  });

  it("graph tools prepend indexing notice while indexing", async () => {
    mockIndexing = { indexing: true, pendingRelationships: 5 };
    try {
      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "find_callers",
          arguments: {
            symbolId: "test-repo::src/a.py::a.foo",
          },
        },
      });
      const text = (response as any).result.content[0].text as string;
      assert.ok(text.startsWith("⏳"), "notice should be prepended");
      assert.ok(text.includes("currently being indexed"), "notice text present");
      // The actual JSON result must still be present and parseable after the notice
      const jsonPart = text.slice(text.indexOf("\n\n") + 2);
      assert.ok(Array.isArray(JSON.parse(jsonPart)), "JSON result should remain parseable");
    } finally {
      mockIndexing = { indexing: false, pendingRelationships: 0 };
    }
  });

  it("returns error for unknown tool", async () => {
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "nonexistent_tool",
        arguments: {},
      },
    });

    assert.equal(response.id, 7);
    assert.ok((response as any).error, "should have error");
    assert.equal((response as any).error.code, -32601, "should be method not found");
  });

  it("returns error for unknown method", async () => {
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 8,
      method: "unknown/method",
    });

    assert.equal(response.id, 8);
    assert.ok((response as any).error, "should have error");
  });
});

// ============================================================
// MCP Server — validation
// ============================================================

describe("MCP Server — input validation", () => {
  let server: McpServer;

  before(() => {
    server = new McpServer(makeMockDeps());
  });

  it("removed indexing tools return method-not-found", async () => {
    for (const [name, args] of [
      ["index_repository", { path: "/home/user/my-project" }],
      ["reindex", { path: "/home/user/my-project" }],
      ["index_file", { path: "/home/user/project/src/file.ts", repository: "test-repo" }],
      ["remove_file", { path: "/home/user/project/src/file.ts", repository: "test-repo" }],
    ] as const) {
      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name, arguments: args as any },
      });
      assert.ok((response as any).error, `${name} should be unknown`);
      assert.equal((response as any).error.code, -32601, `${name} should be method not found`);
    }
  });

  it("search tool on unindexed repo returns the yats index command", async () => {
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: {
        name: "search_code",
        arguments: { query: "whatever", path: "/home/user/my-project" },
      },
    });

    const content = (response as any).result?.content;
    assert.ok(content, "should have content");
    const text = content[0].text as string;
    assert.ok(text.includes("yats index /full/path/to/my-project"), "should suggest yats index command");
    assert.ok(text.includes("full path"), "should instruct to use the full path");
    assert.ok(!text.includes("I can run it for you"), "should not claim the server can run commands");
  });

  it("find_routes passes method/routePath/limit filters to the repository (P5)", async () => {
    lastFindRoutesCall = null;
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: {
        name: "find_routes",
        arguments: { path: "/tmp/test-repo", method: "GET", routePath: "/users", limit: 5 },
      },
    });

    const result = (response as any).result;
    assert.ok(result, "should return a result");
    assert.ok(lastFindRoutesCall, "findRoutes should have been called");
    assert.equal(lastFindRoutesCall!.repo, "/tmp/test-repo");
    assert.equal(lastFindRoutesCall!.options?.method, "GET");
    assert.equal(lastFindRoutesCall!.options?.path, "/users");
    assert.equal(lastFindRoutesCall!.options?.limit, 5);
  });
});

// ============================================================
// Repository identity / reference completeness
// ============================================================

function makeSymbol(id: string, name: string, file: string, lines: number[] = []) {
  return {
    id,
    name,
    kind: "class",
    language: "typescript",
    location: { relativePath: file, startLine: lines[0] ?? 1 },
    namespace: file.split("/")[0],
    relations: ["USES_TYPE"],
    lines,
    occurrences: lines.length,
  } as any;
}

describe("references and deletion by canonical rootPath", () => {
  let server: McpServer;
  let deps: McpDependencies;

  function callTool(name: string, args: Record<string, unknown>) {
    return server.handleRequest({
      jsonrpc: "2.0",
      id: 100,
      method: "tools/call",
      params: { name, arguments: args },
    });
  }

  before(() => {
    deps = makeMockDeps();
    server = new McpServer(deps);
  });

  it("find_references aggregates every exact match (same DTO, two namespaces)", async () => {
    deps.graphRepository.findSymbolByName = async (repo: string) => {
      assert.equal(repo, "/tmp/test-repo", "name must be resolved to rootPath");
      return [
        makeSymbol("/tmp/test-repo::a.ts::A.OrderDto", "OrderDto", "a.ts"),
        makeSymbol("/tmp/test-repo::b.ts::B.OrderDto", "OrderDto", "b.ts"),
      ];
    };
    deps.graphRepository.findReferences = async (id: string) =>
      id.includes("A.OrderDto")
        ? [makeSymbol("/tmp/test-repo::a.ts::A.Svc.save", "save", "a.ts", [5, 6])]
        : [makeSymbol("/tmp/test-repo::b.ts::B.Svc.load", "load", "b.ts", [4, 9])];

    // Short display name (what list_repositories returns) must work too.
    const response = await callTool("find_references", { name: "OrderDto", repository: "test-repo" });
    const result = (response as any).result;
    assert.ok(!result.isError, JSON.stringify(result));

    const rows = JSON.parse(result.content[0].text);
    assert.equal(rows.length, 2, "both namespaces must be present");
    assert.deepEqual(rows.map((r: any) => r.file).sort(), ["a.ts", "b.ts"]);
    assert.deepEqual(rows[0].matchedTargetIds.length, 1);
    assert.ok(rows.some((r: any) => r.lines.includes(9)));
  });

  it("find_references accepts path= instead of repository=", async () => {
    deps.graphRepository.findSymbolByName = async () => [
      makeSymbol("/tmp/test-repo::a.ts::A.OrderDto", "OrderDto", "a.ts"),
    ];
    deps.graphRepository.findReferences = async () => [
      makeSymbol("/tmp/test-repo::a.ts::A.Svc.save", "save", "a.ts", [5]),
    ];

    const response = await callTool("find_references", { name: "OrderDto", path: "/tmp/test-repo" });
    const rows = JSON.parse((response as any).result.content[0].text);
    assert.equal(rows.length, 1);
  });

  it("find_references returns more than 20 sources by default", async () => {
    deps.graphRepository.findSymbolByName = async () => [
      makeSymbol("/tmp/test-repo::a.ts::A.OrderDto", "OrderDto", "a.ts"),
    ];
    deps.graphRepository.findReferences = async () =>
      Array.from({ length: 25 }, (_, i) =>
        makeSymbol(`/tmp/test-repo::a.ts::A.m${i}`, `m${i}`, "a.ts", [i + 1]),
      );

    const response = await callTool("find_references", { name: "OrderDto", repository: "test-repo" });
    const rows = JSON.parse((response as any).result.content[0].text);
    assert.equal(rows.length, 25, "default limit must not truncate at 20");
  });

  it("find_callers rejects an ambiguous name instead of guessing", async () => {
    deps.graphRepository.findSymbolByName = async () => [
      makeSymbol("/tmp/test-repo::a.ts::A.OrderDto", "OrderDto", "a.ts"),
      makeSymbol("/tmp/test-repo::b.ts::B.OrderDto", "OrderDto", "b.ts"),
    ];
    const response = await callTool("find_callers", { name: "OrderDto", repository: "test-repo" });
    const result = (response as any).result;
    assert.ok(result.isError);
    assert.ok(result.content[0].text.includes("ambiguous"));
  });

  it("delete_repository deletes by rootPath and verifies the outcome", async () => {
    let summaryCalls = 0;
    let clearedWith: string | null = null;
    let nodeWith: string | null = null;
    let vectorsWith: string | null = null;
    let deleted = false;

    deps.graphRepository.repositorySummary = async (repo: string) => {
      summaryCalls += 1;
      return {
        repository: repo,
        totalSymbols: summaryCalls === 1 ? 5 : 0,
        totalRelationships: summaryCalls === 1 ? 5 : 0,
        symbolsByKind: {},
        symbolsByLanguage: {},
        languages: [],
      };
    };
    deps.graphRepository.clearRepository = async (repo: string) => {
      clearedWith = repo;
      deleted = true;
      return { symbols: 5, files: 2 };
    };
    deps.graphRepository.deleteRepositoryNode = async (ref: string) => {
      nodeWith = ref;
    };
    deps.vectorRepository.clearVectorsByRepository = async (ref: string) => {
      vectorsWith = ref;
    };
    deps.graphRepository.listRepositories = async () =>
      deleted ? [] : [{ name: "test-repo", rootPath: "/tmp/test-repo" }];

    const response = await callTool("delete_repository", {
      repository: "test-repo",
      confirm: true,
    });
    const result = (response as any).result;
    assert.ok(!result.isError, JSON.stringify(result));
    assert.equal(clearedWith, "/tmp/test-repo", "must clear by rootPath, never by name");
    assert.equal(nodeWith, "/tmp/test-repo");
    assert.equal(vectorsWith, "/tmp/test-repo");
    assert.ok(result.content[0].text.includes("5 symbols"));
  });

  it("delete_repository fails loudly when symbols survive", async () => {
    deps.graphRepository.repositorySummary = async (repo: string) => ({
      repository: repo,
      totalSymbols: 5,
      totalRelationships: 5,
      symbolsByKind: {},
      symbolsByLanguage: {},
      languages: [],
    });
    deps.graphRepository.clearRepository = async () => ({ symbols: 0, files: 0 });
    deps.graphRepository.deleteRepositoryNode = async () => {};
    deps.graphRepository.listRepositories = async () => [];

    const response = await callTool("delete_repository", {
      path: "/tmp/test-repo",
      confirm: true,
    });
    const result = (response as any).result;
    assert.ok(result.isError, "leftover data must be an error");
    assert.ok(result.content[0].text.includes("incomplete"));
  });

  it("search_documentation returns section content, not just metadata", async () => {
    deps.vectorRepository.search = async () => [
      {
        id: "doc-1", score: 0.9, vector: [],
        payload: {
          repository: "/tmp/test-repo",
          docSectionId: "/tmp/test-repo::docs/readme.md#Intro",
          relativePath: "docs/readme.md",
          heading: "docs/readme.md > Intro",
          content: "Full section text here.",
          contentTruncated: false,
          contentHash: "abc",
        },
      },
      {
        // a hit from another repo must be filtered out
        id: "doc-2", score: 0.5, vector: [],
        payload: { repository: "/other/repo", docSectionId: "x", relativePath: "y", content: "nope" },
      },
    ] as any;

    const response = await callTool("search_documentation", {
      query: "intro docs",
      path: "/tmp/test-repo",
    });
    deps.vectorRepository.search = async () => [];

    const text = (response as any).result?.content?.[0]?.text;
    const docs = JSON.parse(text);
    assert.equal(docs.length, 1, "only the matching repository's docs");
    assert.equal(docs[0].relativePath, "docs/readme.md");
    assert.equal(docs[0].content, "Full section text here.");
    assert.equal(docs[0].contentTruncated, false);
    assert.equal(docs[0].score, 0.9);
  });

  it("search_documentation reports content:null for legacy payloads (pre-content index)", async () => {
    deps.vectorRepository.search = async () => [
      {
        id: "doc-1", score: 0.8, vector: [],
        payload: { repository: "/tmp/test-repo", docSectionId: "x", relativePath: "y", contentHash: "abc" },
      },
    ] as any;

    const response = await callTool("search_documentation", {
      query: "anything",
      path: "/tmp/test-repo",
    });
    deps.vectorRepository.search = async () => [];

    const text = (response as any).result?.content?.[0]?.text;
    const docs = JSON.parse(text);
    assert.equal(docs[0].content, null);
    assert.equal(docs[0].contentTruncated, false);
  });
});
