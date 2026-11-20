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
    // Fallback still processes — should not crash. The bridge failure is now
    // VISIBLE (warning entry) instead of silent, so assert that contract.
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]!.severity, "warning");
    assert.match(result.errors[0]!.message, /fallback/);
  });

  it("detects routes from stdlib, gorilla, gin, and chi registrations (P5)", async () => {
    const code = `
package main

func healthHandler() {}
func userList() {}
func userDetail() {}
func orderCreate() {}

func muxRouter() *mux.Router { return nil }
func ginRouter() *gin.Engine { return nil }
func chiRouter() *chi.Mux { return nil }

func main() {
  http.HandleFunc("/health", healthHandler)

  r := muxRouter()
  r.HandleFunc("/users", userList)

  g := ginRouter()
  g.GET("/users/:id", userDetail)

  c := chiRouter()
  c.Get("/orders", orderCreate)
}
`;
    const result = await analyzer.analyze("routes.go", code, "test-repo");

    const routes = result.symbols.filter((s) => s.kind === SymbolKind.ROUTE);
    assert.equal(routes.length, 4, `Expected 4 ROUTEs, got ${routes.length}`);

    const health = routes.find((r) => r.name === "healthHandler");
    assert.ok(health, "healthHandler should be a route");
    assert.equal(health.metadata["framework"], "stdlib");
    assert.equal(health.metadata["routePath"], "/health");

    const list = routes.find((r) => r.name === "userList");
    assert.equal(list.metadata["framework"], "gorilla");
    assert.equal(list.metadata["routePath"], "/users");

    const detail = routes.find((r) => r.name === "userDetail");
    assert.equal(detail.metadata["framework"], "gin");
    assert.equal(detail.metadata["httpMethod"], "GET");
    assert.equal(detail.metadata["routePath"], "/users/:id");

    const create = routes.find((r) => r.name === "orderCreate");
    assert.equal(create.metadata["framework"], "chi");
    assert.equal(create.metadata["httpMethod"], "GET");
    assert.equal(create.metadata["routePath"], "/orders");
  });
});

describe("GoAnalyzer — USES_TYPE edges", () => {
  it("records struct fields, params, returns, composites and assertions", async () => {
    const analyzer = new GoAnalyzer();
    const code = `package services

type ProfileDto struct {
	ID   int
	Name string
}

type ProfileService struct {
	cache map[string]*ProfileDto
}

func (s *ProfileService) Get(id int) (*ProfileDto, error) {
	var found *ProfileDto
	if dto, ok := interface{}(found).(*ProfileDto); ok {
		found = dto
	}
	item := &ProfileDto{ID: id}
	return item, nil
}

func Build() ProfileDto {
	return ProfileDto{Name: "x"}
}

func Save(dto ProfileDto) error {
	return nil
}
`;
    const result = await analyzer.analyze("services/profile.go", code, "repo");
    const uses = result.relationships.filter(
      (r) => r.kind === RelationshipKind.USES_TYPE,
    );
    assert.ok(uses.length > 0, "expected USES_TYPE edges");

    const profile = result.symbols.find((s) => s.name === "ProfileDto");
    assert.ok(profile, "ProfileDto symbol missing");

    for (const edge of uses) {
      if (edge.metadata?.typeName !== "ProfileDto") continue;
      assert.equal(edge.targetSymbolId, profile!.id, `exact same-file target expected from ${edge.sourceSymbolId}`);
      const lines = edge.metadata?.lines as number[];
      assert.ok(Array.isArray(lines) && lines.length > 0);
      assert.ok(lines.every((l) => l > 1), `real line numbers expected, got ${lines}`);
    }

    const kinds = new Set<string>();
    for (const edge of uses) {
      for (const kind of (edge.metadata?.usageKinds as string[]) ?? []) kinds.add(kind);
    }
    for (const expected of ["declaration", "parameter", "return", "composite", "assert"]) {
      assert.ok(kinds.has(expected), `missing usage kind ${expected} (got ${[...kinds]})`);
    }
    assert.ok(!uses.some((u) => u.metadata?.typeName === "int"));
  });
});
