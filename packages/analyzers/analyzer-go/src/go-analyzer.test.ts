import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GoAnalyzer } from "./go-analyzer.js";
import { SymbolKind, RelationshipKind } from "@yats/shared";

const analyzer = new GoAnalyzer();

describe("GoAnalyzer", () => {
  it("detects .go files", () => {
    assert.ok(analyzer.canAnalyze("main.go", ""));
    assert.ok(analyzer.canAnalyze("pkg/handler.go", ""));
    assert.ok(!analyzer.canAnalyze("script.py", ""));
    assert.ok(!analyzer.canAnalyze("code.ts", ""));
  });

  it("extracts structs", async () => {
    const code = `
package main

type User struct {
  Name  string
  Email string
}

type Config struct {
  Port int
}
`;
    const result = await analyzer.analyze("models.go", code, "test-repo");

    const structs = result.symbols.filter((s) => s.kind === SymbolKind.STRUCT);
    assert.equal(structs.length, 2, `Expected 2 structs, got ${structs.length}`);
    assert.equal(structs[0]!.name, "User");
    assert.equal(structs[1]!.name, "Config");
  });

  it("extracts interfaces", async () => {
    const code = `
package store

type Repository interface {
  Save(entity interface{}) error
  Find(id string) (interface{}, error)
}
`;
    const result = await analyzer.analyze("repository.go", code, "test-repo");

    const ifaces = result.symbols.filter((s) => s.kind === SymbolKind.INTERFACE);
    assert.equal(ifaces.length, 1);
    assert.equal(ifaces[0]!.name, "Repository");
  });

  it("extracts functions and methods with receivers", async () => {
    const code = `
package main

func NewService() *Service {
  return &Service{}
}

func (s *Service) Process(data string) error {
  return nil
}

func helper() bool {
  return true
}
`;
    const result = await analyzer.analyze("service.go", code, "test-repo");

    const funcs = result.symbols.filter((s) => s.kind === SymbolKind.FUNCTION);
    const methods = result.symbols.filter((s) => s.kind === SymbolKind.METHOD);

    assert.equal(funcs.length, 2, `Expected 2 functions, got ${funcs.length}`);
    assert.equal(methods.length, 1, `Expected 1 method, got ${methods.length}`);
    assert.equal(methods[0]!.name, "Process");
    assert.equal(methods[0]!.parentClass, "Service");
  });

  it("detects Service convention", async () => {
    const code = `
package app

type UserService struct {
  repo Repository
}

func (s *UserService) GetUser(id string) (*User, error) {
  return nil, nil
}
`;
    const result = await analyzer.analyze("user_service.go", code, "test-repo");

    const services = result.symbols.filter((s) => s.kind === SymbolKind.SERVICE);
    assert.equal(services.length, 1);
    assert.equal(services[0]!.name, "UserService");
  });

  it("detects Controller convention", async () => {
    const code = `
package http

type UserController struct {
  svc *UserService
}
`;
    const result = await analyzer.analyze("user_controller.go", code, "test-repo");

    const controllers = result.symbols.filter((s) => s.kind === SymbolKind.CONTROLLER);
    assert.equal(controllers.length, 1);
  });

  it("detects Repository convention", async () => {
    const code = `
package data

type UserRepository struct {
  db *sql.DB
}
`;
    const result = await analyzer.analyze("user_repo.go", code, "test-repo");

    const repos = result.symbols.filter((s) => s.kind === SymbolKind.REPOSITORY);
    assert.equal(repos.length, 1);
  });

  it("detects test files", async () => {
    const code = `
package main

type TestHelper struct {
  svc *Service
}

func TestSomething(t *testing.T) {
  // test
}
`;
    const result = await analyzer.analyze("service_test.go", code, "test-repo");

    const tests = result.symbols.filter((s) => s.metadata?.isTest === true);
    assert.ok(tests.length >= 1, `Expected TEST symbols, got ${tests.length}`);
  });

  it("creates CONTAINS relationship for methods", async () => {
    const code = `
package main

type Calculator struct{}

func (c *Calculator) Add(a, b int) int {
  return a + b
}

func (c *Calculator) Subtract(a, b int) int {
  return a - b
}
`;
    const result = await analyzer.analyze("calc.go", code, "test-repo");

    const contains = result.relationships.filter(
      (r) => r.kind === RelationshipKind.CONTAINS,
    );
    assert.equal(contains.length, 2, `Expected 2 CONTAINS, got ${contains.length}`);
  });

  it("returns empty results for non-Go content", async () => {
    const result = await analyzer.analyze("empty.go", "", "test-repo");
    // Fallback still processes — should not crash
    assert.equal(result.errors.length, 0);
  });
});
