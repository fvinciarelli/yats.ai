/**
 * Tests — P4: CLI-side config respect (indexer.js helpers).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadYatsEnv, shouldSkipFile, DEFAULT_DOC_EXTENSIONS } from "./indexer.js";

describe("loadYatsEnv", () => {
  let dir;
  let envPath;

  before(() => {
    dir = join(tmpdir(), `yats-env-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    envPath = join(dir, ".env");
    writeFileSync(
      envPath,
      "# comment line\n" +
      "DOC_EXTENSIONS=.md,.rst\n" +
      "IGNORED_DIRS=node_modules,dist,vendor\n" +
      "SKIP_EXTENSIONS=.min.js,.lock\n" +
      "EMPTY_VALUE=\n" +
      "NO_EQUALS_SIGN\n",
    );
  });

  after(() => {
    try { rmSync(dir, { recursive: true }); } catch {}
  });

  it("parses KEY=VALUE lines and ignores comments and malformed lines", () => {
    const env = loadYatsEnv(envPath);
    assert.equal(env.DOC_EXTENSIONS, ".md,.rst");
    assert.equal(env.IGNORED_DIRS, "node_modules,dist,vendor");
    assert.equal(env.SKIP_EXTENSIONS, ".min.js,.lock");
    assert.equal(env.EMPTY_VALUE, "");
    assert.equal(env.NO_EQUALS_SIGN, undefined);
  });

  it("returns an empty object when the file is missing", () => {
    const env = loadYatsEnv(join(dir, "does-not-exist.env"));
    assert.deepEqual(env, {});
  });
});

describe("shouldSkipFile", () => {
  const docExtensions = DEFAULT_DOC_EXTENSIONS
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

  it("skips only .md when skipDocs is false", () => {
    assert.equal(shouldSkipFile("README.md", { skipDocs: false, docExtensions }), false);
  });

  it("skips every DOC_EXTENSIONS file with --skip-docs, not only .md (P4)", () => {
    for (const ext of docExtensions) {
      assert.equal(
        shouldSkipFile(`docs/guide${ext}`, { skipDocs: true, docExtensions }),
        true,
        `docs/guide${ext} should be skipped`,
      );
    }
    assert.equal(
      shouldSkipFile("src/code.py", { skipDocs: true, docExtensions }),
      false,
      "code files are never skipped by --skip-docs",
    );
  });

  it("skips SKIP_EXTENSIONS suffixes including compound ones like .min.js", () => {
    const skipExtensions = [".min.js", ".lock"];
    assert.equal(shouldSkipFile("app.min.js", { skipExtensions }), true);
    assert.equal(shouldSkipFile("yarn.lock", { skipExtensions }), true);
    assert.equal(shouldSkipFile("app.js", { skipExtensions }), false);
  });

  it("is case-insensitive", () => {
    assert.equal(
      shouldSkipFile("README.MD", { skipDocs: true, docExtensions }),
      true,
    );
  });
});
