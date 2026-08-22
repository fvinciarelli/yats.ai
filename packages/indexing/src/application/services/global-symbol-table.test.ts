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
});
