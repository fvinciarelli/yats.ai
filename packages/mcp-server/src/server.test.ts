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
      findRoutes: async () => [],
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
      clearRepository: async () => {},
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
    assert.ok(text.includes("yats index /home/user/my-project"), "should suggest yats index command");
    assert.ok(text.includes("repository_summary"), "should mention polling with repository_summary");
  });
});
