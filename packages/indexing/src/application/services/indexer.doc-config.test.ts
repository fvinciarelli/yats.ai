/**
 * Tests — P4: the per-file path (/index/file) must respect INDEX_DOCS=false
 * exactly like the full pipeline does.
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";

import { IndexerService } from "./indexer.service.js";

function makeDeps() {
  const calls: string[] = [];
  const payloads: any[] = [];
  return {
    calls,
    payloads,
    deps: {
      graphRepository: {
        upsertSymbols: async () => {},
        upsertRelationships: async () => {},
        listAllSymbols: async () => [],
        listSymbolIdsByFile: async () => [],
        upsertRepositoryMetadata: async () => {},
        setLastIndexedCommit: async () => {},
        getLastIndexedCommit: async () => null,
        clearRepository: async () => ({ symbols: 0, files: 0 }),
        findRepositoryByPath: async () => null,
        listRepositories: async () => [],
        deleteSymbols: async () => {},
        deleteRelationships: async () => {},
        getAnalyzerVersion: async () => null,
        setAnalyzerVersion: async () => {},
        getFileState: async () => ({ contentHash: null, analyzerVersion: null }),
        getFileHashes: async () => ({}),
        upsertFileHash: async () => {},
        removeFileHash: async () => {},
      },
      vectorRepository: {
        upsertVectors: async (items: any[]) => { calls.push("upsertVectors"); payloads.push(...items); },
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

  it("stores the section content in the vector payload (agents answer without reading files)", async () => {
    process.env.INDEX_DOCS = "true";
    const { payloads, deps } = makeDeps();
    const indexer = new IndexerService(deps);
    await indexer.indexFileContent(
      "/tmp/repo",
      "docs/readme.md",
      `# Title\n\nSome section content.\n\n## Long\n\n${"x".repeat(2500)}`,
    );

    const docPoints = payloads.filter((p) => p.payload?.kind === "doc_section");
    assert.ok(docPoints.length >= 2, `expected ≥2 doc sections, got ${docPoints.length}`);

    const short = docPoints.find((p) => (p.payload.heading as string).endsWith(" > Title"));
    assert.ok(short, "Title section stored");
    assert.ok((short.payload.content as string).includes("Some section content."));
    assert.equal(short.payload.contentTruncated, false);
    assert.ok(short.payload.contentHash, "contentHash present");

    const long = docPoints.find((p) => (p.payload.heading as string).endsWith(" > Long"));
    assert.ok(long, "Long section stored");
    assert.equal((long.payload.content as string).length, 2000, "content capped at 2000 chars");
    assert.equal(long.payload.contentTruncated, true);
  });
});
