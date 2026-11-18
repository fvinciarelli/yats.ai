/**
 * Tests — repository path canonicalization (mirror of the shared TS util).
 *
 * YATS identifies repos by the string of their root path, so every spelling of
 * the same folder must produce the same identity: backslashes, Git Bash
 * `/c/...`, trailing slashes, `\\?\` prefixes and relative `.`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { canonicalRepoPath, isWindowsPath, repoPathKey } from "./repo-path.js";

describe("canonicalRepoPath — Windows spellings collapse to one identity", () => {
  const win = { platform: "win32" };

  it("normalizes drive, separators and trailing slash", () => {
    assert.equal(canonicalRepoPath("C:\\Users\\me\\repo\\", win), "C:/Users/me/repo");
    assert.equal(canonicalRepoPath("c:/users/me/repo", win), "C:/users/me/repo");
    assert.equal(canonicalRepoPath("C:/Users/me/repo/.", win), "C:/Users/me/repo");
    assert.equal(canonicalRepoPath("C:\\Users\\me\\repo\\\\sub\\..", win), "C:/Users/me/repo");
  });

  it("translates the Git Bash (MSYS) drive form", () => {
    assert.equal(canonicalRepoPath("/c/Users/me/repo", win), "C:/Users/me/repo");
    assert.equal(canonicalRepoPath("/C/Users/me/repo/", win), "C:/Users/me/repo");
  });

  it("strips \\\\?\\ extended-length prefixes", () => {
    assert.equal(canonicalRepoPath("\\\\?\\C:\\Users\\me\\repo", win), "C:/Users/me/repo");
  });

  it("resolves relative paths against the given cwd", () => {
    assert.equal(canonicalRepoPath(".", { ...win, cwd: "C:\\repo" }), "C:/repo");
    assert.equal(canonicalRepoPath("..", { ...win, cwd: "C:\\repo\\sub" }), "C:/repo");
  });

  it("keeps UNC shares with a single leading double slash", () => {
    assert.equal(canonicalRepoPath("\\\\server\\share\\repo", win), "//server/share/repo");
  });

  it("keeps the drive root without a trailing slash", () => {
    assert.equal(canonicalRepoPath("C:\\", win), "C:/");
  });

  it("does not rewrite the case of path components", () => {
    assert.equal(canonicalRepoPath("C:\\Users\\Franco\\MiRepo", win), "C:/Users/Franco/MiRepo");
  });
});

describe("canonicalRepoPath — POSIX paths", () => {
  const linux = { platform: "linux" };

  it("resolves relatives and drops the trailing slash", () => {
    assert.equal(canonicalRepoPath("/home/me/repo/", linux), "/home/me/repo");
    assert.equal(canonicalRepoPath("/home/me/repo/../repo", linux), "/home/me/repo");
    assert.equal(canonicalRepoPath(".", { ...linux, cwd: "/home/me/repo" }), "/home/me/repo");
  });

  it("does not treat /c/... as a Windows drive on Linux", () => {
    assert.equal(canonicalRepoPath("/c/foo", linux), "/c/foo");
  });

  it("is idempotent", () => {
    for (const input of ["/home/me/repo", "C:\\Users\\me\\repo\\", "/c/Users/me/repo"]) {
      const platform = input.startsWith("/c/") ? "win32" : "linux";
      const once = canonicalRepoPath(input, { platform });
      const twice = canonicalRepoPath(once, { platform });
      assert.equal(twice, once);
    }
  });
});

describe("repoPathKey — case-insensitive identity", () => {
  it("folds case so Windows spellings of the same folder match", () => {
    const a = repoPathKey("C:\\Users\\Franco\\MiRepo", { platform: "win32" });
    const b = repoPathKey("/c/users/franco/mirepo", { platform: "win32" });
    assert.equal(a, b);
  });

  it("keeps POSIX paths distinct when they differ in case", () => {
    assert.notEqual(
      repoPathKey("/home/me/Repo", { platform: "linux" }),
      repoPathKey("/home/me/repo", { platform: "linux" }),
    );
  });
});

describe("isWindowsPath", () => {
  it("detects drives and UNC, not POSIX paths", () => {
    assert.equal(isWindowsPath("C:\\Users"), true);
    assert.equal(isWindowsPath("C:/Users"), true);
    assert.equal(isWindowsPath("\\\\server\\share"), true);
    assert.equal(isWindowsPath("/home/me"), false);
    assert.equal(isWindowsPath("./relative"), false);
  });
});
