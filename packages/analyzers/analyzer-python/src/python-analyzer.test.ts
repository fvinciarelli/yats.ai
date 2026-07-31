import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PythonAnalyzer } from "./python-analyzer.js";
import { SymbolKind, RelationshipKind } from "@yats/shared";

const analyzer = new PythonAnalyzer();

describe("PythonAnalyzer", () => {
  it("detects .py and .pyi files", () => {
    assert.ok(analyzer.canAnalyze("main.py", ""));
    assert.ok(analyzer.canAnalyze("types.pyi", ""));
    assert.ok(analyzer.canAnalyze("module.pyx", ""));
    assert.ok(!analyzer.canAnalyze("script.js", ""));
    assert.ok(!analyzer.canAnalyze("code.go", ""));
  });

  it("extracts classes", async () => {
    const code = `
class UserService:
    def __init__(self, repo):
        self.repo = repo

    def get_user(self, user_id: int) -> dict:
        return self.repo.find(user_id)

class OrderHandler:
    pass
`;
    const result = await analyzer.analyze("services.py", code, "test-repo");

    // UserService gets detected as SERVICE by convention, OrderHandler as CLASS
    const totalSymbols = result.symbols.filter(
      (s) => s.kind === SymbolKind.CLASS || s.kind === SymbolKind.SERVICE,
    );
    assert.equal(totalSymbols.length, 2, `Expected 2 class-like symbols, got ${totalSymbols.length}`);
  });

  it("detects class inheritance", async () => {
    const code = `
class Animal:
    pass

class Dog(Animal):
    pass

class Cat(Animal, object):
    pass
`;
    const result = await analyzer.analyze("animals.py", code, "test-repo");

    const inherits = result.relationships.filter(
      (r) => r.kind === RelationshipKind.INHERITS,
    );
    // Dog→Animal, Cat→Animal ("object" is filtered out)
    assert.ok(inherits.length >= 2, `Expected >=2 INHERITS, got ${inherits.length}`);
  });

  it("extracts functions and methods", async () => {
    const code = `
def standalone_function():
    return True

class Processor:
    def __init__(self, config):
        self.config = config

    def process(self, data):
        return data

    def __repr__(self):
        return f"Processor({self.config})"
`;
    const result = await analyzer.analyze("processor.py", code, "test-repo");

    const funcs = result.symbols.filter((s) => s.kind === SymbolKind.FUNCTION);
    const methods = result.symbols.filter((s) => s.kind === SymbolKind.METHOD);
    const ctors = result.symbols.filter((s) => s.kind === SymbolKind.CONSTRUCTOR);

    assert.equal(funcs.length, 1);
    assert.equal(funcs[0]!.name, "standalone_function");
    assert.equal(methods.length, 2, `Expected 2 methods, got ${methods.length}`);
    assert.equal(ctors.length, 1);
    assert.equal(ctors[0]!.name, "__init__");
  });

  it("detects async functions", async () => {
    const code = `
async def fetch_data(url: str) -> dict:
    return {}

async def process_async():
    await fetch_data("http://example.com")
`;
    const result = await analyzer.analyze("async_ops.py", code, "test-repo");

    const funcs = result.symbols.filter((s) => s.kind === SymbolKind.FUNCTION);
    assert.equal(funcs.length, 2);
  });

  it("detects FastAPI route decorators", async () => {
    const code = `
from fastapi import FastAPI

app = FastAPI()

@app.get("/users")
async def get_users():
    return []

@app.post("/users")
async def create_user(data: dict):
    return {"id": 1}
`;
    const result = await analyzer.analyze("api.py", code, "test-repo");

    const routes = result.symbols.filter((s) => s.kind === SymbolKind.ROUTE);
    assert.equal(routes.length, 2, `Expected 2 ROUTEs, got ${routes.length}`);
  });

  it("detects imports", async () => {
    const code = `
import os
from typing import List, Optional
from .services import UserService
`;
    const result = await analyzer.analyze("module.py", code, "test-repo");

    const imports = result.relationships.filter(
      (r) => r.kind === RelationshipKind.IMPORTS,
    );
    assert.ok(imports.length >= 3, `Expected >=3 imports, got ${imports.length}`);
  });

  it("detects test files by path convention", async () => {
    const code = `
class TestUserService:
    def test_create_user(self):
        pass
`;
    const result = await analyzer.analyze("tests/test_user_service.py", code, "test-repo");

    const tests = result.symbols.filter((s) => s.metadata?.isTest === true);
    assert.equal(tests.length, 1);
  });

  it("detects architectural conventions", async () => {
    const code = `
class PaymentService:
    pass

class PaymentController:
    pass

class PaymentRepository:
    pass

class PaymentDTO:
    pass

class PaymentEntity:
    pass
`;
    const result = await analyzer.analyze("payment.py", code, "test-repo");

    const services = result.symbols.filter((s) => s.kind === SymbolKind.SERVICE);
    const controllers = result.symbols.filter((s) => s.kind === SymbolKind.CONTROLLER);
    const repos = result.symbols.filter((s) => s.kind === SymbolKind.REPOSITORY);
    const dtos = result.symbols.filter((s) => s.kind === SymbolKind.DTO);
    const entities = result.symbols.filter((s) => s.kind === SymbolKind.ENTITY);

    assert.equal(services.length, 1);
    assert.equal(controllers.length, 1);
    assert.equal(repos.length, 1);
    assert.equal(dtos.length, 1);
    assert.equal(entities.length, 1);
  });

  it("returns empty results for empty file", async () => {
    const result = await analyzer.analyze("empty.py", "", "test-repo");
    assert.equal(result.errors.length, 0);
  });
});
