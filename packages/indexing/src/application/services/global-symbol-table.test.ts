import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GlobalSymbolTable, resolveRelationships, type SymbolTableEntry } from "./global-symbol-table.js";
import type { Relationship, RelationshipKind } from "@yats/shared";

const entries: SymbolTableEntry[] = [
  {
    id: "qa::services/ticket-sync/app/main.py::services.ticket-sync.app.main._config_or_404",
    name: "_config_or_404",
    namespace: "services.ticket-sync.app.main",
    relativePath: "services/ticket-sync/app/main.py",
  },
  {
    id: "qa::services/ticket-sync/app/main.py::services.ticket-sync.app.main.list_tickets",
    name: "list_tickets",
    namespace: "services.ticket-sync.app.main",
    relativePath: "services/ticket-sync/app/main.py",
  },
  {
    id: "qa::services/ticket-sync/app/strategies/__init__.py::services.ticket-sync.app.strategies.__init__.build_strategy",
    name: "build_strategy",
    namespace: "services.ticket-sync.app.strategies.__init__",
    relativePath: "services/ticket-sync/app/strategies/__init__.py",
  },
  {
    id: "qa::services/ticket-sync/app/strategies/jira.py::services.ticket-sync.app.strategies.jira.JiraStrategy._jql",
    name: "_jql",
    namespace: "services.ticket-sync.app.strategies.jira",
    relativePath: "services/ticket-sync/app/strategies/jira.py",
  },
  {
    id: "qa::services/ticket-sync/app/strategies/jira.py::services.ticket-sync.app.strategies.jira.JiraStrategy",
    name: "JiraStrategy",
    namespace: "services.ticket-sync.app.strategies.jira",
    relativePath: "services/ticket-sync/app/strategies/jira.py",
  },
  {
    id: "qa::services/ticket-sync/app/strategies/base.py::services.ticket-sync.app.strategies.base.TicketSource",
    name: "TicketSource",
    namespace: "services.ticket-sync.app.strategies.base",
    relativePath: "services/ticket-sync/app/strategies/base.py",
  },
];

function rel(kind: RelationshipKind, source: string, target: string): Relationship {
  return {
    id: `${source}--[${kind}]-->${target}`,
    sourceSymbolId: source,
    targetSymbolId: target,
    kind,
    metadata: {},
  };
}

function table(): GlobalSymbolTable {
  const t = new GlobalSymbolTable();
  t.index(entries);
  return t;
}

