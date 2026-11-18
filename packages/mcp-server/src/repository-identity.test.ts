/**
 * Tests — repository identity decisions (/index + list_repositories).
 *
 * The same folder can be spelled many ways (Windows backslashes, Git Bash
 * `/c/...`, trailing slashes, relative `.`). These decisions are what stop the
 * index from being split in two when a shell, the IDE task or an agent sends a
 * different spelling than the one used to index.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  decideRegistration,
  markDuplicateRepositories,
  uniqueRepositoryName,
} from "./repository-identity.js";

describe("decideRegistration — /index", () => {
  it("registers a brand-new repository under its canonical path", () => {
    const decision = decideRegistration("/home/me/repo/", null);

    assert.equal(decision.repository, "/home/me/repo");
    assert.equal(decision.register, true);
    assert.equal(decision.warning, undefined);
  });

  it("never rewrites the rootPath of an existing repository", () => {
    // Legacy entry indexed before canonicalization existed.
    const existing = { name: "repo", rootPath: "/home/me/repo/" };
    const decision = decideRegistration("/home/me/repo", existing);

    assert.equal(decision.repository, "/home/me/repo/", "symbol IDs are keyed by this prefix");
    assert.equal(decision.register, false);
    assert.match(decision.warning ?? "", /already indexed as "\/home\/me\/repo\/"/);
  });

  it("is a silent no-op when the spelling already matches", () => {
    const existing = { name: "repo", rootPath: "/home/me/repo" };
    const decision = decideRegistration("/home/me/repo/", existing);

    assert.equal(decision.repository, "/home/me/repo");
    assert.equal(decision.register, false);
    assert.equal(decision.warning, undefined);
  });

  it("treats `yats index .` as an absolute path", () => {
    // `decideRegistration` receives the already-resolved CLI path; a raw "."
    // must stay "legacy-looking" instead of resolving against the server cwd.
    const decision = decideRegistration(".", null);
    assert.equal(decision.repository, ".");
  });
});

describe("markDuplicateRepositories — list_repositories", () => {
  it("flags repos that index the same folder under another spelling", () => {
    const repos = [
      { name: "repo", rootPath: "/home/me/repo" },
      { name: "repo", rootPath: "/home/me/repo/" },
      { name: "other", rootPath: "/home/me/other" },
    ];

    const result = markDuplicateRepositories(repos);

    assert.equal(result[0]?.duplicateOf, "/home/me/repo/");
    assert.equal(result[1]?.duplicateOf, "/home/me/repo");
    assert.equal(result[2]?.duplicateOf, undefined);
  });

  it("does not flag distinct POSIX paths that differ only in case", () => {
    const repos = [
      { name: "Repo", rootPath: "/home/me/Repo" },
      { name: "repo", rootPath: "/home/me/repo" },
    ];

    const result = markDuplicateRepositories(repos);

    assert.equal(result[0]?.duplicateOf, undefined);
    assert.equal(result[1]?.duplicateOf, undefined);
  });

  it("leaves a single repository untouched", () => {
    const result = markDuplicateRepositories([{ name: "r", rootPath: "/home/me/r" }]);
    assert.deepEqual(result, [{ name: "r", rootPath: "/home/me/r" }]);
  });
});

describe("uniqueRepositoryName — repository_name_unique constraint", () => {
  it("keeps the basename when it is free", () => {
    assert.equal(uniqueRepositoryName("app", "/work/app", []), "app");
  });

  it("falls back to parent/basename when another clone owns the name", () => {
    const taken = [{ name: "app", rootPath: "/work/app" }];
    assert.equal(uniqueRepositoryName("app", "/home/me/app", taken), "me/app");
  });

  it("falls back to the full path when the parent segment also collides", () => {
    const taken = [
      { name: "app", rootPath: "/work/me/app" },
      { name: "me/app", rootPath: "/other/me/app" },
    ];
    assert.equal(uniqueRepositoryName("app", "/home/me/app", taken), "/home/me/app");
  });

  it("never collides with itself on re-registration", () => {
    const taken = [{ name: "app", rootPath: "/work/app" }];
    assert.equal(uniqueRepositoryName("app", "/work/app", taken), "app");
  });
});
