import type { LanguageAnalyzer, AnalysisResult, AnalysisError } from "@yats/shared";
import type { Symbol, Relationship } from "@yats/shared";
import { Language, createLogger } from "@yats/shared";
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

  // ============================================================
  // Subprocess-bridge visibility
  // ============================================================

  private _bridgeFailureCount = 0;
  private _bridgeFailureLoggedAt = 0;

  /**
   * Signal a subprocess-bridge failure in a way that is visible in the server
   * logs and in the analysis result. Every bridge analyzer falls back to a
   * regex analyzer when its subprocess dies (missing runtime deps, broken
   * binary, …) — falling back silently made degraded indexes look healthy
   * (e.g. the C# bridge crash without ICU produced "476 symbols, 4
   * relationships" with zero warnings).
   *
   * Logs the first failure and then at most once every 30s (rate-limited so
   * a medium repo produces one log line, not thousands). Returns a warning
   * entry the caller should append to the result's errors.
   */
  protected bridgeFailureWarning(bridge: string, err: unknown): AnalysisError {
    this._bridgeFailureCount++;
    const now = Date.now();
    const shouldLog =
      this._bridgeFailureCount === 1 || now - this._bridgeFailureLoggedAt > 30_000;
    if (shouldLog) {
      this._bridgeFailureLoggedAt = now;
      const detail = err instanceof Error ? err.message : String(err);
      createLogger(`analyzer:${bridge}`).warn(
        `Bridge "${bridge}" failed (${this._bridgeFailureCount} failures so far) — ` +
        `falling back to regex analysis. The graph will be degraded: no precise ` +
        `call targets, no convention kinds. Cause: ${detail.slice(0, 500)}`,
      );
    }
    return {
      line: 0,
      column: 0,
      severity: "warning",
      message: `Bridge "${bridge}" unavailable — used regex fallback (degraded analysis)`,
    };
  }
}