describe("resolveRelationships", () => {
  it("rewrites cross-file CALLS targets to the real symbol ID", () => {
    const target = "qa::services/ticket-sync/app/main.py::services.ticket-sync.app.main.build_strategy";
    const source = entries[0]!.id;
    const { resolved, rewritten } = resolveRelationships(
      [rel("CALLS" as RelationshipKind, source, target)],
      table(),
    );
    assert.equal(rewritten, 1);
    assert.equal(
      resolved[0]!.targetSymbolId,
      "qa::services/ticket-sync/app/strategies/__init__.py::services.ticket-sync.app.strategies.__init__.build_strategy",
    );
  });

  it("rewrites same-file method calls when there is a single unambiguous candidate", () => {
    // `self._jql()` inside JiraStrategy.list_tickets emits a target without the class qualifier
    const source = "qa::services/ticket-sync/app/strategies/jira.py::services.ticket-sync.app.strategies.jira.JiraStrategy.list_tickets";
    const target = "qa::services/ticket-sync/app/strategies/jira.py::services.ticket-sync.app.strategies.jira._jql";
    const { resolved, rewritten } = resolveRelationships(
      [rel("CALLS" as RelationshipKind, source, target)],
      table(),
    );
    assert.equal(rewritten, 1);
    assert.equal(
      resolved[0]!.targetSymbolId,
      "qa::services/ticket-sync/app/strategies/jira.py::services.ticket-sync.app.strategies.jira.JiraStrategy._jql",
    );
  });

  it("rewrites INHERITS targets to base classes in other files", () => {
    const source = entries[4]!.id; // JiraStrategy
    const target = "qa::services/ticket-sync/app/strategies/jira.py::services.ticket-sync.app.strategies.jira.TicketSource";
    const { resolved, rewritten } = resolveRelationships(
      [rel("INHERITS" as RelationshipKind, source, target)],
      table(),
    );
    assert.equal(rewritten, 1);
    assert.equal(resolved[0]!.targetSymbolId, entries[5]!.id); // base.py TicketSource
  });

  it("keeps already-valid same-file targets unchanged", () => {
    const source = entries[0]!.id;
    const target = "qa::services/ticket-sync/app/main.py::services.ticket-sync.app.main.list_tickets";
    const { resolved, rewritten, skipped } = resolveRelationships(
      [rel("CALLS" as RelationshipKind, source, target)],
      table(),
    );
    assert.equal(rewritten, 0);
    assert.equal(skipped, 1);
    assert.equal(resolved[0]!.targetSymbolId, target);
  });

  it("rewrites deterministically with receiverType metadata (C#/Go style)", () => {
    const csharpEntries: SymbolTableEntry[] = [
      {
        id: "r::Services/OrderService.cs::App.Services.OrderService.GetOrders",
        name: "GetOrders",
        namespace: "App.Services.OrderService",
        relativePath: "Services/OrderService.cs",
      },
      {
        id: "r::Repositories/OrderRepository.cs::App.Repositories.OrderRepository.FetchAll",
        name: "FetchAll",
        namespace: "App.Repositories.OrderRepository",
        relativePath: "Repositories/OrderRepository.cs",
      },
      {
        id: "r::Other/ShopRepository.cs::App.Other.ShopRepository.FetchAll",
        name: "FetchAll",
        namespace: "App.Other.ShopRepository",
        relativePath: "Other/ShopRepository.cs",
      },
    ];
    const t = new GlobalSymbolTable();
    t.index(csharpEntries);

    // `_repo.FetchAll()` with receiverType=OrderRepository → deterministic
    const r = rel("CALLS" as RelationshipKind, csharpEntries[0]!.id, "r::Services/OrderService.cs::App.Services.OrderService.FetchAll");
    r.metadata = { receiverType: "OrderRepository", receiverExpr: "_repo", receiverKind: "field" };
    const { resolved, rewritten } = resolveRelationships([r], t);
    assert.equal(rewritten, 1);
    assert.equal(resolved[0]!.targetSymbolId, csharpEntries[1]!.id);
  });

  it("does NOT guess when receiverType matches multiple candidates", () => {
    const csharpEntries: SymbolTableEntry[] = [
      {
        id: "r::Services/OrderService.cs::App.Services.OrderService.GetOrders",
        name: "GetOrders",
        namespace: "App.Services.OrderService",
        relativePath: "Services/OrderService.cs",
      },
      {
        id: "r::Repositories/A.cs::App.Repositories.OrderRepository.FetchAll",
        name: "FetchAll",
        namespace: "App.Repositories.OrderRepository",
        relativePath: "Repositories/A.cs",
      },
      {
        id: "r::Repositories/B.cs::App.Repositories.OrderRepository.FetchAll",
        name: "FetchAll",
        namespace: "App.Repositories.OrderRepository",
        relativePath: "Repositories/B.cs",
      },
    ];
    const t = new GlobalSymbolTable();
    t.index(csharpEntries);

    const raw = "r::Services/OrderService.cs::App.Services.OrderService.FetchAll";
    const r = rel("CALLS" as RelationshipKind, csharpEntries[0]!.id, raw);
    r.metadata = { receiverType: "OrderRepository", receiverExpr: "_repo" };
    const { resolved, rewritten } = resolveRelationships([r], t);
    assert.equal(rewritten, 0);
    assert.equal(resolved[0]!.targetSymbolId, raw); // no-guess: wrong edge > missing edge
  });

  it("does NOT fall back to name guessing when an explicit receiver has no match", () => {
    const csharpEntries: SymbolTableEntry[] = [
      {
        id: "r::Services/OrderService.cs::App.Services.OrderService.GetOrders",
        name: "GetOrders",
        namespace: "App.Services.OrderService",
        relativePath: "Services/OrderService.cs",
      },
      {
        // Same-named method on an UNRELATED class — must not be picked.
        id: "r::Other/Warehouse.cs::App.Other.Warehouse.FetchAll",
        name: "FetchAll",
        namespace: "App.Other.Warehouse",
        relativePath: "Other/Warehouse.cs",
      },
    ];
    const t = new GlobalSymbolTable();
    t.index(csharpEntries);

    // Bridge said receiverType=ExternalThing (e.g. a framework type) — no
    // symbol has that class, so the call is external. The unrelated
    // Warehouse.FetchAll must NOT be chosen by name.
    const raw = "r::Services/OrderService.cs::App.Services.OrderService.FetchAll";
    const r = rel("CALLS" as RelationshipKind, csharpEntries[0]!.id, raw);
    r.metadata = { receiverType: "ExternalThing", receiverExpr: "_client" };
    const { resolved, rewritten } = resolveRelationships([r], t);
    assert.equal(rewritten, 0);
    assert.equal(resolved[0]!.targetSymbolId, raw);
  });

  it("resolves Java `resolved` metadata by containing class", () => {
    const javaEntries: SymbolTableEntry[] = [
      {
        id: "r::OrderService.java::com.acme.OrderService.getOrders",
        name: "getOrders",
        namespace: "com.acme",
        relativePath: "OrderService.java",
      },
      {
        id: "r::OrderRepository.java::com.acme.OrderRepository.fetchAll",
        name: "fetchAll",
        namespace: "com.acme",
        relativePath: "OrderRepository.java",
        parentClass: "OrderRepository",
      },
    ];
    const t = new GlobalSymbolTable();
    t.index(javaEntries);

    const raw = "r::OrderService.java::fetchAll";
    const r = rel("CALLS" as RelationshipKind, javaEntries[0]!.id, raw);
    r.metadata = { resolved: "com.acme.OrderRepository.fetchAll()" };
    const { resolved, rewritten } = resolveRelationships([r], t);
    assert.equal(rewritten, 1);
    assert.equal(resolved[0]!.targetSymbolId, javaEntries[1]!.id);
  });

  it("resolves module-qualified calls by namespace (Python style)", () => {
    const { resolved, rewritten } = resolveRelationships(
      [(() => {
        const r = rel("CALLS" as RelationshipKind, entries[0]!.id, "qa::services/ticket-sync/app/main.py::services.ticket-sync.app.main.build_strategy");
        r.metadata = { module: "strategies", receiverKind: "module" };
        return r;
      })()],
      table(),
    );
    assert.equal(rewritten, 1);
    assert.equal(
      resolved[0]!.targetSymbolId,
      "qa::services/ticket-sync/app/strategies/__init__.py::services.ticket-sync.app.strategies.__init__.build_strategy",
    );
  });
});
