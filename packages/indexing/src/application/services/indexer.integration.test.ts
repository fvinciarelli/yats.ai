/**
 * Integration tests — full indexing pipeline on fixture repos.
 *
 * Verifies that analyzers correctly extract symbols and relationships
 * from real code samples in each supported language.
 *
 * Usage: pnpm --filter @yats/indexing test
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { AnalyzerFactory } from "@yats/analyzer-interface";
import { FileWalker } from "../../infrastructure/file-walker.js";
import { SymbolKind, RelationshipKind, Language } from "@yats/shared";

// Resolve fixtures directory
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "..", "..", "..", "..", "test", "fixtures");

// ============================================================
// Helpers
// ============================================================

function findSymbols(symbols: any[], name: string, kind?: string) {
  return symbols.filter((s) => s.name === name && (!kind || s.kind === kind));
}

function findRelationships(rels: any[], sourceName: string, targetName: string, kind?: string) {
  return rels.filter(
    (r) =>
      r.sourceSymbolId?.includes(sourceName) &&
      r.targetSymbolId?.includes(targetName) &&
      (!kind || r.kind === kind),
  );
}

// ============================================================
// TypeScript integration tests
// ============================================================

describe("TypeScript analyzer — integration", () => {
  let factory: AnalyzerFactory;
  let allSymbols: any[];
  let allRelationships: any[];

  before(async () => {
    // Import TypeScript analyzer dynamically (brings in TS compiler API)
    const { TypeScriptAnalyzer } = await import("@yats/analyzer-typescript");

    factory = new AnalyzerFactory();
    factory.register(new TypeScriptAnalyzer());

    allSymbols = [];
    allRelationships = [];

    const tsDir = join(FIXTURES_DIR, "typescript");
    const walker = new FileWalker();
    const files = await walker.walk(tsDir);

    for (const file of files) {
      if (!file.language) continue;
      const analyzer = factory.getAnalyzer(file.language);
      if (!analyzer) continue;

      const content = readFileSync(file.absolutePath, "utf-8");
      const result = await analyzer.analyze(
        file.relativePath,
        content,
        "test-fixtures",
      );

      allSymbols.push(...result.symbols.map((s) => ({
        name: s.name,
        kind: s.kind,
        language: s.language,
        namespace: s.namespace,
        parentClass: s.parentClass,
        signature: s.signature,
      })));
      allRelationships.push(...result.relationships.map((r) => ({
        sourceSymbolId: r.sourceSymbolId,
        targetSymbolId: r.targetSymbolId,
        kind: r.kind,
      })));
    }
  });

  it("extracts UserService (as CLASS or SERVICE)", () => {
    const svc = findSymbols(allSymbols, "UserService");
    assert.ok(svc.length > 0, "UserService class should be found");
  });

  it("extracts UserController (as CONTROLLER or CLASS)", () => {
    const ctrl = findSymbols(allSymbols, "UserController");
    assert.ok(ctrl.length > 0, "UserController should be found");
    assert.ok(
      ctrl[0]!.kind === SymbolKind.CONTROLLER || ctrl[0]!.kind === SymbolKind.CLASS,
      `UserController kind is ${ctrl[0]!.kind}`,
    );
  });

  it("extracts UserService.findById method", () => {
    const methods = findSymbols(allSymbols, "findById", SymbolKind.METHOD);
    assert.ok(methods.length > 0, "findById method should be found");
    const m = methods[0]!;
    assert.equal(m.parentClass, "UserService");
  });

  it("extracts UserService.createUser method", () => {
    const methods = findSymbols(allSymbols, "createUser", SymbolKind.METHOD);
    assert.ok(methods.length > 0, "createUser method should be found");
  });

  it("extracts CONTAINS relationships (class → method)", () => {
    const rels = findRelationships(
      allRelationships,
      "UserService",
      "findById",
      RelationshipKind.CONTAINS,
    );
    assert.ok(rels.length > 0, "UserService should CONTAIN findById");
  });
});

// ============================================================
// Go analyzer — integration
// ============================================================

describe("Go analyzer — integration", () => {
  let factory: AnalyzerFactory;
  let allSymbols: any[];
  let allRelationships: any[];

  before(async () => {
    const { GoAnalyzer } = await import("@yats/analyzer-go");

    factory = new AnalyzerFactory();
    factory.register(new GoAnalyzer());

    allSymbols = [];
    allRelationships = [];

    const goDir = join(FIXTURES_DIR, "go");
    const walker = new FileWalker();
    const files = await walker.walk(goDir);

    for (const file of files) {
      if (!file.language) continue;
      const analyzer = factory.getAnalyzer(file.language);
      if (!analyzer) continue;

      const content = readFileSync(file.absolutePath, "utf-8");
      const result = await analyzer.analyze(
        file.relativePath,
        content,
        "test-fixtures",
      );

      allSymbols.push(...result.symbols.map((s) => ({
        name: s.name,
        kind: s.kind,
        language: s.language,
        namespace: s.namespace,
        parentClass: s.parentClass,
        signature: s.signature,
      })));
      allRelationships.push(...result.relationships.map((r) => ({
        sourceSymbolId: r.sourceSymbolId,
        targetSymbolId: r.targetSymbolId,
        kind: r.kind,
      })));
    }
  });

  it("extracts UserService (as STRUCT or CLASS)", () => {
    const svc = findSymbols(allSymbols, "UserService");
    assert.ok(svc.length > 0, "UserService struct should be found");
  });

  it("extracts FindByID method", () => {
    const methods = findSymbols(allSymbols, "FindByID", SymbolKind.METHOD);
    assert.ok(methods.length > 0, "FindByID method should be found");
  });

  it("extracts UserRepository interface", () => {
    const iface = findSymbols(allSymbols, "UserRepository", SymbolKind.INTERFACE);
    assert.ok(iface.length > 0, "UserRepository interface should be found");
  });

  it("extracts User struct fields", () => {
    const fields = allSymbols.filter(
      (s) => s.kind === SymbolKind.PROPERTY && s.parentClass === "User",
    );
    assert.ok(fields.length >= 3, `User should have 3+ fields, got ${fields.length}`);
  });
});

// ============================================================
// Python analyzer — integration
// ============================================================

describe("Python analyzer — integration", () => {
  let factory: AnalyzerFactory;
  let allSymbols: any[];

  before(async () => {
    const { PythonAnalyzer } = await import("@yats/analyzer-python");

    factory = new AnalyzerFactory();
    factory.register(new PythonAnalyzer());

    allSymbols = [];

    const pyDir = join(FIXTURES_DIR, "python");
    const walker = new FileWalker();
    const files = await walker.walk(pyDir);

    for (const file of files) {
      if (!file.language) continue;
      const analyzer = factory.getAnalyzer(file.language);
      if (!analyzer) continue;

      const content = readFileSync(file.absolutePath, "utf-8");
      const result = await analyzer.analyze(
        file.relativePath,
        content,
        "test-fixtures",
      );

      allSymbols.push(...result.symbols.map((s) => ({
        name: s.name,
        kind: s.kind,
        language: s.language,
        namespace: s.namespace,
        parentClass: s.parentClass,
        signature: s.signature,
      })));
    }
  });

  it("extracts UserService (as CLASS or SERVICE)", () => {
    const svc = findSymbols(allSymbols, "UserService");
    assert.ok(svc.length > 0, "UserService class should be found");
  });

  it("extracts find_by_id method", () => {
    const methods = findSymbols(allSymbols, "find_by_id", SymbolKind.METHOD);
    assert.ok(methods.length > 0, "find_by_id method should be found");
  });

  it("extracts create_user method", () => {
    const methods = findSymbols(allSymbols, "create_user", SymbolKind.METHOD);
    assert.ok(methods.length > 0, "create_user method should be found");
  });
});

// ============================================================
// PHP analyzer — integration
// ============================================================

describe("PHP analyzer — integration", () => {
  let factory: AnalyzerFactory;
  let allSymbols: any[];

  before(async () => {
    const { PhpAnalyzer } = await import("@yats/analyzer-php");

    factory = new AnalyzerFactory();
    factory.register(new PhpAnalyzer());

    allSymbols = [];

    const phpDir = join(FIXTURES_DIR, "php");
    const walker = new FileWalker();
    const files = await walker.walk(phpDir);

    for (const file of files) {
      if (!file.language) continue;
      const analyzer = factory.getAnalyzer(file.language);
      if (!analyzer) continue;

      const content = readFileSync(file.absolutePath, "utf-8");
      const result = await analyzer.analyze(
        file.relativePath,
        content,
        "test-fixtures",
      );

      allSymbols.push(...result.symbols.map((s) => ({
        name: s.name,
        kind: s.kind,
        language: s.language,
        namespace: s.namespace,
        parentClass: s.parentClass,
        signature: s.signature,
      })));
    }
  });

  it("extracts UserService (as CLASS or SERVICE)", () => {
    const svc = findSymbols(allSymbols, "UserService");
    assert.ok(svc.length > 0, "UserService class should be found");
  });

  it("extracts User class", () => {
    const user = findSymbols(allSymbols, "User", SymbolKind.CLASS);
    assert.ok(user.length > 0, "User class should be found");
  });

  it("extracts findById method", () => {
    const methods = findSymbols(allSymbols, "findById", SymbolKind.METHOD);
    assert.ok(methods.length > 0, "findById method should be found");
  });

  it("extracts MailerInterface", () => {
    const iface = findSymbols(allSymbols, "MailerInterface", SymbolKind.INTERFACE);
    assert.ok(iface.length > 0, "MailerInterface should be found");
  });
});

// ============================================================
// C# analyzer — integration
// ============================================================

describe("C# analyzer — integration", () => {
  let factory: AnalyzerFactory;
  let allSymbols: any[];

  before(async () => {
    const { CSharpAnalyzer } = await import("@yats/analyzer-csharp");

    factory = new AnalyzerFactory();
    factory.register(new CSharpAnalyzer());

    allSymbols = [];

    const csDir = join(FIXTURES_DIR, "csharp");
    const walker = new FileWalker();
    const files = await walker.walk(csDir);

    for (const file of files) {
      if (!file.language) continue;
      const analyzer = factory.getAnalyzer(file.language);
      if (!analyzer) continue;

      const content = readFileSync(file.absolutePath, "utf-8");
      const result = await analyzer.analyze(
        file.relativePath,
        content,
        "test-fixtures",
      );

      allSymbols.push(...result.symbols.map((s) => ({
        name: s.name,
        kind: s.kind,
        language: s.language,
        namespace: s.namespace,
        parentClass: s.parentClass,
        signature: s.signature,
      })));
    }
  });

  it("extracts UserService (as CLASS or SERVICE)", () => {
    const svc = findSymbols(allSymbols, "UserService");
    assert.ok(svc.length > 0, "UserService class should be found");
  });

  it("extracts IUserRepository interface", () => {
    const iface = findSymbols(allSymbols, "IUserRepository", SymbolKind.INTERFACE);
    assert.ok(iface.length > 0, "IUserRepository interface should be found");
  });

  it("extracts FindByIdAsync method", () => {
    const methods = findSymbols(allSymbols, "FindByIdAsync", SymbolKind.METHOD);
    assert.ok(methods.length > 0, "FindByIdAsync method should be found");
  });
});
