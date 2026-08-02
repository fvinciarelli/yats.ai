import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RankerService } from "./ranker.service.js";
import { SymbolKind, type Symbol, type RankedContextItem } from "@yats/shared";

function makeSymbol(overrides: Partial<Symbol> = {}): Symbol {
  return {
    id: "test-repo::src/test.ts::TestClass",
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
  overrides: Partial<RankedContextItem> & { symbol?: Partial<Symbol> } = {},
): RankedContextItem {
  const { symbol: symOverrides, ...rest } = overrides;
  return {
    symbol: makeSymbol(symOverrides),
    score: 0.8,
    source: "vector",
    relevanceReason: "matches query",
    snippet: "some code",
    ...rest,
  };
}

describe("RankerService", () => {
  const ranker = new RankerService();

  describe("rank with relevance strategy", () => {
    it("sorts items by composite score descending", () => {
      const items = [
        makeItem({ score: 0.5, source: "graph" }),
        makeItem({ score: 0.9, source: "vector" }),
        makeItem({ score: 0.3, source: "both" }),
      ];

      const ranked = ranker.rank(items, "relevance");
      assert.equal(ranked.length, 3);
      assert.ok(ranked[0]!.score >= ranked[1]!.score);
      assert.ok(ranked[1]!.score >= ranked[2]!.score);
    });

    it("boosts service symbols", () => {
      const serviceItem = makeItem({
        score: 0.7,
        symbol: { kind: SymbolKind.SERVICE, name: "UserService" },
      });
      const classItem = makeItem({
        score: 0.7,
        symbol: { kind: SymbolKind.CLASS, name: "UserHelper" },
      });

      const ranked = ranker.rank([classItem, serviceItem], "relevance");
      // Service should come first due to kind boost
      assert.equal(ranked[0]!.symbol.kind, SymbolKind.SERVICE);
    });

    it("boosts items with doc comments", () => {
      const withDocs = makeItem({
        score: 0.7,
        symbol: { docComment: "This is a documented class" },
      });
      const withoutDocs = makeItem({ score: 0.7 });

      const ranked = ranker.rank([withoutDocs, withDocs], "relevance");
      // Item with doc comment should rank higher
      assert.ok(ranked[0]!.symbol.docComment !== null);
    });
  });

  describe("rank with diversity strategy", () => {
    it("limits results from same file to at most 3 in top positions", () => {
      const items = Array.from({ length: 6 }, (_, i) =>
        makeItem({
          score: 0.9 - i * 0.05,
          symbol: {
            id: `test-repo::src/file.ts::Class${i}`,
            name: `Class${i}`,
            location: {
              repository: "test-repo",
              relativePath: "src/file.ts",
              startLine: i * 10 + 1,
              endLine: i * 10 + 10,
              startColumn: 0,
              endColumn: 0,
            },
          },
        }),
      );

      const ranked = ranker.rank(items, "diversity");
      // All should still be present
      assert.equal(ranked.length, 6);
      // First 3 should be from same file, next ones interleaved
      const top3SameFile = ranked.slice(0, 3).every(
        (item) => item.symbol.location.relativePath === "src/file.ts",
      );
      assert.ok(top3SameFile);
    });

    it("preserves all items", () => {
      const items = [
        makeItem({ symbol: { id: "repo::a.ts::A", name: "A" } }),
        makeItem({ symbol: { id: "repo::b.ts::B", name: "B" } }),
        makeItem({ symbol: { id: "repo::c.ts::C", name: "C" } }),
      ];

      const ranked = ranker.rank(items, "diversity");
      assert.equal(ranked.length, 3);
    });
  });

  describe("rank with balanced strategy (default)", () => {
    it("defaults to relevance ranking", () => {
      const items = [
        makeItem({ score: 0.3 }),
        makeItem({ score: 0.9 }),
      ];

      const ranked = ranker.rank(items);
      assert.equal(ranked[0]!.score, 0.9);
      assert.equal(ranked[1]!.score, 0.3);
    });
  });

  it("handles empty input", () => {
    const ranked = ranker.rank([], "relevance");
    assert.equal(ranked.length, 0);
  });

  it("handles single item", () => {
    const item = makeItem();
    const ranked = ranker.rank([item], "relevance");
    assert.equal(ranked.length, 1);
  });
});
