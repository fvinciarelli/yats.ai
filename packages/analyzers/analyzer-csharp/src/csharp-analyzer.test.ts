import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CSharpAnalyzer } from "./csharp-analyzer.js";
import { RelationshipKind } from "@yats/shared";

const FIXTURE = `using MyApp.Repositories;

namespace MyApp.Services
{
    public class OrderService
    {
        private readonly OrderRepository _repo = new();
        private readonly IValidator _validator;

        public OrderService(OrderRepository repo) { _repo = repo; }

        public void GetOrders()
        {
            _repo.FetchAll();
            OrderValidator.Validate(_repo);
            this.Helper();
            OrderDto dto = new OrderDto();
            dto.Map();
        }

        private void Helper() { }
    }

    public class OrderValidator
    {
        public static void Validate(OrderRepository repo) { }
    }

    public class OrderDto
    {
        public void Map() { }
    }
}

namespace MyApp.Repositories
{
    public class OrderRepository
    {
        public void FetchAll() { }
    }
}
`;

describe("CSharpAnalyzer (Roslyn bridge)", () => {
  it("classifies call receivers: field type, static type, this, local, constructor", async () => {
    const analyzer = new CSharpAnalyzer();
    const result = await analyzer.analyze("Services/OrderService.cs", FIXTURE, "repo");

    const calls = result.relationships.filter(
      (r) => r.kind === RelationshipKind.CALLS,
    );
    const byExpr = new Map<string, Record<string, unknown>>(
      calls.map((c) => [String(c.metadata?.receiverExpr ?? ""), c.metadata]),
    );

    // Field call → receiver type from the field declaration
    assert.equal(byExpr.get("_repo")?.receiverType, "OrderRepository");
    assert.equal(byExpr.get("_repo")?.receiverKind, "field");
    // Static call on a type name
    assert.equal(byExpr.get("OrderValidator")?.receiverType, "OrderValidator");
    assert.equal(byExpr.get("OrderValidator")?.receiverKind, "type");
    // this-call → raw target already scoped, no receiverType
    assert.equal(byExpr.get("this")?.receiverKind, "this");
    assert.ok(!byExpr.get("this")?.receiverType);
    // Local with explicit type
    assert.equal(byExpr.get("dto")?.receiverType, "OrderDto");
    assert.equal(byExpr.get("dto")?.receiverKind, "local");
    // Constructor-scoped call: `new OrderDto()` inside method params count as locals? No —
    // `new OrderRepository()` at field init is inside the field declaration, covered above.
  });

  it("emits symbols with the full repo-relative path (no basename truncation)", async () => {
    const analyzer = new CSharpAnalyzer();
    const result = await analyzer.analyze(
      "Services/OrderService.cs",
      FIXTURE,
      "repo",
    );
    for (const sym of result.symbols) {
      assert.equal(sym.location.relativePath, "Services/OrderService.cs");
      assert.ok(
        sym.id.includes("::Services/OrderService.cs::"),
        `expected full path in id, got ${sym.id}`,
      );
    }
  });

  it("emits CONTAINS and convention kinds (SERVICE)", async () => {
    const analyzer = new CSharpAnalyzer();
    const result = await analyzer.analyze("Services/OrderService.cs", FIXTURE, "repo");
    const contains = result.relationships.filter(
      (r) => r.kind === RelationshipKind.CONTAINS,
    );
    assert.ok(contains.length >= 5, `expected CONTAINS edges, got ${contains.length}`);
    const kinds = new Set(result.symbols.map((s) => s.kind));
    assert.ok(kinds.has("service" as any), `expected SERVICE kind, got ${[...kinds]}`);
  });
});
