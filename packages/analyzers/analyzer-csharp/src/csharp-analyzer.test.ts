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

// ============================================================
// Record + static constructor — find_references regression
// ============================================================

const RECORD_FIXTURE = `namespace App.Models
{
    public sealed record Person(string Name)
    {
        static Person()
        {
            Cache.Register(typeof(Person));
        }

        public static Person Empty()
        {
            return new Person(string.Empty);
        }
    }

    public class Factory
    {
        public Person Make()
        {
            return new Person("x");
        }
    }

    public static class Cache
    {
        public static void Register(System.Type t) { }
    }
}
`;

describe("CSharpAnalyzer (Roslyn bridge) — records with static constructors", () => {
  it("indexes the record type as a class symbol with isRecord metadata", async () => {
    const analyzer = new CSharpAnalyzer();
    const result = await analyzer.analyze("Models/Person.cs", RECORD_FIXTURE, "repo");

    const record = result.symbols.find(
      (s) => s.id === "repo::Models/Person.cs::App.Models.Person",
    );
    assert.ok(record, "record type symbol should be indexed");
    assert.equal(record.kind, "class" as any);
    assert.equal(record.metadata?.isRecord, true);
  });

  it("names the static constructor X.ctor — no name twin with the type", async () => {
    const analyzer = new CSharpAnalyzer();
    const result = await analyzer.analyze("Models/Person.cs", RECORD_FIXTURE, "repo");

    const ctor = result.symbols.find((s) => s.kind === "constructor" as any);
    assert.ok(ctor, "constructor symbol should be indexed");
    assert.equal(ctor.name, "Person.ctor");
    assert.equal(ctor.id, "repo::Models/Person.cs::App.Models.Person.Person.ctor");
    // The signature keeps the source-level shape.
    assert.equal(ctor.signature, "Person()");

    // No symbol other than the type itself is named exactly "Person".
    const persons = result.symbols.filter((s) => s.name === "Person");
    assert.equal(persons.length, 1);
    assert.equal(persons[0]!.kind, "class" as any);
  });

  it("emits INSTANTIATES edges from new X(...) to the record type", async () => {
    const analyzer = new CSharpAnalyzer();
    const result = await analyzer.analyze("Models/Person.cs", RECORD_FIXTURE, "repo");

    const instantiates = result.relationships.filter(
      (r) => r.kind === ("INSTANTIATES" as any),
    );
    const recordId = "repo::Models/Person.cs::App.Models.Person";

    // `new Person(string.Empty)` inside the static factory Empty
    const fromEmpty = instantiates.find(
      (r) => r.sourceSymbolId === "repo::Models/Person.cs::App.Models.Person.Empty",
    );
    assert.ok(fromEmpty, "Empty() should instantiate the record");
    assert.equal(fromEmpty.targetSymbolId, recordId);
    assert.equal(fromEmpty.metadata?.typeName, "Person");

    // `new Person("x")` inside Factory.Make
    const fromMake = instantiates.find(
      (r) => r.sourceSymbolId === "repo::Models/Person.cs::App.Models.Factory.Make",
    );
    assert.ok(fromMake, "Factory.Make() should instantiate the record");
    assert.equal(fromMake.targetSymbolId, recordId);

    // `typeof(Person)` is not an instantiation.
    const fromCtor = instantiates.filter(
      (r) => r.sourceSymbolId.includes("Person.ctor"),
    );
    assert.equal(fromCtor.length, 0);
  });

  it("keeps CALLS from the static constructor working", async () => {
    const analyzer = new CSharpAnalyzer();
    const result = await analyzer.analyze("Models/Person.cs", RECORD_FIXTURE, "repo");

    const calls = result.relationships.filter(
      (r) => r.kind === RelationshipKind.CALLS,
    );
    const fromCtor = calls.find((r) =>
      r.sourceSymbolId.includes("Person.ctor"),
    );
    assert.ok(fromCtor, "static ctor should still emit CALLS");
    assert.equal(fromCtor.metadata?.receiverType, "Cache");
    assert.equal(fromCtor.metadata?.receiverExpr, "Cache");
  });
});
