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

// ============================================================
// USES_TYPE — data types referenced without being instantiated
// ============================================================

const DTO_USAGE_FIXTURE = `using MyApp.Models;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace MyApp.Services;

public sealed record ProfileDto(int Id, string Name)
{
    public static ProfileDto Empty { get; } = new(0, "");
}

public class ProfileService
{
    private readonly ProfileDto _empty;
    private List<ProfileDto> _cache = new();
    private string _name = ProfileDto.Empty.Name;

    public ProfileService(ProfileDto seed) { _empty = seed; }

    public ProfileDto? Fetch(int id)
    {
        var dto = _empty;
        if (dto is null) return null;
        ProfileDto copy = (ProfileDto)dto;
        var list = new List<ProfileDto>();
        var type = typeof(ProfileDto);
        object boxed = dto as ProfileDto;
        var name = nameof(ProfileDto);
        return copy;
    }

    public Task<List<ProfileDto>> All() => Task.FromResult(new List<ProfileDto>());
}
`;

describe("CSharpAnalyzer (Roslyn bridge) — USES_TYPE edges", () => {
  it("emits a USES_TYPE edge for every way a type can be mentioned", async () => {
    const analyzer = new CSharpAnalyzer();
    const result = await analyzer.analyze("Services/ProfileService.cs", DTO_USAGE_FIXTURE, "repo");

    const uses = result.relationships.filter(
      (r) => r.kind === RelationshipKind.USES_TYPE,
    );
    assert.ok(uses.length > 0, "expected USES_TYPE edges");

    // Every edge targets the same-file record by its exact ID.
    const record = result.symbols.find((s) => s.name === "ProfileDto" && s.kind !== "property");
    assert.ok(record, "record symbol missing");
    for (const u of uses) {
      assert.equal(u.targetSymbolId, record!.id, `wrong target for ${u.sourceSymbolId}`);
      assert.equal(u.metadata?.typeName, "ProfileDto");
    }

    const bySource = new Map(uses.map((u) => [u.sourceSymbolId, u.metadata ?? {}]));

    // Field type + generic argument (List<ProfileDto> → ProfileDto, not List)
    const field = bySource.get("repo::Services/ProfileService.cs::MyApp.Services.ProfileService._empty");
    assert.ok(field, "field declaration should use the type");
    assert.deepEqual(field!.lines, [14]);

    const genericField = bySource.get("repo::Services/ProfileService.cs::MyApp.Services.ProfileService._cache");
    assert.ok(genericField, "generic argument should be recorded");
    assert.equal(genericField!.typeName, "ProfileDto");

    // Static member access: ProfileDto.Empty
    const member = bySource.get("repo::Services/ProfileService.cs::MyApp.Services.ProfileService");
    assert.ok(member, "static member access should record the type");
    assert.deepEqual(member!.usageKinds, ["member"]);

    // Constructor parameter
    const ctor = bySource.get("repo::Services/ProfileService.cs::MyApp.Services.ProfileService.ProfileService.ctor");
    assert.ok(ctor, "ctor parameter should use the type");
    assert.deepEqual(ctor!.usageKinds, ["parameter"]);

    // Return type + local + cast + typeof + as + nameof + new, all on Fetch
    const fetch = bySource.get("repo::Services/ProfileService.cs::MyApp.Services.ProfileService.Fetch");
    assert.ok(fetch, "Fetch should use the type");
    const kinds = fetch!.usageKinds as string[];
    for (const expected of ["return", "local", "cast", "typeof", "as", "nameof", "new"]) {
      assert.ok(kinds.includes(expected), `Fetch missing usage kind ${expected} (got ${kinds})`);
    }
    assert.ok((fetch!.lines as number[]).length >= 6, "Fetch should carry several lines");
    assert.equal(fetch!.count, (fetch!.lines as number[]).length);

    // Task<List<ProfileDto>> return type keeps the argument, drops BCL containers
    const all = bySource.get("repo::Services/ProfileService.cs::MyApp.Services.ProfileService.All");
    assert.ok(all, "All() should use the type");
    assert.ok((all!.usageKinds as string[]).includes("return"));

    // using directives travel with the edge so cross-file resolution can
    // pick the right namespace when two types share a name.
    assert.ok((uses[0]!.metadata?.usings as string[]).includes("MyApp.Models"));

    // BCL containers are filtered — no edge named List/Task.
    assert.ok(!uses.some((u) => u.metadata?.typeName === "List"));
    assert.ok(!uses.some((u) => u.metadata?.typeName === "Task"));
  });

  it("records one edge per (source, type) with all usage lines", async () => {
    const analyzer = new CSharpAnalyzer();
    const result = await analyzer.analyze("Services/ProfileService.cs", DTO_USAGE_FIXTURE, "repo");
    const uses = result.relationships.filter(
      (r) => r.kind === RelationshipKind.USES_TYPE,
    );
    const ids = uses.map((u) => u.id);
    assert.equal(new Set(ids).size, ids.length, "USES_TYPE edge ids must be unique");
    for (const u of uses) {
      const lines = u.metadata?.lines as number[];
      assert.ok(Array.isArray(lines) && lines.length > 0, "every edge needs lines");
      assert.deepEqual(lines, [...lines].sort((a, b) => a - b), "lines must be sorted");
      assert.equal(u.metadata?.count, lines.length);
    }
  });
});

