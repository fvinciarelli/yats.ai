import { Language } from "@yats/shared";
import type { LanguageAnalyzer } from "@yats/shared";

// ============================================================
// Analyzer Factory — registers analyzers and dispatches by language
// ============================================================

/** Mapping from file extension to Language */
const EXTENSION_MAP: Record<string, Language> = {
  ".ts": Language.TYPESCRIPT,
  ".tsx": Language.TYPESCRIPT,
  ".mts": Language.TYPESCRIPT,
  ".cts": Language.TYPESCRIPT,
  ".js": Language.JAVASCRIPT,
  ".jsx": Language.JAVASCRIPT,
  ".mjs": Language.JAVASCRIPT,
  ".cjs": Language.JAVASCRIPT,
  ".cs": Language.CSHARP,
  ".csx": Language.CSHARP,
  ".php": Language.PHP,
  ".phtml": Language.PHP,
  ".py": Language.PYTHON,
  ".pyi": Language.PYTHON,
  ".pyx": Language.PYTHON,
  ".pyw": Language.PYTHON,
  ".go": Language.GO,
  ".java": Language.JAVA,
};

/** Mapping from shebang to Language */
const SHEBANG_MAP: Record<string, Language> = {
  python: Language.PYTHON,
  python3: Language.PYTHON,
  php: Language.PHP,
};

export class AnalyzerFactory {
  private analyzers = new Map<Language, LanguageAnalyzer>();

  /**
   * Register an analyzer for a specific language.
   * If no language is provided, uses the analyzer's own language property.
   * Useful for registering the same analyzer for multiple languages (e.g. TS for JS).
   */
  register(analyzer: LanguageAnalyzer, language?: Language): void {
    this.analyzers.set(language ?? analyzer.language, analyzer);
  }

  /**
   * Get the analyzer for a given language.
   */
  getAnalyzer(language: Language): LanguageAnalyzer | null {
    return this.analyzers.get(language) ?? null;
  }

  /**
   * Detect language from file extension and content,
   * then return the appropriate analyzer.
   */
  getAnalyzerForFile(
    filePath: string,
    content?: string,
  ): LanguageAnalyzer | null {
    const language = detectLanguageFromFile(filePath, content);
    if (!language) return null;
    return this.getAnalyzer(language);
  }

  /**
   * Detect language from file path and optional content.
   */
  static detectLanguage(
    filePath: string,
    content?: string,
  ): Language | null {
    return detectLanguageFromFile(filePath, content);
  }

  /**
   * Get all registered languages.
   */
  getRegisteredLanguages(): Language[] {
    return Array.from(this.analyzers.keys());
  }
}

/**
 * Detect language from file path (extension) and content (shebang).
 */
function detectLanguageFromFile(
  filePath: string,
  content?: string,
): Language | null {
  // Try extension first
  for (const [ext, lang] of Object.entries(EXTENSION_MAP)) {
    if (filePath.toLowerCase().endsWith(ext)) {
      return lang;
    }
  }

  // Try shebang
  if (content?.startsWith("#!")) {
    const shebang = content.split("\n")[0]!.toLowerCase();
    for (const [key, lang] of Object.entries(SHEBANG_MAP)) {
      if (shebang.includes(key)) {
        return lang;
      }
    }
  }

  return null;
}
