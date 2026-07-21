// ============================================================
// Value Objects — domain primitives with validation
// ============================================================

/**
 * Branded type for symbol IDs.
 * Format: `{repository}::{relativePath}::{symbolPath}`
 */
export type SymbolId = string & { readonly __brand: "SymbolId" };

/**
 * Branded type for repository names.
 * Must be a non-empty, filesystem-safe string.
 */
export type RepositoryName = string & { readonly __brand: "RepositoryName" };

/**
 * Branded type for relationship IDs.
 */
export type RelationshipId = string & { readonly __brand: "RelationshipId" };

// ============================================================
// Factory functions with validation
// ============================================================

const SYMBOL_ID_PATTERN = /^.+::.+::.+$/;
const REPO_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

/**
 * Create a SymbolId from its components.
 * @throws If any component is empty
 */
export function createSymbolId(
  repository: string,
  relativePath: string,
  symbolPath: string,
): SymbolId {
  if (!repository || !relativePath || !symbolPath) {
    throw new Error(
      `Invalid symbol ID components: repo="${repository}", path="${relativePath}", symbol="${symbolPath}"`,
    );
  }
  const id = `${repository}::${relativePath}::${symbolPath}`;
  if (!SYMBOL_ID_PATTERN.test(id)) {
    throw new Error(`Invalid symbol ID format: ${id}`);
  }
  return id as SymbolId;
}

/**
 * Parse a SymbolId string into its components.
 */
export function parseSymbolId(id: SymbolId): {
  repository: string;
  relativePath: string;
  symbolPath: string;
} {
  const parts = id.split("::");
  if (parts.length < 3) {
    throw new Error(`Cannot parse symbol ID: ${id}`);
  }
  return {
    repository: parts[0]!,
    relativePath: parts[1]!,
    symbolPath: parts.slice(2).join("::"),
  };
}

/**
 * Validate and brand a repository name.
 */
export function createRepositoryName(name: string): RepositoryName {
  if (!REPO_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid repository name: "${name}". Must match ${REPO_NAME_PATTERN.source}`,
    );
  }
  return name as RepositoryName;
}
