/**
 * Tests — P4: the per-file path (/index/file) must respect INDEX_DOCS=false
 * exactly like the full pipeline does.
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";

import { IndexerService } from "./indexer.service.js";

function makeDeps() {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      graphRepository: {
        upsertSymbols: async () => {},
        upsertRelationships: async () => {},
        listAllSymbols: async () => [],
        listSymbolIdsByFile: async () => [],
        upsertRepositoryMetadata: async () => {},
        setLastIndexedCommit: async () => {},
        getLastIndexedCommit: async () => null,
        clearRepository: async () => {},
        findRepositoryByPath: async () => null,
        listRepositories: async () => [],
        deleteSymbols: async () => {},
        deleteRelationships: async () => {},
      },
      vectorRepository: {
        upsertVectors: async () => { calls.push("upsertVectors"); },
        deleteVectors: async () => {},
        clearVectorsByRepository: async () => {},
        recreateCollections: async () => {},
        search: async () => [],
        searchWithFilters: async () => [],
      },
      embeddingGenerator: {
        embedBatch: async (texts: string[]) => texts.map(() => new Array(768).fill(0.1)),
        embed: async () => new Array(768).fill(0.1),
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
        resolvePath: async () => "/tmp/repo",
      },
      analyzerFactory: { getAnalyzer: () => null },
    } as any,
  };
}

describe("IndexerService — doc config on the per-file path (P4)", () => {
  const original = process.env.INDEX_DOCS;

  after(() => {
    if (original === undefined) delete process.env.INDEX_DOCS;
    else process.env.INDEX_DOCS = original;
  });

  it("drops documentation files when INDEX_DOCS=false", async () => {
    process.env.INDEX_DOCS = "false";
    const { calls, deps } = makeDeps();
    const indexer = new IndexerService(deps);
    await indexer.indexFileContent(
      "/tmp/repo",
      "docs/readme.md",
      "# Title\n\nSome section content.",
    );
    assert.deepEqual(calls, [], "no vectors should be stored when docs are disabled");
  });

  it("indexes documentation files by default", async () => {
    process.env.INDEX_DOCS = "true";
    const { calls, deps } = makeDeps();
    const indexer = new IndexerService(deps);
    await indexer.indexFileContent(
      "/tmp/repo",
      "docs/readme.md",
      "# Title\n\nSome section content.",
    );
    assert.ok(calls.includes("upsertVectors"), "doc sections should be stored");
  });
});
