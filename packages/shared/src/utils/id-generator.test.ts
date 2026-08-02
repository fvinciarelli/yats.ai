import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createSymbolId,
  parseSymbolId,
  createRepositoryName,
} from "../utils/id-generator.js";

describe("createSymbolId", () => {
  it("creates a valid symbol ID", () => {
    const id = createSymbolId("myrepo", "src/foo.ts", "Foo.bar");
    assert.equal(id, "myrepo::src/foo.ts::Foo.bar");
  });

  it("throws on empty repository", () => {
    assert.throws(() => createSymbolId("", "src/foo.ts", "Foo.bar"));
  });

  it("throws on empty path", () => {
    assert.throws(() => createSymbolId("myrepo", "", "Foo.bar"));
  });

  it("throws on empty symbol path", () => {
    assert.throws(() => createSymbolId("myrepo", "src/foo.ts", ""));
  });

  it("handles nested symbol paths", () => {
    const id = createSymbolId("repo", "src/bar.ts", "SomeClass.method.inner");
    assert.ok(id.startsWith("repo::src/bar.ts::"));
  });
});

describe("parseSymbolId", () => {
  it("parses a valid symbol ID into components", () => {
    const id = createSymbolId("myrepo", "src/foo.ts", "Foo.bar");
    const parsed = parseSymbolId(id);
    assert.equal(parsed.repository, "myrepo");
    assert.equal(parsed.relativePath, "src/foo.ts");
    assert.equal(parsed.symbolPath, "Foo.bar");
  });

  it("handles symbol paths with :: in them", () => {
    const id = createSymbolId("repo", "path.ts", "A::B::C");
    const parsed = parseSymbolId(id);
    assert.equal(parsed.symbolPath, "A::B::C");
  });
});

describe("createRepositoryName", () => {
  it("accepts valid names", () => {
    assert.equal(createRepositoryName("my-repo"), "my-repo");
    assert.equal(createRepositoryName("repo_123"), "repo_123");
    assert.equal(createRepositoryName("a"), "a");
  });

  it("rejects names with spaces", () => {
    assert.throws(() => createRepositoryName("my repo"));
  });

  it("rejects names with special chars", () => {
    assert.throws(() => createRepositoryName("repo/name"));
    assert.throws(() => createRepositoryName("repo@name"));
  });

  it("rejects empty string", () => {
    assert.throws(() => createRepositoryName(""));
  });
});
