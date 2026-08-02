import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DeduplicatorService, type DedupOptions } from "./deduplicator.service.js";
import { SymbolKind, type Symbol, type RankedContextItem } from "@yats/shared";

function makeSymbol(overrides: Partial<Symbol> & { id: string }): Symbol {
  return {
    name: "TestClass",
    kind: SymbolKind.CLASS,
    language: "typescript" as any,
    location: {
      repository: "test-repo",
      relativePath: "src/test.ts",
      startLine: 1,
      endLine: 10,
      startColumn: 0,
      endColumn: 0,
    },
    namespace: "src.test",
    parentClass: null,
    signature: null,
    docComment: null,
    sourceSnippet: "class TestClass {}",
    contentHash: "abc123",
    metadata: {},
    ...overrides,
  };
}

function makeItem(
  overrides: Partial<RankedContextItem> & { symbolId: string; filePath?: string; score?: number },
): RankedContextItem {
  const { symbolId, filePath, score, ...rest } = overrides;
  return {
    symbol: makeSymbol({
      id: symbolId,
      location: {
        repository: "test-repo",
        relativePath: filePath ?? "src/test.ts",
        startLine: 1,
        endLine: 10,
        startColumn: 0,
        endColumn: 0,
      },
    }),
    score: score ?? 0.8,
    source: "vector",
    relevanceReason: "matches query",
    snippet: "some code",
    ...rest,
  };
}

describe("DeduplicatorService", () => {
  const deduplicator = new DeduplicatorService();

  it("removes duplicate symbol IDs keeping highest score", () => {
    const items = [
      makeItem({ symbolId: "repo::a.ts::A", score: 0.5 }),
      makeItem({ symbolId: "repo::a.ts::A", score: 0.9 }),
      makeItem({ symbolId: "repo::b.ts::B", score: 0.7 }),
    ];

    const result = deduplicator.deduplicate(items);
    assert.equal(result.length, 2);
    const itemA = result.find((i) => i.symbol.id === "repo::a.ts::A");
    assert.equal(itemA!.score, 0.9);
  });

  it("limits results per file to default 3", () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      makeItem({
        symbolId: `repo::file.ts::Symbol${i}`,
        filePath: "file.ts",
        score: 0.9 - i * 0.05,
      }),
    );

    const result = deduplicator.deduplicate(items);
    assert.equal(result.length, 3, `Expected 3 (file limit), got ${result.length}`);
    // Should keep the top 3 scores
    assert.equal(result[0]!.score, 0.9);
    assert.equal(result[1]!.score, 0.85);
    assert.equal(result[2]!.score, 0.8);
  });

  it("respects custom file level limit", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem({
        symbolId: `repo::file.ts::Symbol${i}`,
        filePath: "file.ts",
        score: 0.9 - i * 0.05,
      }),
    );

    const result = deduplicator.deduplicate(items, { fileLevelLimit: 2 });
    assert.equal(result.length, 2);
  });

  it("handles items from multiple files", () => {
    const items = [
      makeItem({ symbolId: "repo::a.ts::A1", filePath: "a.ts", score: 0.9 }),
      makeItem({ symbolId: "repo::a.ts::A2", filePath: "a.ts", score: 0.8 }),
      makeItem({ symbolId: "repo::b.ts::B1", filePath: "b.ts", score: 0.7 }),
      makeItem({ symbolId: "repo::b.ts::B2", filePath: "b.ts", score: 0.6 }),
    ];

    const result = deduplicator.deduplicate(items);
    assert.equal(result.length, 4);
    // Sorted by score descending across files
    assert.equal(result[0]!.score, 0.9);
  });

  it("handles empty input", () => {
    const result = deduplicator.deduplicate([]);
    assert.equal(result.length, 0);
  });

  it("handles single item", () => {
    const item = makeItem({ symbolId: "repo::file.ts::Only" });
    const result = deduplicator.deduplicate([item]);
    assert.equal(result.length, 1);
  });

  it("handles mixed duplicates from different sources", () => {
    const items = [
      makeItem({ symbolId: "repo::a.ts::A", score: 0.6, source: "graph" }),
      makeItem({ symbolId: "repo::a.ts::A", score: 0.8, source: "vector" }),
      makeItem({ symbolId: "repo::a.ts::A", score: 0.9, source: "both" }),
    ];

    const result = deduplicator.deduplicate(items);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.source, "both");
    assert.equal(result[0]!.score, 0.9);
  });
});
