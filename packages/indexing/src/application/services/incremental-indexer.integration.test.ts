/**
 * Integration tests — incremental indexing with git change detection.
 *
 * Verifies that IncrementalIndexerService correctly processes
 * added, modified, deleted, and renamed files based on git diff.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { AnalyzerFactory } from "@yats/analyzer-interface";
import { SimpleGitAdapter } from "@yats/infra";
import { IncrementalIndexerService } from "./incremental-indexer.service.js";
import { FileWalker } from "../../infrastructure/file-walker.js";
import type { Symbol, Relationship } from "@yats/shared";
import { SymbolKind } from "@yats/shared";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "..", "..", "..", "..", "test", "fixtures");

// ============================================================
// Helpers
// ============================================================

function git(cwd: string, cmd: string): string {
  return execSync(`git ${cmd}`, { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
}

function gitInit(cwd: string) {
  execSync("git init", { cwd, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd, stdio: "pipe" });
  execSync("git config user.name Test", { cwd, stdio: "pipe" });
}

function makeMockDeps(repoPath: string) {
  const storedSymbols: Symbol[] = [];
  const storedVectors: any[] = [];
  const storedRels: Relationship[] = [];

  return {
    storedSymbols,
    storedVectors,
    storedRels,
    graphRepository: {
      upsertSymbols: async (syms: Symbol[]) => { storedSymbols.push(...syms); },
      upsertRelationships: async (rels: Relationship[]) => { storedRels.push(...rels); },
      deleteSymbols: async (_ids: string[]) => {},
      listSymbols: async () => storedSymbols.map((s) => ({
        ...s,
        nodeId: 0,
        labels: [],
      })),
      upsertRepositoryMetadata: async () => {},
      setLastIndexedCommit: async () => {},
      getLastIndexedCommit: async () => null,
      clearRepository: async () => { storedSymbols.length = 0; storedRels.length = 0; },
      findRepositoryByPath: async () => null,
      listRepositories: async () => [],
      findSymbol: async () => null,
      findSymbolByName: async () => [],
      findReferences: async () => [],
      findCallers: async () => [],
      findCallees: async () => [],
      findImplementations: async () => [],
      findInheritors: async () => [],
      findTests: async () => [],
      findRoutes: async () => [],
      findConfiguration: async () => [],
      expandGraph: async () => ({ nodes: [], relationships: [] }),
      relatedSymbols: async () => [],
      repositorySummary: async () => ({ repository: "", totalSymbols: 0, totalRelationships: 0, symbolsByKind: {}, symbolsByLanguage: {}, languages: [] }),
    },
    vectorRepository: {
      upsertVectors: async (pts: any[]) => { storedVectors.push(...pts); },
      deleteVectors: async (_ids: string[]) => {},
      clearVectorsByRepository: async () => {},
      search: async () => [],
      searchWithFilters: async () => [],
    },
    embeddingGenerator: {
      embedBatch: async (texts: string[]) => texts.map(() => new Array(768).fill(0.1)),
      embed: async () => new Array(768).fill(0.1),
      isAvailable: async () => true,
    },
    fileSystem: {
      readFile: async (path: string) => readFileSync(path, "utf-8"),
      exists: async (path: string) => { try { readFileSync(path); return true; } catch { return false; } },
      resolvePath: async (_root: string, relative: string) => join(repoPath, relative),
      listFiles: async () => [],
      writeFile: async () => {},
      createFile: async () => {},
      deleteFile: async () => {},
      updateFile: async () => {},
    },
  };
}

// ============================================================
// Incremental Indexer — git-based change detection
// ============================================================

describe("IncrementalIndexer — git integration", () => {
  let workDir: string;
  let factory: AnalyzerFactory;
  let gitAdapter: SimpleGitAdapter;
  let initialCommit: string;

  before(async () => {
    // Create temp git repo with TypeScript fixtures
    workDir = join(tmpdir(), `yats-incr-test-${Date.now()}`);
    mkdirSync(join(workDir, "src"), { recursive: true });

    // Copy TS fixture files
    const tsDir = join(FIXTURES_DIR, "typescript", "src");
    for (const f of ["user.service.ts", "user.controller.ts"]) {
      cpSync(join(tsDir, f), join(workDir, "src", f));
    }

    gitInit(workDir);
    git(workDir, "add -A");
    git(workDir, "commit -m 'initial: user service and controller'");
    initialCommit = git(workDir, "rev-parse HEAD");

    // Register TypeScript analyzer
    const { TypeScriptAnalyzer } = await import("@yats/analyzer-typescript");
    factory = new AnalyzerFactory();
    factory.register(new TypeScriptAnalyzer());

    gitAdapter = new SimpleGitAdapter();
  });

  after(() => {
    try { rmSync(workDir, { recursive: true }); } catch {}
  });

  it("detects no changes at initial commit", async () => {
    const files = await gitAdapter.getChangedFiles(workDir, initialCommit);
    assert.equal(files.length, 0, "no files should have changed since initial commit");
  });

  it("detects added files", async () => {
    // Add a new file
    writeFileSync(
      join(workDir, "src", "new.service.ts"),
      `export class NewService {\n  doThing(): void {}\n}\n`,
    );
    git(workDir, "add -A");
    git(workDir, "commit -m 'add new service'");

    const files = await gitAdapter.getChangedFiles(workDir, initialCommit);
    const added = files.filter((f) => f.status === "added");
    assert.ok(added.length >= 1, "should detect at least one added file");
    assert.ok(added.some((f) => f.path.includes("new.service.ts")), "new.service.ts should be in added files");
  });

  it("detects modified files", async () => {
    // Modify an existing file
    const original = readFileSync(join(workDir, "src", "user.service.ts"), "utf-8");
    writeFileSync(
      join(workDir, "src", "user.service.ts"),
      original + "\n// MODIFIED: added comment\n",
    );
    git(workDir, "add -A");
    git(workDir, "commit -m 'modify user service'");

    const files = await gitAdapter.getChangedFiles(workDir, initialCommit);
    const modified = files.filter((f) => f.status === "modified");
    assert.ok(modified.some((f) => f.path.includes("user.service.ts")), "user.service.ts should be modified");
  });

  it("detects deleted files", async () => {
    // Create and commit a file, then delete and commit — diff between the two commits
    writeFileSync(
      join(workDir, "src", "temp.service.ts"),
      `export class TempService {\n  run(): void {}\n}\n`,
    );
    git(workDir, "add -A");
    git(workDir, "commit -m 'add temp service'");
    const commitBeforeDelete = git(workDir, "rev-parse HEAD");

    rmSync(join(workDir, "src", "temp.service.ts"));
    git(workDir, "add -A");
    git(workDir, "commit -m 'delete temp service'");

    const files = await gitAdapter.getChangedFiles(workDir, commitBeforeDelete);
    const deleted = files.filter((f) => f.status === "deleted");
    assert.ok(deleted.some((f) => f.path.includes("temp.service.ts")), "temp.service.ts should be deleted");
  });

  it("incremental index processes changed files", async () => {
    const deps = makeMockDeps(workDir);
    const indexer = new IncrementalIndexerService({
      ...deps,
      analyzerFactory: factory,
      gitAdapter,
    } as any);

    // Get commit before our modification
    const beforeModify = git(workDir, "rev-parse HEAD");

    // Make a modification so we have something to incrementally index
    const original = readFileSync(join(workDir, "src", "user.controller.ts"), "utf-8");
    writeFileSync(
      join(workDir, "src", "user.controller.ts"),
      original + "\nexport class ExtraController {\n  ping(): string { return 'pong'; }\n}\n",
    );
    git(workDir, "add -A");
    git(workDir, "commit -m 'add ExtraController'");

    // Index from before the modification — should only see the changed file
    const result = await indexer.indexSince(workDir, "test-fixtures", beforeModify);

    assert.ok(result.symbolsFound > 0, "should find some symbols from the changed file");
    assert.ok(deps.storedSymbols.length > 0, "symbols should be stored");

    // The changed user.controller.ts should be in the stored symbols
    const controllerSyms = deps.storedSymbols.filter((s) =>
      s.location.relativePath.includes("user.controller.ts"),
    );
    assert.ok(controllerSyms.length > 0, "modified controller should be re-indexed");
  });
});
