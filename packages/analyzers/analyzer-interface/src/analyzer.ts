import type { LanguageAnalyzer, AnalysisResult, AnalysisError } from "@yats/shared";
import type { Symbol, Relationship } from "@yats/shared";
import { Language } from "@yats/shared";
import { createSymbolId } from "@yats/shared";

// ============================================================
// Abstract base class for all language analyzers
// ============================================================

export abstract class AbstractAnalyzer implements LanguageAnalyzer {
  abstract readonly language: Language;

  abstract canAnalyze(filePath: string, content: string): boolean;

  abstract analyze(
    filePath: string,
    content: string,
    repositoryName: string,
  ): Promise<AnalysisResult>;

  // ============================================================
  // Shared helpers for all analyzers
  // ============================================================

  /** Generate a valid symbol ID */
  protected makeId(
    repository: string,
    relativePath: string,
    symbolPath: string,
  ): string {
    return createSymbolId(repository, relativePath, symbolPath);
  }

  /** Create a symbol with defaults */
  protected createSymbol(params: {
    id: string;
    name: string;
    kind: Symbol["kind"];
    language: Language;
    repository: string;
    relativePath: string;
    namespace?: string;
    parentClass?: string | null;
    signature?: string | null;
    docComment?: string | null;
    sourceSnippet?: string;
    contentHash?: string;
    startLine?: number;
    endLine?: number;
    startColumn?: number;
    endColumn?: number;
    metadata?: Record<string, unknown>;
  }): Symbol {
    return {
      id: params.id,
      name: params.name,
      kind: params.kind,
      language: params.language,
      location: {
        repository: params.repository,
        relativePath: params.relativePath,
        startLine: params.startLine ?? 1,
        endLine: params.endLine ?? 1,
        startColumn: params.startColumn ?? 0,
        endColumn: params.endColumn ?? 0,
      },
      namespace: params.namespace ?? "",
      parentClass: params.parentClass ?? null,
      signature: params.signature ?? null,
      docComment: params.docComment ?? null,
      sourceSnippet: params.sourceSnippet ?? "",
      contentHash: params.contentHash ?? "",
      metadata: params.metadata ?? {},
    };
  }

  /** Create a relationship */
  protected createRelationship(
    sourceSymbolId: string,
    targetSymbolId: string,
    kind: Relationship["kind"],
    metadata: Record<string, unknown> = {},
  ): Relationship {
    return {
      id: `${sourceSymbolId}--[${kind}]-->${targetSymbolId}`,
      sourceSymbolId,
      targetSymbolId,
      kind,
      metadata,
    };
  }

  /** Create a warning */
  protected warning(line: number, column: number, message: string): AnalysisError {
    return { line, column, message, severity: "warning" };
  }

  /** Create an error */
  protected error(line: number, column: number, message: string): AnalysisError {
    return { line, column, message, severity: "error" };
  }
}
