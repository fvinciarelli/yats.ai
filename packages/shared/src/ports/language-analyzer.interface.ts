import type { Symbol } from "../domain/models.js";
import type { Relationship } from "../domain/models.js";
import type { Language } from "../domain/enums.js";

export interface AnalysisError {
  line: number;
  column: number;
  message: string;
  severity: "error" | "warning";
}

export interface AnalysisResult {
  symbols: Symbol[];
  relationships: Relationship[];
  errors: AnalysisError[];
  warnings: AnalysisError[];
}

export interface LanguageAnalyzer {
  readonly language: Language;
  canAnalyze(filePath: string, content: string): boolean;
  analyze(filePath: string, content: string, repositoryName: string): Promise<AnalysisResult>;

  /**
   * Optional: analyze multiple files in a single invocation.
   * Implement for subprocess-based analyzers (Python, Go, C#, PHP) to avoid
   * per-file spawn overhead. The IndexerService prefers this over per-file
   * analyze() when available.
   */
  analyzeBatch?(
    files: Array<{ filePath: string; content: string }>,
    repositoryName: string,
  ): Promise<AnalysisResult[]>;
}