const SIGNATURE_USAGE_FIXTURE = `using System;
using System.Collections.Generic;

namespace App.Delegates;

public sealed class PayloadDto
{
    public string Body { get; set; } = "";
}

public delegate void PayloadHandler(PayloadDto payload, IReadOnlyList<PayloadDto> all);

public class Dispatcher
{
    public void Run()
    {
        void Handle(PayloadDto single)
        {
            Console.WriteLine(single.Body);
        }

        var empty = Array.Empty<PayloadDto>();
        Handle(new PayloadDto());
    }
}
`;

describe("CSharpAnalyzer (Roslyn bridge) — signature-only type usages", () => {
  it("records delegate signatures, local functions and generic method arguments", async () => {
    const analyzer = new CSharpAnalyzer();
    const result = await analyzer.analyze("Delegates/Dispatcher.cs", SIGNATURE_USAGE_FIXTURE, "repo");

    const uses = result.relationships.filter((r) => r.kind === RelationshipKind.USES_TYPE);
    const kindsFor = (sourceSuffix: string) => {
      const edge = uses.find((u) => u.sourceSymbolId.endsWith(sourceSuffix));
      assert.ok(edge, `missing USES_TYPE edge for ${sourceSuffix}`);
      return edge!.metadata?.usageKinds as string[];
    };

    // Delegate: parameter + generic argument of the parameter type.
    assert.ok(kindsFor("App.Delegates.PayloadHandler").includes("parameter"));

    // Local function inside Run(): its parameter type is attributed to Run.
    assert.ok(kindsFor("App.Delegates.Dispatcher.Run").includes("parameter"));

    // Array.Empty<PayloadDto>() — generic method type argument.
    assert.ok(kindsFor("App.Delegates.Dispatcher.Run").includes("generic"));
  });
});

describe("CSharpAnalyzer (Roslyn bridge) — top-level statements", () => {
  it("attributes usages from global statements to a file-level symbol", async () => {
    const code = `using System.Collections.Generic;

var profile = new ProfileDto { Name = "x" };
var list = new List<ProfileDto>();
ProfileDto current = profile;
System.Console.WriteLine(ProfileDto.Empty.Name);

public sealed class ProfileDto
{
    public static ProfileDto Empty { get; } = new();
    public string Name { get; set; } = "";
}
`;
    const analyzer = new CSharpAnalyzer();
    const result = await analyzer.analyze("Program.cs", code, "repo");

    const topLevel = result.symbols.find((s) => s.name === "Program.cs");
    assert.ok(topLevel, "file-level symbol for top-level statements missing");
    assert.equal(topLevel!.metadata?.isTopLevel, true);

    const uses = result.relationships.filter(
      (r) => r.kind === RelationshipKind.USES_TYPE && r.sourceSymbolId === topLevel!.id,
    );
    assert.ok(uses.length > 0, "top-level type usages must be attributed");
    assert.deepEqual(uses[0]!.metadata?.lines, [3, 4, 5, 6]);
    assert.ok((uses[0]!.metadata?.usageKinds as string[]).includes("new"));

    const instantiates = result.relationships.filter(
      (r) => r.kind === RelationshipKind.INSTANTIATES && r.sourceSymbolId === topLevel!.id,
    );
    assert.ok(instantiates.length > 0, "new at top level must emit INSTANTIATES");
  });
});
