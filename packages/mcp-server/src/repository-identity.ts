/**
 * Repository identity decisions shared by the HTTP index endpoint and the
 * `list_repositories` tool.
 *
 * YATS identifies a repository by the string of its root path, which arrives in
 * many equivalent spellings (Windows backslashes, Git Bash `/c/...`, trailing
 * slashes, relative `.`). Canonicalization lives in `@yats/shared`
 * (`canonicalRepoPath`/`repoPathKey`); this module turns it into the two
 * decisions the server needs: what to register and what to flag as duplicate.
 */

import { canonicalRepoPath, repoPathKey } from "@yats/shared";
import type { RepositoryInfo } from "@yats/shared";

export interface RegistrationDecision {
  /** rootPath to use for this indexing run (always an existing repo wins). */
  repository: string;
  /** True when the caller must register metadata for a brand-new repository. */
  register: boolean;
  /** Present when the folder was already indexed under another spelling. */
  warning?: string;
}

/**
 * Decide what `/index` should do for the path the host CLI sent.
 *
 * An existing repository always wins: never rewrite its `rootPath`, because
 * symbols are keyed by that prefix — renaming it would orphan the whole graph.
 */
export function decideRegistration(
  rawPath: string,
  existing: RepositoryInfo | null,
): RegistrationDecision {
  const canonical = canonicalRepoPath(rawPath, { cwd: "" });

  if (!existing) {
    return { repository: canonical, register: true };
  }

  if (existing.rootPath === canonical) {
    return { repository: existing.rootPath, register: false };
  }

  return {
    repository: existing.rootPath,
    register: false,
    warning:
      `This folder is already indexed as "${existing.rootPath}". ` +
      `Using that path so the index is not split; run 'yats remove "${existing.rootPath}"' ` +
      `if you want to re-index it under the canonical path.`,
  };
}

export interface RepositoryListing extends RepositoryInfo {
  /** Another stored rootPath that points at the same folder. */
  duplicateOf?: string;
}

/**
 * Flag repositories that index the same folder under different spellings
 * (legacy entries such as `"."` or a path with a trailing slash). Nothing is
 * merged automatically — the caller decides which entry to keep.
 */
export function markDuplicateRepositories(repos: RepositoryInfo[]): RepositoryListing[] {
  const byKey = new Map<string, string[]>();
  for (const repo of repos) {
    const key = repoPathKey(repo.rootPath, { cwd: "" });
    const paths = byKey.get(key) ?? [];
    paths.push(repo.rootPath);
    byKey.set(key, paths);
  }

  return repos.map((repo) => {
    const key = repoPathKey(repo.rootPath, { cwd: "" });
    const duplicateOf = (byKey.get(key) ?? []).find((p) => p !== repo.rootPath);
    return duplicateOf ? { ...repo, duplicateOf } : repo;
  });
}

/**
 * Repository display names are unique (`repository_name_unique` constraint).
 * Two clones with the same folder name (`/work/app` and `/home/me/app`) would
 * collide, and the registration used to fail *after* files were already
 * streamed — leaving symbols without a Repository node. Fall back to the last
 * two path segments and, if needed, the full canonical path.
 */
export function uniqueRepositoryName(
  desired: string,
  rootPath: string,
  taken: RepositoryInfo[],
): string {
  const isFree = (candidate: string) =>
    !taken.some((r) => r.name === candidate && r.rootPath !== rootPath);

  if (isFree(desired)) return desired;

  const segments = rootPath.split("/").filter(Boolean);
  const short = segments.slice(-2).join("/");
  if (short && isFree(short)) return short;

  if (isFree(rootPath)) return rootPath;

  // Last resort: numeric suffix (a repo literally named like another's path).
  for (let i = 2; i < 1000; i++) {
    const candidate = `${rootPath} (${i})`;
    if (isFree(candidate)) return candidate;
  }
  return rootPath;
}
