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
      findRepositoryByPath: async () => ({ name: "test-repo", rootPath: "/tmp/test-repo" }),
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
      indexRepository: async () => ({
        repository: "test-repo",
        symbolsFound: 10,
        relationshipsFound: 5,
        vectorsCreated: 10,
        docsIndexed: 2,
        errors: 0,
        duration: 1000,
        timings: { walkMs: 100, analyzeMs: 500, embedMs: 200, storeMs: 200, docsMs: 0, totalMs: 1000 },
      }),
      ensureIndexed: async () => ({ status: "fresh" }),
      indexFile: async () => {},
      indexFileContent: async () => {},
      incrementalIndex: async () => ({
        repository: "test-repo",
        symbolsFound: 1,
        relationshipsFound: 0,
        vectorsCreated: 1,
        docsIndexed: 0,
        errors: 0,
        duration: 100,
        timings: { walkMs: 0, analyzeMs: 50, embedMs: 30, storeMs: 20, docsMs: 0, totalMs: 100 },
      }),
      removeFile: async () => ({ removed: 3 }),
      indexDocumentation: async () => 0,
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
    assert.ok(toolNames.includes("index_repository"), "index_repository should exist");
    assert.ok(toolNames.includes("reindex"), "reindex should exist");
    assert.ok(toolNames.includes("index_file"), "index_file should exist");
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

  it("rejects reindex with system path /", async () => {
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "reindex",
        arguments: { path: "/" },
      },
    });

    assert.equal(response.id, 10);
    assert.ok((response as any).error, "should have validation error");
    assert.equal((response as any).error.code, -32602, "should be invalid params");
    assert.ok(
      (response as any).error.message.includes("system"),
      "error should mention system path",
    );
  });

  it("rejects reindex with path /home", async () => {
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: {
        name: "reindex",
        arguments: { path: "/home" },
      },
    });

    assert.ok((response as any).error, "should have validation error");
  });

  it("rejects path traversal attempts", async () => {
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: {
        name: "index_repository",
        arguments: { path: "../../etc/passwd" },
      },
    });

    assert.ok((response as any).error, "should have validation error");
    assert.ok(
      (response as any).error.message.includes("Path traversal"),
      "error should mention path traversal",
    );
  });

  it("accepts valid path", async () => {
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: {
        name: "reindex",
        arguments: { path: "/home/user/my-project" },
      },
    });

    assert.ok((response as any).result, "should succeed with valid path");
  });
});
