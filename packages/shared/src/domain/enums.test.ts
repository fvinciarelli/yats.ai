import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SymbolKind,
  RelationshipKind,
  Language,
  CollectionName,
} from "../domain/enums.js";

describe("SymbolKind", () => {
  it("has all structural kinds", () => {
    assert.equal(SymbolKind.NAMESPACE, "namespace");
    assert.equal(SymbolKind.MODULE, "module");
    assert.equal(SymbolKind.PACKAGE, "package");
  });

  it("has all type kinds", () => {
    assert.equal(SymbolKind.CLASS, "class");
    assert.equal(SymbolKind.INTERFACE, "interface");
    assert.equal(SymbolKind.ENUM, "enum");
    assert.equal(SymbolKind.STRUCT, "struct");
    assert.equal(SymbolKind.RECORD, "record");
    assert.equal(SymbolKind.TYPE_ALIAS, "type_alias");
  });

  it("has all callable kinds", () => {
    assert.equal(SymbolKind.FUNCTION, "function");
    assert.equal(SymbolKind.METHOD, "method");
    assert.equal(SymbolKind.CONSTRUCTOR, "constructor");
    assert.equal(SymbolKind.LAMBDA, "lambda");
  });

  it("has all data kinds", () => {
    assert.equal(SymbolKind.PROPERTY, "property");
    assert.equal(SymbolKind.FIELD, "field");
    assert.equal(SymbolKind.CONSTANT, "constant");
    assert.equal(SymbolKind.VARIABLE, "variable");
    assert.equal(SymbolKind.PARAMETER, "parameter");
  });

  it("has all decorator/metadata kinds", () => {
    assert.equal(SymbolKind.ANNOTATION, "annotation");
    assert.equal(SymbolKind.ATTRIBUTE, "attribute");
    assert.equal(SymbolKind.DECORATOR, "decorator");
  });

  it("has all architectural kinds", () => {
    assert.equal(SymbolKind.CONTROLLER, "controller");
    assert.equal(SymbolKind.SERVICE, "service");
    assert.equal(SymbolKind.REPOSITORY, "repository");
    assert.equal(SymbolKind.DTO, "dto");
    assert.equal(SymbolKind.ENTITY, "entity");
    assert.equal(SymbolKind.COMMAND, "command");
    assert.equal(SymbolKind.QUERY, "query");
    assert.equal(SymbolKind.EVENT, "event");
    assert.equal(SymbolKind.MIDDLEWARE, "middleware");
    assert.equal(SymbolKind.GUARD, "guard");
    assert.equal(SymbolKind.INTERCEPTOR, "interceptor");
    assert.equal(SymbolKind.PROVIDER, "provider");
    assert.equal(SymbolKind.FACTORY, "factory");
    assert.equal(SymbolKind.CONFIG, "config");
    assert.equal(SymbolKind.MIGRATION, "migration");
    assert.equal(SymbolKind.TEST, "test");
    assert.equal(SymbolKind.FIXTURE, "fixture");
    assert.equal(SymbolKind.ROUTE, "route");
    assert.equal(SymbolKind.HOOK, "hook");
    assert.equal(SymbolKind.COMPONENT, "component");
  });

  it("has unique values for all enum members", () => {
    const values = Object.values(SymbolKind);
    const unique = new Set(values);
    assert.equal(unique.size, values.length);
  });
});

describe("RelationshipKind", () => {
  it("has all structural relationships", () => {
    assert.equal(RelationshipKind.CONTAINS, "CONTAINS");
    assert.equal(RelationshipKind.DECLARES, "DECLARES");
    assert.equal(RelationshipKind.BELONGS_TO, "BELONGS_TO");
  });

  it("has all OOP relationships", () => {
    assert.equal(RelationshipKind.INHERITS, "INHERITS");
    assert.equal(RelationshipKind.IMPLEMENTS, "IMPLEMENTS");
    assert.equal(RelationshipKind.OVERRIDES, "OVERRIDES");
  });

  it("has all dependency relationships", () => {
    assert.equal(RelationshipKind.IMPORTS, "IMPORTS");
    assert.equal(RelationshipKind.EXPORTS, "EXPORTS");
    assert.equal(RelationshipKind.DEPENDS_ON, "DEPENDS_ON");
    assert.equal(RelationshipKind.CALLS, "CALLS");
    assert.equal(RelationshipKind.REFERENCES, "REFERENCES");
    assert.equal(RelationshipKind.INSTANTIATES, "INSTANTIATES");
  });

  it("has all data flow relationships", () => {
    assert.equal(RelationshipKind.RETURNS, "RETURNS");
    assert.equal(RelationshipKind.ACCEPTS, "ACCEPTS");
    assert.equal(RelationshipKind.PUBLISHES, "PUBLISHES");
    assert.equal(RelationshipKind.SUBSCRIBES, "SUBSCRIBES");
  });

  it("has testing and decorator relationships", () => {
    assert.equal(RelationshipKind.TESTS, "TESTS");
    assert.equal(RelationshipKind.CONFIGURES, "CONFIGURES");
    assert.equal(RelationshipKind.DECORATES, "DECORATES");
  });

  it("has architectural relationships", () => {
    assert.equal(RelationshipKind.ROUTES_TO, "ROUTES_TO");
    assert.equal(RelationshipKind.HANDLES, "HANDLES");
  });

  it("has unique values for all enum members", () => {
    const values = Object.values(RelationshipKind);
    const unique = new Set(values);
    assert.equal(unique.size, values.length);
  });
});

describe("Language", () => {
  it("supports all expected languages", () => {
    const expected = ["csharp", "go", "java", "javascript", "php", "python", "typescript"];
    const actual = Object.values(Language);
    for (const lang of expected) {
      assert.ok(actual.includes(lang), `Expected ${lang} in languages`);
    }
  });
});

describe("CollectionName", () => {
  it("has code and documentation collections", () => {
    assert.equal(CollectionName.CODE, "code");
    assert.equal(CollectionName.DOCUMENTATION, "documentation");
  });
});
