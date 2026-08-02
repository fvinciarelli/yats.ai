import type { SymbolKind, RelationshipKind, Language } from "./enums.js";

// ============================================================
// Source location — where a symbol lives in a repository
// ============================================================

/** Pinpoints a symbol to a specific file and line range */
export interface SourceLocation {
  /** Repository identifier */
  repository: string;
  /** Path relative to the repository root */
  relativePath: string;
  /** Starting line (1-indexed) */
  startLine: number;
  /** Ending line (1-indexed) */
  endLine: number;
  /** Starting column (0-indexed) */
  startColumn: number;
  /** Ending column (0-indexed) */
  endColumn: number;
}

// ============================================================
// Core Symbol — the universal representation of a code element
// ============================================================

/**
 * Every language analyzer emits Symbol objects conforming to this shape.
 * The `id` field uses the format `{repository}::{relativePath}::{symbolPath}`
 * to guarantee global uniqueness.
 */
export interface Symbol {
  /** Universally unique ID: `{repository}::{relativePath}::{symbolPath}` */
  id: string;
  /** Human-readable name (the last segment of the symbol path) */
  name: string;
  /** What kind of symbol this is */
  kind: SymbolKind;
  /** Where this symbol lives in the repository */
  location: SourceLocation;
  /** Source language */
  language: Language;
  /** Fully qualified namespace or module path */
  namespace: string;
  /** If a member, the name of the parent class/struct/interface */
  parentClass: string | null;
  /** Function/method signature (type annotations preserved but without body) */
  signature: string | null;
  /** Documentation comment (JSDoc, docstring, XML doc, etc.) */
  docComment: string | null;
  /** First portion of the implementation source code (for embedding) */
  sourceSnippet: string;
  /** SHA256 of sourceSnippet — used for change detection */
  contentHash: string;
  /** Arbitrary key-value metadata injected by the language analyzer */
  metadata: Record<string, unknown>;
}

// ============================================================
// Relationship — a directed edge between two symbols
// ============================================================

/**
 * Represents a directed relationship between two symbols in the graph.
 */
export interface Relationship {
  /** Unique identifier for this relationship */
  id: string;
  /** The source symbol ID (from) */
  sourceSymbolId: string;
  /** The target symbol ID (to) */
  targetSymbolId: string;
  /** What kind of relationship this is */
  kind: RelationshipKind;
  /** Extra metadata (line numbers, confidence, etc.) */
  metadata: Record<string, unknown>;
}
