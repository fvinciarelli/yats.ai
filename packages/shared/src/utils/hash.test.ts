import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hashContent } from "../utils/hash.js";

describe("hashContent", () => {
  it("returns a 64-character hex string", () => {
    const hash = hashContent("hello");
    assert.equal(hash.length, 64);
    assert.match(hash, /^[a-f0-9]{64}$/);
  });

  it("returns the same hash for the same input", () => {
    const a = hashContent("test string");
    const b = hashContent("test string");
    assert.equal(a, b);
  });

  it("returns different hashes for different inputs", () => {
    const a = hashContent("hello");
    const b = hashContent("world");
    assert.notEqual(a, b);
  });

  it("handles empty string", () => {
    const hash = hashContent("");
    assert.equal(hash.length, 64);
  });

  it("matches known SHA256 value", () => {
    const hash = hashContent("hello");
    // SHA256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    assert.equal(hash, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });
});
