/**
 * Tests — P4: CLI-side config respect (indexer.js helpers).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  loadYatsEnv,
  shouldSkipFile,
  loadRepoConfig,
  validateRepoConfig,
  mergeRepoConfig,
  configErrorText,
  DEFAULT_DOC_EXTENSIONS,
} from "./indexer.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const SETUP_JS = join(__dirname, "..", "bin", "setup.js");

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

describe(".yats/config.json — repo config (P6)", () => {
  let repo;

  before(() => {
    repo = join(tmpdir(), `yats-repo-config-test-${Date.now()}`);
    mkdirSync(join(repo, ".yats"), { recursive: true });
  });

  after(() => {
    try { rmSync(repo, { recursive: true }); } catch {}
  });

  function writeConfig(content) {
    writeFileSync(join(repo, ".yats", "config.json"), content);
  }

  it("returns defaults when the file does not exist", () => {
    const res = loadRepoConfig(repo);
    assert.equal(res.ok, true);
    assert.equal(res.exists, false);
    assert.deepEqual(res.config, {});
  });

  it("loads a valid config", () => {
    writeConfig(JSON.stringify({
      indexDocs: false,
      docExtensions: [".md"],
      docPatterns: ["docs/", "README.md"],
      ignoredDirs: ["sandbox"],
      skipExtensions: [".snap"],
    }));
    const res = loadRepoConfig(repo);
    assert.equal(res.ok, true);
    assert.equal(res.exists, true);
    assert.equal(res.config.indexDocs, false);
    assert.deepEqual(res.config.docPatterns, ["docs/", "README.md"]);
  });

  it("rejects malformed JSON with a clear error", () => {
    writeConfig("{ not json");
    const res = loadRepoConfig(repo);
    assert.equal(res.ok, false);
    assert.ok(res.error.includes("not valid JSON"), `error should mention JSON: ${res.error}`);
  });

  it("rejects wrong types with a clear error", () => {
    writeConfig(JSON.stringify({ indexDocs: "no", ignoredDirs: "sandbox", docPatterns: [1] }));
    const res = loadRepoConfig(repo);
    assert.equal(res.ok, false);
    assert.ok(res.error.includes("indexDocs"), `error should mention indexDocs: ${res.error}`);
    assert.ok(res.error.includes("ignoredDirs"), `error should mention ignoredDirs: ${res.error}`);
    assert.ok(res.error.includes("docPatterns"), `error should mention docPatterns: ${res.error}`);
  });

  it("rejects non-object roots", () => {
    writeConfig("[1,2,3]");
    const res = validateRepoConfig("[1,2,3]");
    assert.equal(res.ok, false);
    assert.ok(res.error.includes("object"));
  });

  it("configErrorText tells the AI client how to fix and retry", () => {
    const text = configErrorText("/repo", "/repo/.yats/config.json", "not valid JSON: Unexpected token");
    assert.ok(text.includes("Invalid repo config"), "names the problem");
    assert.ok(text.includes("not valid JSON"), "includes the specific error");
    assert.ok(text.includes("yats index /repo"), "gives the exact re-run command");
    assert.ok(text.includes("--no-config"), "offers the bypass flag");
    assert.ok(text.includes("Delete the file"), "offers falling back to defaults");
    assert.ok(text.includes('"docPatterns"'), "shows the schema");
  });
});

describe("mergeRepoConfig — machine vs repo (P6)", () => {
  const globalEnv = {
    DOC_EXTENSIONS: ".md,.rst",
    SKIP_EXTENSIONS: ".lock,.min.js",
    IGNORED_DIRS: "vendor,dist",
  };

  it("unions ignoredDirs and skipExtensions", () => {
    const m = mergeRepoConfig(globalEnv, {
      ignoredDirs: ["sandbox"],
      skipExtensions: [".snap"],
    });
    assert.deepEqual(m.ignoredDirs, ["vendor", "dist", "sandbox"]);
    assert.deepEqual(m.skipExtensions, [".lock", ".min.js", ".snap"]);
  });

  it("replaces docExtensions when the repo sets them (even empty)", () => {
    const replaced = mergeRepoConfig(globalEnv, { docExtensions: [".mdx"] });
    assert.deepEqual(replaced.docExtensions, [".mdx"]);

    const emptied = mergeRepoConfig(globalEnv, { docExtensions: [] });
    assert.deepEqual(emptied.docExtensions, [], "empty array disables docs for the repo");
  });

  it("keeps global docExtensions when the repo does not set them", () => {
    const m = mergeRepoConfig(globalEnv, {});
    assert.deepEqual(m.docExtensions, [".md", ".rst"]);
    assert.equal(m.docPatterns, null);
    assert.equal(m.indexDocs, true);
  });

  it("repo indexDocs:false turns docs off", () => {
    const m = mergeRepoConfig(globalEnv, { indexDocs: false });
    assert.equal(m.indexDocs, false);
  });
});

describe("shouldSkipFile — docPatterns whitelist (P6)", () => {
  const docExtensions = [".md"];

  it("only sends doc files matching a pattern (code files always sent)", () => {
    const opts = { docExtensions, docPatterns: ["docs/", "README.md"] };
    assert.equal(shouldSkipFile("docs/guide.md", opts), false, "docs/ matches");
    assert.equal(shouldSkipFile("README.md", opts), false, "README.md matches");
    assert.equal(shouldSkipFile("notes.md", opts), true, "notes.md is outside the whitelist");
    assert.equal(shouldSkipFile("src/main.ts", opts), false, "code is never filtered by docPatterns");
  });

  it("without patterns every doc file is sent", () => {
    assert.equal(shouldSkipFile("notes.md", { docExtensions, docPatterns: null }), false);
  });
});

describe("indexRepo — malformed config stops the run (P6)", () => {
  let repo;

  before(() => {
    repo = join(tmpdir(), `yats-broken-config-test-${Date.now()}`);
    mkdirSync(join(repo, ".yats"), { recursive: true });
  });

  after(() => {
    try { rmSync(repo, { recursive: true }); } catch {}
  });

  it("exits 1 with fix instructions before indexing anything", () => {
    writeFileSync(join(repo, ".yats", "config.json"), "{ broken json");
    try {
      execFileSync(process.execPath, [SETUP_JS, "index", repo], {
        encoding: "utf-8",
        stdio: "pipe",
      });
      assert.fail("should have exited non-zero");
    } catch (err) {
      assert.equal(err.status, 1);
      const out = `${err.stdout ?? ""}\n${err.stderr ?? ""}`;
      assert.ok(out.includes("Invalid repo config"), out);
      assert.ok(out.includes("yats index"), out);
      assert.ok(out.includes("--no-config"), out);
      // It must NOT even try to reach the server — config is checked first.
      assert.ok(!out.includes("Cannot reach YATS"), out);
    }
  });

  it("a valid config proceeds (fails later on the unreachable server)", () => {
    writeFileSync(join(repo, ".yats", "config.json"), JSON.stringify({ indexDocs: false }));
    try {
      execFileSync(process.execPath, [SETUP_JS, "index", repo], {
        encoding: "utf-8",
        stdio: "pipe",
        env: { ...process.env, YATS_URL: "http://127.0.0.1:1" },
      });
      assert.fail("should have exited non-zero");
    } catch (err) {
      assert.equal(err.status, 1);
      const out = `${err.stdout ?? ""}\n${err.stderr ?? ""}`;
      assert.ok(!out.includes("Invalid repo config"), out);
      assert.ok(out.includes("Cannot reach YATS"), out);
    }
  });
});
