/**
 * Repository path canonicalization.
 *
 * YATS identifies a repository by the *string* of its root path, and that
 * string can arrive written in many equivalent ways (Windows backslashes,
 * Git Bash `/c/...`, trailing slashes, `\\?\` prefixes, relative `.`). Every
 * spelling of the same folder must map to the same identity, otherwise the
 * same repo ends up indexed twice and queries only see half the symbols.
 *
 * The canonical form is: absolute, forward slashes, uppercase drive letter,
 * no trailing slash (except `C:/` and `/`). Case is preserved — comparisons
 * that need to ignore case use `repoPathKey()`.
 *
 * This function is pure: it never touches the filesystem, so the server (which
 * runs in a container without host paths) can canonicalize exactly like the
 * host CLI does.
 */

import { posix, win32 } from "node:path";

export interface CanonicalPathOptions {
  /** Platform that owns the path. Defaults to the running platform. */
  platform?: NodeJS.Platform | string;
  /** Base directory for relative inputs. Defaults to the host cwd when the path style matches it. */
  cwd?: string;
}

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC = /^\\\\[^\\]/;

/** True when the string is written as a Windows path (drive or UNC). */
export function isWindowsPath(value: string): boolean {
  return WINDOWS_DRIVE.test(value) || WINDOWS_UNC.test(value);
}

/** Strip `\\?\` / `\\.\` device prefixes (long-path and device APIs). */
function stripDevicePrefix(value: string): string {
  return value
    .replace(/^\\\\\?\\/, "")
    .replace(/^\/\/\?\//, "")
    .replace(/^\\\\\.\\/, "")
    .replace(/^\/\/\.\//, "");
}

/**
 * Canonical repository path.
 *
 * `canonicalRepoPath("C:\\Users\\me\\repo\\")` → `"C:/Users/me/repo"`
 * `canonicalRepoPath("/c/Users/me/repo", { platform: "win32" })` → `"C:/Users/me/repo"`
 * `canonicalRepoPath(".")` (cwd `/home/me/repo`) → `"/home/me/repo"`
 */
export function canonicalRepoPath(
  input: string,
  options: CanonicalPathOptions = {},
): string {
  const platform = options.platform ?? process.platform;
  let value = (input ?? "").trim();
  if (!value) return "";

  value = stripDevicePrefix(value);

  // MSYS/Cygwin drive spelling (Git Bash): "/c/Users/..." is "C:/Users/...".
  // Only translate on Windows hosts: on Linux "/c/foo" is a real directory.
  if (platform === "win32") {
    value = value.replace(/^\/([A-Za-z])(?=\/)/, (_m, drive: string) => `${drive.toUpperCase()}:`);
  }

  // Treat backslashes as separators before deciding the style: a Windows path
  // written with forward slashes ("C:/x") is still a Windows path.
  value = value.replace(/\\/g, "/");

  const isWindows = platform === "win32" || isWindowsPath(value);
  const p = isWindows ? win32 : posix;

  const hostMatchesStyle = isWindows === (process.platform === "win32");
  const cwd = options.cwd ?? (hostMatchesStyle ? process.cwd() : undefined);
  if (cwd && !p.isAbsolute(value)) {
    value = p.resolve(cwd.replace(/\\/g, "/"), value);
  }

  let out = p.normalize(value).replace(/\\/g, "/");

  // UNC paths keep their leading "//" and are case-sensitive in the share name;
  // only the drive letter of drive paths is normalized.
  if (!out.startsWith("//")) {
    out = out.replace(/^([a-z]):/, (_m, drive: string) => `${drive.toUpperCase()}:`);
  }

  // Drop trailing separators ("/a/b/" → "/a/b"), keeping filesystem roots.
  if (out.length > 1 && !/^[A-Za-z]:\/$/.test(out) && out !== "//") {
    out = out.replace(/\/+$/, "");
  }

  return out;
}

/**
 * Identity key for a repository path.
 *
 * Case is folded on case-insensitive filesystems (Windows, macOS) — and for
 * Windows-style paths regardless of the platform doing the comparison, so the
 * Linux server matches what a Windows host indexed. The stored `rootPath` keeps
 * the user's original capitalization for display; POSIX paths keep their case
 * because `/home/me/Repo` and `/home/me/repo` are different folders there.
 */
export function repoPathKey(input: string, options: CanonicalPathOptions = {}): string {
  const canonical = canonicalRepoPath(input, options);
  const platform = options.platform ?? process.platform;
  const caseInsensitive =
    platform === "win32" || platform === "darwin" || isWindowsPath(canonical);
  return caseInsensitive ? canonical.toLowerCase() : canonical;
}
