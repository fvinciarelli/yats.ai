import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { JavaAnalyzer } from "./java-analyzer.js";
import { SymbolKind, RelationshipKind } from "@yats/shared";

const analyzer = new JavaAnalyzer();

const FIXTURE = `package com.acme.order;

import java.util.List;

/** Processes orders. */
public class OrderService extends BaseService implements OrderProcessor {
    private final List<String> items;

    public OrderService(List<String> items) {
        this.items = items;
    }

    public void process(Order order) {
        helper(order);
        OrderValidator.validate(order);
        new OrderLogger().log(order);
    }

    private void helper(Order o) {
        System.out.println(o);
    }
}

interface OrderProcessor {
    void process(Order order);
}

record OrderDTO(String id, int total) {}

enum OrderStatus { PENDING, SHIPPED }

@interface Audited {}
`;

describe("JavaAnalyzer", () => {
  it("detects .java files", () => {
    assert.ok(analyzer.canAnalyze("src/Foo.java", ""));
    assert.ok(!analyzer.canAnalyze("script.js", ""));
    assert.ok(!analyzer.canAnalyze("code.rs", ""));
  });

  it("extracts types, members and relationships", async () => {
    const result = await analyzer.analyze("src/main/java/Fixture.java", FIXTURE, "test-repo");

    const names = result.symbols.map((s) => `${s.kind}:${s.name}`);
    assert.ok(names.includes("service:OrderService"), `kinds: ${names.join(", ")}`);
    assert.ok(names.includes("interface:OrderProcessor"));
    assert.ok(names.includes("record:OrderDTO"));
    assert.ok(names.includes("enum:OrderStatus"));
    assert.ok(names.includes("annotation:Audited"));
    assert.ok(names.includes("constructor:OrderService"));
    assert.ok(names.includes("method:process"));
    assert.ok(names.includes("field:items"));

    const relKinds = result.relationships.map((r) => r.kind);
    assert.ok(relKinds.includes(RelationshipKind.INHERITS));
    assert.ok(relKinds.includes(RelationshipKind.IMPLEMENTS));
    assert.ok(relKinds.filter((k) => k === RelationshipKind.CONTAINS).length >= 5);
    assert.ok(relKinds.filter((k) => k === RelationshipKind.CALLS).length >= 4);
  });

  it("namespace is the java package", async () => {
    const result = await analyzer.analyze("src/main/java/Fixture.java", FIXTURE, "test-repo");
    const svc = result.symbols.find((s) => s.name === "OrderService");
    assert.equal(svc?.namespace, "com.acme.order");
    assert.equal(svc?.language, "java");
  });

  it("methods carry parentClass and real snippet", async () => {
    const result = await analyzer.analyze("src/main/java/Fixture.java", FIXTURE, "test-repo");
    const helper = result.symbols.find((s) => s.name === "helper");
    assert.equal(helper?.parentClass, "OrderService");
    assert.ok(helper?.sourceSnippet.includes("helper"));
  });

  it("falls back to regex analysis when no JVM/bridge is available", async () => {
    const noBridge = new JavaAnalyzer("/nonexistent/yats-java-bridge.jar");
    const result = await noBridge.analyze("src/main/java/Fixture.java", FIXTURE, "test-repo");
    // OrderService is SERVICE by naming convention; the edge is what matters
    assert.ok(
      result.symbols.some((s) => s.kind === SymbolKind.SERVICE),
    );
    assert.ok(
      result.relationships.some((r) => r.kind === RelationshipKind.INHERITS),
    );
  });
});

describe("JavaAnalyzer — USES_TYPE edges", () => {
  it("records fields, params, returns, casts, instanceof and new", async () => {
    const analyzer = new JavaAnalyzer();
    const code = `package com.acme.services;

import com.acme.models.ProfileDto;
import java.util.List;

public class ProfileService {
    private final ProfileDto seed;
    private List<ProfileDto> cache;

    public ProfileService(ProfileDto seed) {
        this.seed = seed;
    }

    public ProfileDto get(int id) {
        ProfileDto found = null;
        if (seed instanceof ProfileDto) {
            found = (ProfileDto) seed;
        }
        return found;
    }

    public ProfileDto build() {
        return new ProfileDto();
    }
}
`;
    const result = await analyzer.analyze("com/acme/services/ProfileService.java", code, "repo");
    const uses = result.relationships.filter(
      (r) => r.kind === RelationshipKind.USES_TYPE,
    );
    assert.ok(uses.length > 0, "expected USES_TYPE edges");

    for (const edge of uses) {
      assert.equal(edge.metadata?.typeName, "ProfileDto");
      const lines = edge.metadata?.lines as number[];
      assert.ok(Array.isArray(lines) && lines.length > 0);
      assert.ok(lines.every((l) => l > 1), `real line numbers expected, got ${lines}`);
    }

    // Same-file? No — ProfileDto is external here, so targets stay name-based
    // (the resolver rewrites them against the symbol table).
    assert.ok(uses.every((u) => u.targetSymbolId.includes("ProfileDto")));
    assert.ok(uses.some((u) => (u.metadata?.usings as string[])?.includes("com.acme.models")));

    const kinds = new Set<string>();
    for (const edge of uses) {
      for (const kind of (edge.metadata?.usageKinds as string[]) ?? []) kinds.add(kind);
    }
    for (const expected of ["declaration", "parameter", "return", "cast", "instanceof", "new"]) {
      assert.ok(kinds.has(expected), `missing usage kind ${expected} (got ${[...kinds]})`);
    }
    assert.ok(!uses.some((u) => u.metadata?.typeName === "List"));
  });
});
