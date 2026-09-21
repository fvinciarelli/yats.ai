import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TypeScriptAnalyzer } from "./ts-compiler-analyzer.js";
import { SymbolKind, RelationshipKind } from "@yats/shared";

const analyzer = new TypeScriptAnalyzer();

describe("TypeScriptAnalyzer", () => {
  it("detects .ts files", () => {
    assert.ok(analyzer.canAnalyze("src/foo.ts", ""));
    assert.ok(analyzer.canAnalyze("src/component.tsx", ""));
    assert.ok(!analyzer.canAnalyze("src/foo.py", ""));
  });

  it("extracts a class with methods", async () => {
    const code = `
export class PaymentService {
  async processPayment(amount: number): Promise<boolean> {
    this.validate(amount);
    return true;
  }

  private validate(amount: number): void {
    if (amount <= 0) throw new Error("Invalid");
  }
}
`;
    const result = await analyzer.analyze("src/PaymentService.ts", code, "test-repo");

    const classes = result.symbols.filter((s) => s.kind === SymbolKind.SERVICE); // ends with Service
    assert.ok(classes.length >= 1, `Expected at least 1 SERVICE class, got ${classes.length}`);

    const methods = result.symbols.filter((s) => s.kind === SymbolKind.METHOD);
    assert.equal(methods.length, 2, `Expected 2 methods, got ${methods.length}`);

    const calls = result.relationships.filter((r) => r.kind === RelationshipKind.CALLS);
    assert.ok(calls.length >= 1, `Expected at least 1 CALLS, got ${calls.length}`);
  });

  it("detects interface implementations", async () => {
    const code = `
interface IPaymentGateway {
  charge(amount: number): void;
}

class StripeGateway implements IPaymentGateway {
  charge(amount: number): void {
    console.log("Charging", amount);
  }
}
`;
    const result = await analyzer.analyze("src/gateway.ts", code, "test-repo");

    const impls = result.relationships.filter(
      (r) => r.kind === RelationshipKind.IMPLEMENTS,
    );
    assert.ok(impls.length >= 1, `Expected IMPLEMENTS, got ${impls.length}`);
  });

  it("detects class inheritance", async () => {
    const code = `
class BaseController {
  handleRequest(): void {}
}

class UserController extends BaseController {
  getUsers(): void {}
}
`;
    const result = await analyzer.analyze("src/UserController.ts", code, "test-repo");

    const inherits = result.relationships.filter(
      (r) => r.kind === RelationshipKind.INHERITS,
    );
    assert.ok(inherits.length >= 1, `Expected INHERITS, got ${inherits.length}`);

    const controllers = result.symbols.filter(
      (s) => s.kind === SymbolKind.CONTROLLER,
    );
    assert.equal(controllers.length, 2, `Expected 2 controllers, got ${controllers.length}`);
  });

  it("detects decorators", async () => {
    const code = `
@Controller("/users")
class UserController {
  @Get("/")
  getUsers(): string[] {
    return [];
  }

  @Post("/")
  createUser(): void {}
}
`;
    const result = await analyzer.analyze("src/UserController.ts", code, "test-repo");

    const decorators = result.symbols.filter(
      (s) => s.kind === SymbolKind.DECORATOR,
    );
    assert.ok(decorators.length >= 1, `Expected decorators, got ${decorators.length}`);

    // The class should be detected as Controller by name convention
    // and the @Controller decorator should also be present
    const controllers = result.symbols.filter(
      (s) => s.kind === SymbolKind.CONTROLLER,
    );
    assert.ok(controllers.length >= 1, `Expected controller detection, got ${controllers.length}`);
  });

  it("detects test files", async () => {
    const code = `
import { UserService } from "./UserService";

describe("UserService", () => {
  it("should create user", () => {
    const service = new UserService();
    expect(service).toBeDefined();
  });
});

class UserServiceTestHelper {
  createMockUser() {
    return { id: 1, name: "test" };
  }
}
`;
    const result = await analyzer.analyze("src/UserService.test.ts", code, "test-repo");

    const tests = result.symbols.filter((s) => s.metadata?.isTest === true);
    assert.ok(tests.length >= 1, `Expected TEST symbols, got ${tests.length}`);
  });

  it("does not emit import relationships (ids never exist in the symbol table)", async () => {
    const code = `
import { PaymentService } from "./PaymentService";
import type { User } from "./types";
import * as utils from "./utils";

export class OrderService {
  constructor(private payment: PaymentService) {}
}
`;
    const result = await analyzer.analyze("src/OrderService.ts", code, "test-repo");

    const imports = result.relationships.filter(
      (r) => r.kind === RelationshipKind.IMPORTS,
    );
    assert.ok(imports.length === 0, `Expected no IMPORTS, got ${imports.length}`);
  });

  it("extracts enums and type aliases", async () => {
    const code = `
export enum PaymentStatus {
  PENDING = "pending",
  COMPLETED = "completed",
}

export type PaymentResult = {
  success: boolean;
  transactionId: string;
};
`;
    const result = await analyzer.analyze("src/types.ts", code, "test-repo");

    const enums = result.symbols.filter((s) => s.kind === SymbolKind.ENUM);
    assert.equal(enums.length, 1);

    const aliases = result.symbols.filter((s) => s.kind === SymbolKind.TYPE_ALIAS);
    assert.equal(aliases.length, 1);
  });

  it("returns empty results for empty file", async () => {
    const result = await analyzer.analyze("src/empty.ts", "", "test-repo");
    assert.equal(result.errors.length, 0);
  });

  it("detects NestJS routes per method with controller prefix (P5)", async () => {
    const code = `
import { Controller, Get, Post } from "@nestjs/common";

@Controller("users")
export class UsersController {
  @Get(":id")
  findOne(): string {
    return "user";
  }

  @Post()
  create(): string {
    return "created";
  }
}
`;
    const result = await analyzer.analyze("src/users.controller.ts", code, "test-repo");

    const routes = result.symbols.filter((s) => s.kind === SymbolKind.ROUTE);
    assert.equal(routes.length, 2, `Expected 2 routes, got ${routes.length}`);

    const findOne = routes.find((r) => r.name === "findOne");
    assert.ok(findOne, "findOne should be a route");
    assert.equal(findOne.metadata["httpMethod"], "GET");
    assert.equal(findOne.metadata["routePath"], "users/:id");

    const create = routes.find((r) => r.name === "create");
    assert.ok(create, "create should be a route");
    assert.equal(create.metadata["httpMethod"], "POST");
    assert.equal(create.metadata["routePath"], "users");

    // The controller class itself is a CONTROLLER, not a ROUTE
    const controller = result.symbols.find((s) => s.name === "UsersController");
    assert.equal(controller.kind, SymbolKind.CONTROLLER);
  });

  it("detects Express routes (P5)", async () => {
    const code = `
import express from "express";

const app = express();

export class UserRouter {
  getUsers(): string {
    return "[]";
  }
}

app.get("/health", (req, res) => res.send("ok"));
app.get("/users", getUsersHandler);
app.post("/users", createUser);

function getUsersHandler(): string {
  return "[]";
}
function createUser(): string {
  return "created";
}
`;
    const result = await analyzer.analyze("src/app.ts", code, "test-repo");

    const routes = result.symbols.filter((s) => s.kind === SymbolKind.ROUTE);
    assert.equal(routes.length, 2, `Expected 2 routes, got ${routes.length}`);

    const getRoute = routes.find((r) => r.name === "getUsersHandler");
    assert.ok(getRoute, "getUsersHandler should be a route");
    assert.equal(getRoute.metadata["httpMethod"], "GET");
    assert.equal(getRoute.metadata["routePath"], "/users");
    assert.equal(getRoute.metadata["framework"], "express");

    const postRoute = routes.find((r) => r.name === "createUser");
    assert.ok(postRoute, "createUser should be a route");
    assert.equal(postRoute.metadata["httpMethod"], "POST");
    assert.equal(postRoute.metadata["routePath"], "/users");
  });
});
