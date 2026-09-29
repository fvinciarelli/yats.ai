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
