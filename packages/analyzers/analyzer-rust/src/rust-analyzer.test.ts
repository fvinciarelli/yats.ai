import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RustAnalyzer } from "./rust-analyzer.js";
import { SymbolKind, RelationshipKind } from "@yats/shared";

const analyzer = new RustAnalyzer();

const FIXTURE = `use std::collections::HashMap;

mod services;

pub trait Processor {
    fn process(&self, input: &str) -> String;
}

pub struct OrderService {
    cache: HashMap<String, String>,
}

impl OrderService {
    pub fn new() -> Self {
        Self { cache: HashMap::new() }
    }

    pub fn handle(&self, order: &str) -> String {
        self.process(order)
    }
}

impl Processor for OrderService {
    fn process(&self, input: &str) -> String {
        input.to_uppercase()
    }
}

pub enum Status {
    Pending,
    Done,
}

pub const MAX_ORDERS: usize = 100;

pub fn bootstrap() -> String {
    OrderService::new().handle("x")
}
`;

describe("RustAnalyzer", () => {
  it("detects .rs files", () => {
    assert.ok(analyzer.canAnalyze("src/main.rs", ""));
    assert.ok(!analyzer.canAnalyze("main.go", ""));
    assert.ok(!analyzer.canAnalyze("Main.java", ""));
  });

  it("extracts structs, traits, enums, fns via rust-analyzer LSP", async () => {
    const result = await analyzer.analyze("src/lib.rs", FIXTURE, "test-repo");

    const names = result.symbols.map((s) => `${s.kind}:${s.name}`);
    assert.ok(names.includes("interface:Processor"), `kinds: ${names.join(", ")}`);
    assert.ok(names.includes("struct:OrderService"));
    assert.ok(names.includes("enum:Status"));
    assert.ok(names.includes("module:services"));
    assert.ok(
      names.includes("method:handle") || names.includes("function:handle"),
      `handle missing: ${names.join(", ")}`,
    );

    const relKinds = result.relationships.map((r) => r.kind);
    assert.ok(relKinds.includes(RelationshipKind.IMPLEMENTS), "impl trait for type edge missing");
    assert.ok(relKinds.includes(RelationshipKind.CONTAINS), "CONTAINS missing");
  });

  it("extracts syntactic CALLS from method bodies", async () => {
    const result = await analyzer.analyze("src/lib.rs", FIXTURE, "test-repo");
    const calls = result.relationships.filter((r) => r.kind === RelationshipKind.CALLS);
    // handle() -> self.process(order) (name-based; resolved by the global table)
    const hasInternalCall = calls.some(
      (r) => r.targetSymbolId.endsWith("::process") && r.sourceSymbolId.endsWith("::handle"),
    );
    assert.ok(hasInternalCall, `expected handle→process CALLS, got: ${JSON.stringify(calls.map(c => [c.sourceSymbolId, c.targetSymbolId]))}`);
  });

  it("falls back to regex analysis without rust-analyzer", async () => {
    const noLsp = new RustAnalyzer("/nonexistent/rust-analyzer");
    const result = await noLsp.analyze("src/lib.rs", FIXTURE, "test-repo");
    const structs = result.symbols.filter((s) => s.kind === SymbolKind.STRUCT);
    assert.ok(structs.some((s) => s.name === "OrderService"));
    assert.ok(
      result.relationships.some((r) => r.kind === RelationshipKind.IMPLEMENTS),
    );
  });
});
