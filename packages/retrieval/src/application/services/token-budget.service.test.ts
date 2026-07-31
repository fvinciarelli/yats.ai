import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TokenBudgetService } from "./token-budget.service.js";
import { SymbolKind, type Symbol, type RankedContextItem } from "@yats/shared";

function makeItem(
  overrides: Partial<RankedContextItem> & { snippet?: string; signature?: string | null },
): RankedContextItem {
  return {
    symbol: {
      id: "repo::file.ts::TestClass",
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
      signature: overrides.signature !== undefined ? overrides.signature : null,
      docComment: null,
      sourceSnippet: "",
      contentHash: "",
      metadata: {},
    },
    score: 0.8,
    source: "vector",
    relevanceReason: "matches",
    snippet: overrides.snippet ?? "some code",
  };
}

describe("TokenBudgetService", () => {
  const budget = new TokenBudgetService();

  describe("estimateTokens", () => {
    it("returns 0 for empty or null text", () => {
      assert.equal(budget.estimateTokens(""), 0);
      assert.equal(budget.estimateTokens(null as any), 0);
      assert.equal(budget.estimateTokens(undefined as any), 0);
    });

    it("estimates tokens based on character length", () => {
      // 35 chars → ceil(35 / 3.5) = 10 tokens
      const tokens = budget.estimateTokens("12345678901234567890123456789012345");
      assert.equal(tokens, 10);
    });

    it("returns 1 for very short text", () => {
      assert.equal(budget.estimateTokens("a"), 1);
      assert.equal(budget.estimateTokens("abc"), 1);
    });

    it("scales linearly with text length", () => {
      const short = budget.estimateTokens("a".repeat(35));
      const long = budget.estimateTokens("a".repeat(350));
      assert.equal(long, short * 10);
    });
  });

  describe("fitWithinBudget", () => {
    it("returns all items when budget is sufficient", () => {
      const items = [
        makeItem({ snippet: "short" }),
        makeItem({ snippet: "also short" }),
      ];

      const result = budget.fitWithinBudget(items, 1000);
      assert.equal(result.length, 2);
    });

    it("truncates items when budget is exceeded", () => {
      const items = [
        makeItem({ snippet: "x".repeat(350) }), // ~100 tokens
        makeItem({ snippet: "y".repeat(350) }), // ~100 tokens
        makeItem({ snippet: "z".repeat(350) }), // ~100 tokens
      ];

      // Budget of 150 tokens — only first item fits (~100)
      const result = budget.fitWithinBudget(items, 150);
      assert.equal(result.length, 1);
    });

    it("falls back to signature when snippet is too large", () => {
      const items = [
        makeItem({
          snippet: "x".repeat(700), // ~200 tokens
          signature: "function test(): void", // ~7 tokens
        }),
        makeItem({
          snippet: "y".repeat(700), // ~200 tokens
          signature: "function other(): number", // ~8 tokens
        }),
      ];

      // Budget of 100 tokens — both snippets too large, but both signatures fit (7+8=15)
      const result = budget.fitWithinBudget(items, 100);
      assert.equal(result.length, 2);
      // Both should have been replaced with signatures
      assert.ok(result[0]!.snippet.includes("function test"));
      assert.ok(result[1]!.snippet.includes("function other"));
    });

    it("skips items when neither snippet nor signature fits, continues with next", () => {
      const items = [
        makeItem({
          snippet: "x".repeat(3500), // ~1000 tokens
          signature: null,
        }),
        makeItem({ snippet: "small one" }), // ~3 tokens — should still fit
      ];

      // First item: snippet too big, no signature → skipped with continue
      // Second item: small → fits in budget
      const result = budget.fitWithinBudget(items, 50);
      assert.equal(result.length, 1);
      assert.equal(result[0]!.snippet, "small one");
    });

    it("handles empty items array", () => {
      const result = budget.fitWithinBudget([], 100);
      assert.equal(result.length, 0);
    });

    it("handles zero budget", () => {
      const items = [makeItem({ snippet: "anything" })];
      // Even a tiny snippet won't fit in 0 tokens
      // Actually, "anything" is 8 chars → ceil(8/3.5) = 3 tokens > 0
      const result = budget.fitWithinBudget(items, 0);
      assert.equal(result.length, 0);
    });

    it("returns all items if all fit exactly", () => {
      const smallSnippet = "abc"; // 3 chars → ceil(3/3.5) = 1 token
      const items = [
        makeItem({ snippet: smallSnippet }),
        makeItem({ snippet: smallSnippet }),
        makeItem({ snippet: smallSnippet }),
      ];

      const result = budget.fitWithinBudget(items, 10);
      assert.equal(result.length, 3);
    });
  });
});
