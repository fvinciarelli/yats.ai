import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TypeScriptAnalyzer } from "./ts-compiler-analyzer.js";
import { SymbolKind, RelationshipKind } from "@code-indexer/shared";

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

  it("extracts imports", async () => {
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
    assert.ok(imports.length >= 1, `Expected IMPORTS, got ${imports.length}`);
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
});
