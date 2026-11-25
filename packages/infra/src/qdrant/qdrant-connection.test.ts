import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractVectorSize } from "./qdrant-connection.js";

describe("extractVectorSize", () => {
  it("reads a single-vector collection size", () => {
    assert.equal(
      extractVectorSize({ config: { params: { vectors: { size: 1536, distance: "Cosine" } } } }),
      1536,
    );
  });

  it("reads the first named vector size", () => {
    assert.equal(
      extractVectorSize({ config: { params: { vectors: { code: { size: 768, distance: "Cosine" } } } } }),
      768,
    );
  });

  it("returns null for unknown shapes", () => {
    assert.equal(extractVectorSize(null), null);
    assert.equal(extractVectorSize(undefined), null);
    assert.equal(extractVectorSize({}), null);
    assert.equal(extractVectorSize({ config: { params: {} } }), null);
  });
});
