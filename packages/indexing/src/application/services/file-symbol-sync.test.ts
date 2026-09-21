/**
 * Unit tests — P2 in-place file symbol synchronization.
 *
 * Verifies that synchronizeFileSymbols keeps surviving symbols (deleting only
 * their outgoing edges) and deletes only disappeared symbols, and that
 * PendingRelationshipStore.dropFile purges stale buffered relationships.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { Relationship } from "@yats/shared";
import { createLogger } from "@yats/shared";
import { synchronizeFileSymbols } from "./file-symbol-sync.js";
import { PendingRelationshipStore } from "./pending-relationships.js";

function rel(id: string, source: string, target: string): Relationship {
  return { id, sourceSymbolId: source, targetSymbolId: target, kind: "CALLS", metadata: {} } as Relationship;
}

describe("synchronizeFileSymbols (P2)", () => {
  it("keeps surviving symbols and deletes only disappeared ones", async () => {
    const deletedSymbols: string[] = [];
    const clearedOutgoing: string[] = [];
    const deletedVectors: string[] = [];
    const droppedFiles: string[] = [];

    const deps = {
      graphRepository: {
        listSymbolIdsByFile: async () => ["repo::src/base.ts::A", "repo::src/base.ts::B"],
        deleteRelationships: async (ids: string[]) => { clearedOutgoing.push(...ids); },
        deleteSymbols: async (ids: string[]) => { deletedSymbols.push(...ids); },
      },
      vectorRepository: {
        deleteVectors: async (ids: string[]) => { deletedVectors.push(...ids); },
      },
      pendingRelationships: {
        dropFile: (_repo: string, filePath: string) => { droppedFiles.push(filePath); },
      } as unknown as PendingRelationshipStore,
    };

    const result = await synchronizeFileSymbols(
      deps as any,
      "repo",
      "src/base.ts",
      ["repo::src/base.ts::A"], // A survives, B disappeared
      createLogger("test"),
    );

    assert.deepEqual(result, { kept: 1, removed: 1 });
    assert.deepEqual(clearedOutgoing, ["repo::src/base.ts::A"], "survivor's outgoing edges cleared");
    assert.deepEqual(deletedSymbols, ["repo::src/base.ts::B"], "only disappeared symbol deleted");
    assert.deepEqual(deletedVectors, ["repo::src/base.ts::B"], "disappeared symbol vectors deleted");
    assert.deepEqual(droppedFiles, ["src/base.ts"], "stale buffered relationships dropped");
  });

  it("deletes every existing symbol when the new analysis is empty", async () => {
    const deletedSymbols: string[] = [];
    const clearedOutgoing: string[] = [];

    const deps = {
      graphRepository: {
        listSymbolIdsByFile: async () => ["repo::src/empty.ts::A"],
        deleteRelationships: async (ids: string[]) => { clearedOutgoing.push(...ids); },
        deleteSymbols: async (ids: string[]) => { deletedSymbols.push(...ids); },
      },
      vectorRepository: { deleteVectors: async () => {} },
    };

    const result = await synchronizeFileSymbols(
      deps as any,
      "repo",
      "src/empty.ts",
      [],
      createLogger("test"),
    );

    assert.deepEqual(result, { kept: 0, removed: 1 });
    assert.deepEqual(clearedOutgoing, [], "no outgoing edges to clear when nothing survives");
    assert.deepEqual(deletedSymbols, ["repo::src/empty.ts::A"]);
  });
});

describe("PendingRelationshipStore.dropFile", () => {
  it("removes buffered relationships whose source symbol lives in the file", () => {
    const store = new PendingRelationshipStore({} as any, {} as any, {} as any);

    store.add("repo", [
      rel("keep", "repo::src/other.ts::X", "repo::src/base.ts::A"),
      rel("drop-pending", "repo::src/base.ts::A", "repo::src/other.ts::X"),
      rel("keep2", "repo::src/base.tsx::C", "repo::src/other.ts::X"),
    ]);

    store.dropFile("repo", "src/base.ts");

    const remaining = (store as any).pending.get("repo") as Relationship[];
    assert.deepEqual(
      remaining.map((r) => r.id),
      ["keep", "keep2"],
      "only relationships sourced in src/base.ts are dropped",
    );
  });

  it("does not touch relationships from other files with similar paths", () => {
    const store = new PendingRelationshipStore({} as any, {} as any, {} as any);

    store.add("repo", [
      rel("a", "repo::src/base.py::A", "repo::src/x.py::X"),
      rel("b", "repo::src/base.py.bak::B", "repo::src/x.py::X"),
    ]);

    store.dropFile("repo", "src/base.py");

    const remaining = (store as any).pending.get("repo") as Relationship[];
    assert.deepEqual(remaining.map((r) => r.id), ["b"], "::src/base.py.bak:: is not ::src/base.py::");
  });
});
