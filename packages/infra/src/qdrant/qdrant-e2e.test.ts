import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { QdrantConnection } from "./qdrant-connection.js";

// ============================================================
// E2E test — embedding dimension change / rebuild
//
// DISABLED by default. To run it:
//
//   1. Add to the repo root `.env`:
//        YATS_E2E=1
//        QDRANT_URL=http://localhost:6333   # a THROWAWAY Qdrant — see warning below
//
//   2. Start a throwaway Qdrant (docker run -p 6333:6333 qdrant/qdrant)
//
//   3. pnpm test
//
// ⚠️  WARNING: this test deletes and recreates the "code" and "documentation"
//     collections in QDRANT_URL. Point it at a disposable Qdrant instance,
//     NEVER at a Qdrant that holds real indexed data.
//
// It exercises the dimension-mismatch detection + recreateCollections flow
// without calling any embedding API (no cost).
// ============================================================

function loadEnvFromRepoRoot(): void {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const envPath = resolve(dir, ".env");
    if (existsSync(envPath)) {
      for (const line of readFileSync(envPath, "utf8").split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const eq = t.indexOf("=");
        if (eq <= 0) continue;
        const key = t.slice(0, eq).trim();
        const value = t.slice(eq + 1).trim();
        if (key && !(key in process.env)) process.env[key] = value;
      }
      return;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) return;
    dir = parent;
  }
}

loadEnvFromRepoRoot();

const E2E_ENABLED = process.env.YATS_E2E === "1";
const QDRANT_URL = process.env.QDRANT_URL ?? "http://localhost:6333";

describe("Qdrant E2E — embedding dimension change", { skip: !E2E_ENABLED }, () => {
  it("detects a dimension mismatch and recovers via recreateCollections", async () => {
    // 1. Fresh index at 1536d — no mismatch expected.
    const conn = new QdrantConnection({ url: QDRANT_URL });
    await conn.initialize(1536);
    assert.equal(conn.dimensionMismatch, false);

    // 2. Simulate the user switching to a 768d model (rebuild at 768d).
    await conn.recreateCollections(768);
    assert.equal(conn.dimensionMismatch, false);

    // 3. A fresh connection expecting 1536d must detect the mismatch.
    const fresh = new QdrantConnection({ url: QDRANT_URL });
    await fresh.initialize(1536);
    assert.equal(fresh.dimensionMismatch, true);

    // 4. Rebuilding at the correct dimension clears the mismatch.
    await fresh.recreateCollections(1536);
    assert.equal(fresh.dimensionMismatch, false);

    // 5. A new connection again sees a consistent state.
    const verify = new QdrantConnection({ url: QDRANT_URL });
    await verify.initialize(1536);
    assert.equal(verify.dimensionMismatch, false);
  });
});
