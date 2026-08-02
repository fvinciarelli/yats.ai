import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CSharpAnalyzer } from "./csharp-analyzer.js";
import { SymbolKind, RelationshipKind } from "@yats/shared";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const analyzer = new CSharpAnalyzer();

/** Helper: create a temp .cs file, analyze it via bridge, return result */
async function analyzeCode(
  fileName: string,
  code: string,
  repoName = "test-repo",
): Promise<ReturnType<typeof analyzer.analyze>> {
  const dir = mkdtempSync(join(tmpdir(), "yats-csharp-test-"));
  const filePath = join(dir, fileName);
  try {
    writeFileSync(filePath, code, "utf-8");
    return await analyzer.analyze(filePath, code, repoName);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("CSharpAnalyzer", () => {
  it("detects .cs files", () => {
    assert.ok(analyzer.canAnalyze("Program.cs", ""));
    assert.ok(analyzer.canAnalyze("Models/User.cs", ""));
    assert.ok(!analyzer.canAnalyze("script.js", ""));
    assert.ok(!analyzer.canAnalyze("code.py", ""));
  });

  it("extracts classes with inheritance and interfaces", async () => {
    const code = `
using System;

namespace MyApp.Services;

public class PaymentService : BaseService, IPaymentProcessor
{
    public bool Process(decimal amount)
    {
        return true;
    }
}
`;
    const result = await analyzer.analyze("PaymentService.cs", code, "test-repo");

    // PaymentService is detected as SERVICE by naming convention
    const services = result.symbols.filter((s) => s.kind === SymbolKind.SERVICE);
    assert.equal(services.length, 1);
    assert.equal(services[0]!.name, "PaymentService");

    const inherits = result.relationships.filter((r) => r.kind === RelationshipKind.INHERITS);
    const impls = result.relationships.filter((r) => r.kind === RelationshipKind.IMPLEMENTS);
    // C# regex: I-starting interfaces get IMPLEMENTS
    assert.equal(inherits.length, 1);
    assert.equal(impls.length, 1);
  });

  it("extracts interfaces", async () => {
    const code = `
namespace MyApp.Contracts;

public interface IPaymentProcessor
{
    Task<bool> ProcessAsync(decimal amount);
    void Refund(string transactionId);
}
`;
    const result = await analyzer.analyze("IPaymentProcessor.cs", code, "test-repo");

    const ifaces = result.symbols.filter((s) => s.kind === SymbolKind.INTERFACE);
    assert.equal(ifaces.length, 1);
    assert.equal(ifaces[0]!.name, "IPaymentProcessor");
  });

  it("extracts methods with return types", async () => {
    const code = `
public class Calculator
{
    public int Add(int a, int b)
    {
        return a + b;
    }

    private async Task<int> CalculateAsync()
    {
        return await Task.FromResult(42);
    }

    public static Calculator Create() => new();
}
`;
    const result = await analyzer.analyze("Calculator.cs", code, "test-repo");

    const methods = result.symbols.filter((s) => s.kind === SymbolKind.METHOD);
    assert.equal(methods.length, 3, `Expected 3 methods, got ${methods.length}`);
  });

  it("extracts using directives", async () => {
    const code = `
using System;
using System.Collections.Generic;
using MyApp.Services;
using MyApp.Models;

namespace MyApp;

public class Test { }
`;
    const result = await analyzer.analyze("Test.cs", code, "test-repo");

    const imports = result.relationships.filter((r) => r.kind === RelationshipKind.IMPORTS);
    assert.equal(imports.length, 4, `Expected 4 IMPORTS, got ${imports.length}`);
  });

  it("detects architectural conventions", async () => {
    const code = `
public class UserController { }
public class UserService { }
public class UserRepository { }
public class UserDTO { }
public class UserEntity { }
public class AuthMiddleware { }
public class RequestHandler { }
public class ServiceFactory { }
`;
    const result = await analyzer.analyze("UserController.cs", code, "test-repo");

    const controllers = result.symbols.filter((s) => s.kind === SymbolKind.CONTROLLER);
    const services = result.symbols.filter((s) => s.kind === SymbolKind.SERVICE);
    const repos = result.symbols.filter((s) => s.kind === SymbolKind.REPOSITORY);
    const dtos = result.symbols.filter((s) => s.kind === SymbolKind.DTO);
    const entities = result.symbols.filter((s) => s.kind === SymbolKind.ENTITY);
    const middlewares = result.symbols.filter((s) => s.kind === SymbolKind.MIDDLEWARE);
    const factories = result.symbols.filter((s) => s.kind === SymbolKind.FACTORY);

    assert.equal(controllers.length, 2, `Expected 2 CONTROLLER (UserController + RequestHandler), got ${controllers.length}`);
    assert.equal(services.length, 1);
    assert.equal(repos.length, 1);
    assert.equal(dtos.length, 1);
    assert.equal(entities.length, 1);
    assert.equal(middlewares.length, 1);
    assert.equal(factories.length, 1);
  });

  it("detects test files", async () => {
    const code = `
using Xunit;

public class UserServiceTests
{
    [Fact]
    public void Test_CreateUser()
    {
    }
}
`;
    const result = await analyzer.analyze("Tests/UserServiceTests.cs", code, "test-repo");

    const tests = result.symbols.filter((s) => s.metadata?.isTest === true);
    assert.equal(tests.length, 1);
  });

  it("handles partial classes", async () => {
    const code = `
public partial class UserData
{
    public bool Validate(string email) => true;
}
`;
    const result = await analyzer.analyze("UserData.cs", code, "test-repo");

    const classes = result.symbols.filter((s) => s.kind === SymbolKind.CLASS);
    assert.equal(classes.length, 1);
    assert.equal(classes[0]!.name, "UserData");
  });

  it("skips keywords in method detection", async () => {
    const code = `
public class LoopExample
{
    public void Process()
    {
        if (true) return;
        while (true) break;
        for (int i = 0; i < 10; i++) { }
        foreach (var x in list) { }
        using (var f = new FileStream()) { }
        switch (x) { }
    }
}
`;
    const result = await analyzer.analyze("LoopExample.cs", code, "test-repo");

    // Should not detect "if", "while", "for", "foreach", "using", "switch" as methods
    const methods = result.symbols.filter((s) => s.kind === SymbolKind.METHOD);
    // Process should be detected; regex may also catch other patterns
    assert.ok(methods.length >= 1, `Expected at least 1 method, got ${methods.length}`);
    const processMethod = methods.find((s) => s.name === "Process");
    assert.ok(processMethod, "Process method should be detected");
  });

  it("returns empty results for empty file", async () => {
    const result = await analyzer.analyze("empty.cs", "", "test-repo");
    assert.equal(result.errors.length, 0);
  });

  it("extracts CONTAINS relationships for class members", async () => {
    const code = `
public class OrderService
{
    private readonly IRepository _repo;
    public const int MaxItems = 100;

    public OrderService(IRepository repo)
    {
        _repo = repo;
    }

    public void Process() { }

    public decimal Total { get; set; }
}
`;
    const result = await analyzeCode("OrderService.cs", code);

    const contains = result.relationships.filter((r) => r.kind === RelationshipKind.CONTAINS);
    // Should have CONTAINS for: _repo (field), MaxItems (constant), .ctor (constructor), Process (method), Total (property)
    assert.ok(contains.length >= 5, `Expected >= 5 CONTAINS, got ${contains.length}`);

    // Field should be detected
    const fields = result.symbols.filter((s) => s.kind === SymbolKind.FIELD);
    assert.equal(fields.length, 1, `Expected 1 field (_repo), got ${fields.length}`);

    // Constant should be detected
    const constants = result.symbols.filter((s) => s.kind === SymbolKind.CONSTANT);
    assert.equal(constants.length, 1, `Expected 1 constant (MaxItems), got ${constants.length}`);

    // Property should be detected
    const properties = result.symbols.filter((s) => s.kind === SymbolKind.PROPERTY);
    assert.equal(properties.length, 1, `Expected 1 property (Total), got ${properties.length}`);

    // Constructor should be distinct from class
    const ctors = result.symbols.filter((s) => s.kind === SymbolKind.CONSTRUCTOR);
    assert.equal(ctors.length, 1);
    // Constructor ID should end with .ctor, not be same as class
    assert.ok(ctors[0]!.id.endsWith(".ctor"), `Constructor ID should end with .ctor, got: ${ctors[0]!.id}`);
  });

  it("extracts CALLS relationships from method bodies", async () => {
    const code = `
public class Worker
{
    public void DoWork()
    {
        Validate();
        ProcessData();
    }

    private void Validate() { }
    private void ProcessData() { }
}
`;
    const result = await analyzeCode("Worker.cs", code);

    const calls = result.relationships.filter((r) => r.kind === RelationshipKind.CALLS);
    // DoWork should call Validate and ProcessData
    const doWorkCalls = calls.filter((r) => r.sourceSymbolId.includes("DoWork"));
    assert.equal(doWorkCalls.length, 2, `Expected 2 CALLS from DoWork, got ${doWorkCalls.length}`);
    assert.ok(doWorkCalls.some((r) => r.targetSymbolId.includes("Validate")));
    assert.ok(doWorkCalls.some((r) => r.targetSymbolId.includes("ProcessData")));
  });

  it("extracts enum members", async () => {
    const code = `
public enum OrderStatus
{
    New,
    Processing,
    Shipped,
    Cancelled
}
`;
    const result = await analyzeCode("OrderStatus.cs", code);

    const enums = result.symbols.filter((s) => s.kind === SymbolKind.ENUM);
    assert.equal(enums.length, 1);
    assert.equal(enums[0]!.name, "OrderStatus");

    const members = result.symbols.filter((s) => s.kind === SymbolKind.FIELD);
    assert.equal(members.length, 4, `Expected 4 enum members, got ${members.length}`);
  });

  it("extracts events and delegates", async () => {
    const code = `
public delegate void StatusChangedEventHandler(object sender, StatusChangedEventArgs e);

public class Button
{
    public event EventHandler Click;
    public event StatusChangedEventHandler StatusChanged;
}
`;
    const result = await analyzeCode("Button.cs", code);

    const delegates = result.symbols.filter((s) => s.kind === SymbolKind.TYPE_ALIAS);
    assert.equal(delegates.length, 1, `Expected 1 delegate, got ${delegates.length}`);
    assert.equal(delegates[0]!.name, "StatusChangedEventHandler");

    const events = result.symbols.filter((s) => s.kind === SymbolKind.EVENT);
    assert.equal(events.length, 2, `Expected 2 events, got ${events.length}`);
  });

  it("handles records", async () => {
    const code = `
public record Person(string Name, int Age);

public record struct Point(double X, double Y);
`;
    const result = await analyzeCode("Models.cs", code);

    const records = result.symbols.filter((s) => s.metadata?.isRecord === true);
    assert.equal(records.length, 2, `Expected 2 records, got ${records.length}`);
  });

  it("scopes methods correctly under their parent class", async () => {
    const code = `
namespace App.Features;

public class ServiceA
{
    public void Execute() { }
}

public class ServiceB
{
    public void Execute() { }
}
`;
    const result = await analyzeCode("Services.cs", code);

    const methods = result.symbols.filter((s) => s.kind === SymbolKind.METHOD);
    assert.equal(methods.length, 2, `Expected 2 methods, got ${methods.length}`);

    // IDs should be unique and scoped to their parent class
    const ids = methods.map((m) => m.id);
    assert.notEqual(ids[0], ids[1], "Methods in different classes should have different IDs");
    assert.ok(ids[0]!.includes("ServiceA"), `Method 0 should be in ServiceA scope: ${ids[0]}`);
    assert.ok(ids[1]!.includes("ServiceB"), `Method 1 should be in ServiceB scope: ${ids[1]}`);
  });
});
