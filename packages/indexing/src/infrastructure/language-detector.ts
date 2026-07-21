import { Language } from "@yats/shared";
import type { LanguageAnalyzer } from "@yats/shared";

// ============================================================
// Language detection from file extensions and shebangs
// ============================================================

const EXTENSION_MAP: Record<string, Language> = {
  ".ts": Language.TYPESCRIPT,
  ".tsx": Language.TYPESCRIPT,
  ".mts": Language.TYPESCRIPT,
  ".cts": Language.TYPESCRIPT,
  ".cs": Language.CSHARP,
  ".csx": Language.CSHARP,
  ".cshtml": Language.CSHARP,
  ".php": Language.PHP,
  ".phtml": Language.PHP,
  ".php7": Language.PHP,
  ".php8": Language.PHP,
  ".py": Language.PYTHON,
  ".pyi": Language.PYTHON,
  ".pyx": Language.PYTHON,
  ".pyw": Language.PYTHON,
  ".go": Language.GO,
  ".java": Language.JAVA,
  ".jar": Language.JAVA,
};

const SHEBANG_MAP: Record<string, Language> = {
  python: Language.PYTHON,
  python3: Language.PYTHON,
  php: Language.PHP,
};

/** Special files that use a different extension convention */
const SPECIAL_FILES: Record<string, Language> = {
  "Dockerfile": Language.TYPESCRIPT, // not really, but we treat Dockerfiles as plain text / config
};

const IGNORED_EXTENSIONS = new Set([
  ".md", ".txt", ".json", ".yaml", ".yml", ".toml",
  ".xml", ".html", ".css", ".scss", ".less", ".svg",
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp",
  ".woff", ".woff2", ".ttf", ".eot",
  ".lock", ".log", ".map",
]);

/**
 * Detect programming language from file path and content.
 * Returns null for unsupported or non-code files.
 */
export function detectLanguage(
  filePath: string,
  content?: string,
): Language | null {
  // Skip ignored extensions early
  const ext = filePath.includes(".")
    ? "." + filePath.split(".").pop()!.toLowerCase()
    : "";

  if (IGNORED_EXTENSIONS.has(ext)) {
    return null;
  }

  // Try extension first
  const lang = EXTENSION_MAP[ext];
  if (lang) return lang;

  // Try shebang for extensionless files
  if (content?.startsWith("#!")) {
    const shebang = content.split("\n")[0]!.toLowerCase();
    for (const [key, langKey] of Object.entries(SHEBANG_MAP)) {
      if (shebang.includes(key)) return langKey;
    }
  }

  // Special file names
  const baseName = filePath.split("/").pop() ?? filePath;
  if (SPECIAL_FILES[baseName]) return SPECIAL_FILES[baseName];

  return null;
}

/**
 * Get the appropriate analyzer for a file, or null if unsupported.
 */
export function getAnalyzerForFile(
  analyzers: Map<Language, LanguageAnalyzer>,
  filePath: string,
  content?: string,
): LanguageAnalyzer | null {
  const language = detectLanguage(filePath, content);
  if (!language) return null;
  return analyzers.get(language) ?? null;
}
