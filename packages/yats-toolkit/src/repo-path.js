/**
 * Repository path canonicalization — mirrors
 * `packages/shared/src/utils/repo-path.ts` (the package is published on its own
 * and must stay dependency-free, so the logic is duplicated here).
 *
 * Both copies are covered by the same table of assertions
 * (`src/repo-path.test.js` and `packages/shared/src/utils/repo-path.test.ts`);
 * if you change one, change the other.
 */

import { posix, win32 } from "node:path";

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC = /^\\\\[^\\]/;

/** True when the string is written as a Windows path (drive or UNC). */
export function isWindowsPath(value) {
  return WINDOWS_DRIVE.test(value) || WINDOWS_UNC.test(value);
}

function stripDevicePrefix(value) {
  return value
    .replace(/^\\\\\?\\/, "")
    .replace(/^\/\/\?\//, "")
    .replace(/^\\\\\.\\/, "")
    .replace(/^\/\/\.\//, "");
}

/**
 * Canonical repository path: absolute, forward slashes, uppercase drive
 * letter, no trailing slash (except filesystem roots). Case is preserved.
 *
 * @param {string} input
 * @param {{platform?: string, cwd?: string}} [options]
 */
export function canonicalRepoPath(input, options = {}) {
  const platform = options.platform ?? process.platform;
  let value = (input ?? "").trim();
  if (!value) return "";

  value = stripDevicePrefix(value);

  // MSYS/Cygwin drive spelling (Git Bash): "/c/Users/..." is "C:/Users/...".
  // Only translate on Windows hosts: on Linux "/c/foo" is a real directory.
  if (platform === "win32") {
    value = value.replace(/^\/([A-Za-z])(?=\/)/, (_m, drive) => `${drive.toUpperCase()}:`);
  }

  value = value.replace(/\\/g, "/");

  const isWindows = platform === "win32" || isWindowsPath(value);
  const p = isWindows ? win32 : posix;

  const hostMatchesStyle = isWindows === (process.platform === "win32");
  const cwd = options.cwd ?? (hostMatchesStyle ? process.cwd() : undefined);
  if (cwd && !p.isAbsolute(value)) {
    value = p.resolve(cwd.replace(/\\/g, "/"), value);
  }

  let out = p.normalize(value).replace(/\\/g, "/");

  if (!out.startsWith("//")) {
    out = out.replace(/^([a-z]):/, (_m, drive) => `${drive.toUpperCase()}:`);
  }

  if (out.length > 1 && !/^[A-Za-z]:\/$/.test(out) && out !== "//") {
    out = out.replace(/\/+$/, "");
  }

  return out;
}

/**
 * Identity key: case-folded on case-insensitive filesystems (Windows/macOS)
 * and for Windows-style paths. POSIX paths keep their case.
 */
export function repoPathKey(input, options = {}) {
  const canonical = canonicalRepoPath(input, options);
  const platform = options.platform ?? process.platform;
  const caseInsensitive =
    platform === "win32" || platform === "darwin" || isWindowsPath(canonical);
  return caseInsensitive ? canonical.toLowerCase() : canonical;
}
