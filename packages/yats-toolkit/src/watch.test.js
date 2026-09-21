/**
 * Tests — P1 commit-based watch.
 *
 * Covers parseNameStatus (git diff --name-status parsing) and applyDiff: a
 * commit with added/modified/deleted/renamed files must produce the right
 * HTTP calls to the YATS server (file/remove/complete/commit).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join } from "node:path";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";

import { parseNameStatus, applyDiff } from "./watch.js";
import { mergeRepoConfig } from "./indexer.js";

function git(cwd, cmd) {
  return execSync(`git ${cmd}`, { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
}

describe("parseNameStatus", () => {
  it("parses added, modified, deleted, and renamed lines", () => {
    const changes = parseNameStatus(
      "A\tsrc/new.ts\n" +
      "M\tsrc/edited.ts\n" +
      "D\tsrc/old.ts\n" +
      "R100\tsrc/before.ts\tsrc/after.ts\n",
    );
    assert.deepEqual(changes, {
      added: ["src/new.ts"],
      modified: ["src/edited.ts"],
      deleted: ["src/old.ts"],
      renamed: [{ from: "src/before.ts", to: "src/after.ts" }],
    });
  });

  it("unquotes paths with spaces and ignores blank lines", () => {
    const changes = parseNameStatus(
      '\nM\t"src/my file.ts"\nD\t"src/old dir/file.ts"\n\n',
    );
    assert.deepEqual(changes.added, []);
    assert.deepEqual(changes.modified, ["src/my file.ts"]);
    assert.deepEqual(changes.deleted, ["src/old dir/file.ts"]);
    assert.deepEqual(changes.renamed, []);
  });

  it("handles empty output", () => {
    assert.deepEqual(parseNameStatus(""), {
      added: [],
      modified: [],
      deleted: [],
      renamed: [],
    });
  });
});

describe("applyDiff — commit-based sync (P1)", () => {
  let workDir;
  let server;
  let requests = [];
  let baseUrl;
  let repoName;
  let v1;
  let v2;

  before(async () => {
    // Temp git repo with two commits covering every change kind
    workDir = join(tmpdir(), `yats-watch-test-${Date.now()}`);
    mkdirSync(workDir, { recursive: true });
    git(workDir, "init");
    git(workDir, "config user.email test@test.com");
    git(workDir, "config user.name Test");

    writeFileSync(join(workDir, "a.txt"), "one\n");
    writeFileSync(join(workDir, "b.txt"), "two\n");
    writeFileSync(join(workDir, "d.txt"), "four\n");
    git(workDir, "add -A");
    git(workDir, "commit -m 'v1'");
    v1 = git(workDir, "rev-parse HEAD");

    writeFileSync(join(workDir, "a.txt"), "one (modified)\n");
    writeFileSync(join(workDir, "c.txt"), "three\n");
    rmSync(join(workDir, "b.txt"));
    git(workDir, "mv d.txt e.txt");
    git(workDir, "add -A");
    git(workDir, "commit -m 'v2'");
    v2 = git(workDir, "rev-parse HEAD");

    // Fake YATS server that captures requests
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    repoName = workDir;
  });

  after(() => {
    server?.close();
    try { rmSync(workDir, { recursive: true }); } catch {}
  });

  it("streams exactly the changed files and records the new commit", async () => {
    await applyDiff(workDir, repoName, v1, v2, baseUrl);

    const byUrl = (path) => requests.filter((r) => r.url === path);

    const fileRequests = byUrl("/index/file");
    const sentPaths = fileRequests.map((r) => r.body.filePath).sort();
    assert.deepEqual(
      sentPaths,
      ["a.txt", "c.txt", "e.txt"],
      "modified + added + renamed-to files are sent",
    );
    // Content is sent for the modified file
    const aReq = fileRequests.find((r) => r.body.filePath === "a.txt");
    assert.equal(aReq.body.content, "one (modified)\n");
    assert.equal(aReq.body.repoName, repoName, "repository identity is the full path");

    const removeRequests = byUrl("/index/remove");
    const removedPaths = removeRequests.map((r) => r.body.path).sort();
    assert.deepEqual(
      removedPaths,
      ["b.txt", "d.txt"],
      "deleted and renamed-from files are removed",
    );

    const complete = byUrl("/index/complete");
    assert.equal(complete.length, 1, "relationships are finalized");
    assert.equal(complete[0].body.repository, repoName);

    const commit = byUrl("/index/commit");
    assert.equal(commit.length, 1, "new commit is recorded");
    assert.equal(commit[0].body.repository, repoName);
    assert.equal(commit[0].body.commit, v2);
  });

  it("reports no-op when HEAD did not change files", async () => {
    requests = [];
    await applyDiff(workDir, repoName, v2, v2, baseUrl);
    assert.equal(requests.filter((r) => r.url === "/index/file").length, 0);
    // The commit is still recorded (idempotent sync)
    assert.equal(requests.filter((r) => r.url === "/index/commit").length, 1);
  });

  it("applies the repo config: docs skipped when indexDocs=false (P6)", async () => {
    // New commit adding a doc file and a code file
    writeFileSync(join(workDir, "guide.md"), "# Guide\n");
    writeFileSync(join(workDir, "extra.txt"), "plain text\n");
    git(workDir, "add -A");
    git(workDir, "commit -m 'v3: add docs + code'");
    const v3 = git(workDir, "rev-parse HEAD");

    requests = [];
    const effective = mergeRepoConfig({}, { indexDocs: false, docExtensions: [".md"] });
    await applyDiff(workDir, repoName, v2, v3, baseUrl, effective);

    const sentPaths = requests
      .filter((r) => r.url === "/index/file")
      .map((r) => r.body.filePath)
      .sort();
    assert.deepEqual(
      sentPaths,
      ["extra.txt"],
      "doc files (.md) are skipped, code/plain files are sent",
    );
  });

  it("applies docPatterns: only whitelisted docs are sent (P6)", async () => {
    const v3 = git(workDir, "rev-parse HEAD");
    mkdirSync(join(workDir, "docs"), { recursive: true });
    writeFileSync(join(workDir, "docs", "api.md"), "# API\n");
    writeFileSync(join(workDir, "notes.md"), "# Notes\n");
    git(workDir, "add -A");
    git(workDir, "commit -m 'v4: more docs'");
    const v4 = git(workDir, "rev-parse HEAD");

    requests = [];
    const effective = mergeRepoConfig({}, { docExtensions: [".md"], docPatterns: ["docs/"] });
    await applyDiff(workDir, repoName, v3, v4, baseUrl, effective);

    const sentPaths = requests
      .filter((r) => r.url === "/index/file")
      .map((r) => r.body.filePath)
      .sort();
    assert.deepEqual(sentPaths, ["docs/api.md"], "only docs matching the whitelist are sent");
  });
});
