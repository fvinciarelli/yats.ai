import { Language, SymbolKind, RelationshipKind } from "@yats/shared";
import type { Symbol, Relationship, AnalysisResult } from "@yats/shared";
import { AbstractAnalyzer } from "@yats/analyzer-interface";
import { hashContent } from "@yats/shared";
import { createSymbolId } from "@yats/shared";
import * as path from "node:path";

// ============================================================
// Tree-sitter Fallback Analyzer
// 
// Uses tree-sitter with language-specific query files (.scm)
// to extract symbols and relationships generically.
//
// When tree-sitter grammars aren't available, falls back to
// regex-based extraction.
// ============================================================

let Parser: any = null;
try {
  Parser = require("tree-sitter");
} catch {
  // tree-sitter not available
}

// ============================================================
// Language detection by extension
// ============================================================

const EXT_LANG_MAP: Record<string, Language> = {
  ".ts": Language.TYPESCRIPT,
  ".tsx": Language.TYPESCRIPT,
  ".mts": Language.TYPESCRIPT,
  ".cs": Language.CSHARP,
  ".php": Language.PHP,
  ".py": Language.PYTHON,
  ".pyi": Language.PYTHON,
  ".go": Language.GO,
  ".java": Language.JAVA,
};

const ALL_EXTENSIONS = new Set(Object.keys(EXT_LANG_MAP));

export class TreeSitterAnalyzer extends AbstractAnalyzer {
  readonly language: Language;
  private parser: any = null;

  constructor(language: Language = Language.TYPESCRIPT) {
    super();
    this.language = language;
    if (Parser) {
      this.parser = new Parser();
    }
  }

  canAnalyze(filePath: string, _content: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ALL_EXTENSIONS.has(ext);
  }

  async analyze(
    filePath: string,
    content: string,
    repositoryName: string,
  ): Promise<AnalysisResult> {
    const language = this.detectLanguageFromPath(filePath);

    if (this.parser && this.canUseTreeSitter(language)) {
      return this.analyzeWithTreeSitter(filePath, content, repositoryName, language);
    }

    // Fallback to regex
    return this.analyzeWithRegex(filePath, content, repositoryName, language);
  }

  // ============================================================
  // Tree-sitter analysis
  // ============================================================

  private canUseTreeSitter(language: Language): boolean {
    // Tree-sitter requires language-specific WASM grammars.
    // These are loaded dynamically. For now, we check if the
    // grammar is available.
    try {
      const grammarModule = this.loadGrammar(language);
      return grammarModule !== null;
    } catch {
      return false;
    }
  }

  private loadGrammar(language: Language): any {
    // Tree-sitter grammars are published as separate npm packages:
    // tree-sitter-typescript, tree-sitter-python, tree-sitter-php, etc.
    // We attempt to load them dynamically.
    const grammarMap: Record<string, string> = {
      [Language.TYPESCRIPT]: "tree-sitter-typescript",
      [Language.PYTHON]: "tree-sitter-python",
      [Language.PHP]: "tree-sitter-php",
      [Language.CSHARP]: "tree-sitter-c-sharp",
      [Language.GO]: "tree-sitter-go",
      [Language.JAVA]: "tree-sitter-java",
    };

    const pkgName = grammarMap[language];
    if (!pkgName) return null;

    try {
      return require(pkgName);
    } catch {
      return null;
    }
  }

  private analyzeWithTreeSitter(
    filePath: string,
    content: string,
    repositoryName: string,
    language: Language,
  ): AnalysisResult {
    const symbols: Symbol[] = [];
    const relationships: Relationship[] = [];

    const grammar = this.loadGrammar(language);
    if (!grammar) {
      return this.analyzeWithRegex(filePath, content, repositoryName, language);
    }

    this.parser.setLanguage(grammar);
    const tree = this.parser.parse(content);

    // Apply query to extract symbols
    const queryText = this.getQueryForLanguage(language);
    if (queryText && tree) {
      const query = new (require("tree-sitter").Query)(grammar, queryText);
      const matches = query.matches(tree.rootNode);

      for (const match of matches) {
        for (const capture of match.captures) {
          const node = capture.node;
          const name = capture.name;
          const text = content.slice(node.startIndex, node.endIndex);

          const id = createSymbolId(repositoryName, filePath, text.slice(0, 50));
          const sym = this.createSymbol({
            id,
            name: text.slice(0, 100),
            kind: this.mapCaptureToKind(name),
            language,
            repository: repositoryName,
            relativePath: filePath,
            namespace: filePath.replace(/\//g, ".").replace(/\.\w+$/, ""),
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startColumn: node.startPosition.column,
            endColumn: node.endPosition.column,
            sourceSnippet: text.slice(0, 500),
            contentHash: hashContent(text),
          });
          symbols.push(sym);
        }
      }
    }

    return { symbols, relationships, errors: [], warnings: [] };
  }

  // ============================================================
  // Regex fallback — universal, works without native deps
  // ============================================================

  private analyzeWithRegex(
    filePath: string,
    content: string,
    repositoryName: string,
    language: Language,
  ): AnalysisResult {
    const symbols: Symbol[] = [];
    const relationships: Relationship[] = [];
    const namespace = filePath.replace(/\//g, ".").replace(/\.\w+$/, "");

    // ------ Universal patterns ------

    // Class/struct definitions: class Name, struct Name
    const classRe = /(?:class|struct|interface|enum)\s+(\w+)/g;
    let match;
    while ((match = classRe.exec(content)) !== null) {
      const name = match[1]!;
      const id = createSymbolId(repositoryName, filePath, `${namespace}.${name}`);
      const kind = this.classKeywordToKind(match[0]);

      symbols.push(this.createSymbol({
        id,
        name,
        kind,
        language,
        repository: repositoryName,
        relativePath: filePath,
        namespace,
        startLine: this.getLine(content, match.index),
        sourceSnippet: content.slice(match.index, match.index + 200),
        contentHash: hashContent(match[0]),
      }));
    }

    // Function/method definitions (includes Go's "func" keyword)
    const funcRe = /(?:func|function|def|async function|public\s+(?:static\s+)?(?:void|int|String|boolean|long|double|float)\s+|private\s+(?:static\s+)?(?:void|int|String|boolean|long|double|float)\s+|protected\s+(?:static\s+)?(?:void|int|String|boolean|long|double|float)\s+)\s*(\w+)\s*\(/g;
    while ((match = funcRe.exec(content)) !== null) {
      const name = match[1]!;
      const id = createSymbolId(repositoryName, filePath, `${namespace}.${name}`);
      symbols.push(this.createSymbol({
        id,
        name,
        kind: SymbolKind.FUNCTION,
        language,
        repository: repositoryName,
        relativePath: filePath,
        namespace,
        startLine: this.getLine(content, match.index),
        sourceSnippet: content.slice(match.index, match.index + 200),
        contentHash: hashContent(match[0]),
      }));
    }

    // Imports
    const importRe = /(?:import|require|from|use)\s+['"]?([\w./@-]+)['"]?/g;
    while ((match = importRe.exec(content)) !== null) {
      // Skip common non-import patterns
      const before = content.slice(Math.max(0, match.index - 20), match.index);
      if (!/(import|require|from|use)\s*$/.test(before)) continue;

      const imported = match[1]!;
      const targetId = createSymbolId(repositoryName, filePath, imported);
      const sourceId = createSymbolId(repositoryName, filePath, `import:${imported}`);
      relationships.push(
        this.createRelationship(sourceId, targetId, RelationshipKind.IMPORTS),
      );
    }

    return { symbols, relationships, errors: [], warnings: [] };
  }

  // ============================================================
  // Helpers
  // ============================================================

  private detectLanguageFromPath(filePath: string): Language {
    const ext = path.extname(filePath).toLowerCase();
    return EXT_LANG_MAP[ext] ?? Language.TYPESCRIPT;
  }

  private getLine(content: string, index: number): number {
    return content.slice(0, index).split("\n").length;
  }

  private classKeywordToType(keyword: string): string {
    if (keyword.includes("interface")) return "interface";
    if (keyword.includes("enum")) return "enum";
    if (keyword.includes("struct")) return "struct";
    return "class";
  }

  private classKeywordToKind(keyword: string): SymbolKind {
    const type = this.classKeywordToType(keyword);
    switch (type) {
      case "interface": return SymbolKind.INTERFACE;
      case "enum": return SymbolKind.ENUM;
      case "struct": return SymbolKind.STRUCT;
      default: return SymbolKind.CLASS;
    }
  }

  private mapCaptureToKind(captureName: string): SymbolKind {
    const map: Record<string, SymbolKind> = {
      "class": SymbolKind.CLASS,
      "interface": SymbolKind.INTERFACE,
      "enum": SymbolKind.ENUM,
      "struct": SymbolKind.STRUCT,
      "function": SymbolKind.FUNCTION,
      "method": SymbolKind.METHOD,
      "variable": SymbolKind.VARIABLE,
      "import": SymbolKind.VARIABLE,
    };
    return map[captureName] ?? SymbolKind.VARIABLE;
  }

  private getQueryForLanguage(language: Language): string | null {
    // These would be .scm query files in production
    // Here we define inline for portability
    const queries: Record<string, string> = {
      [Language.TYPESCRIPT]: `
        (class_declaration name: (type_identifier) @class)
        (interface_declaration name: (type_identifier) @interface)
        (enum_declaration name: (identifier) @enum)
        (function_declaration name: (identifier) @function)
        (method_definition name: (property_identifier) @method)
        (import_statement) @import
      `,
      [Language.PYTHON]: `
        (class_definition name: (identifier) @class)
        (function_definition name: (identifier) @function)
        (import_statement) @import
      `,
      [Language.PHP]: `
        (class_declaration name: (name) @class)
        (interface_declaration name: (name) @interface)
        (function_definition name: (name) @function)
        (method_declaration name: (name) @method)
      `,
      [Language.GO]: `
        (type_declaration (type_spec name: (type_identifier) @class))
        (function_declaration name: (identifier) @function)
        (method_declaration name: (field_identifier) @method)
        (import_declaration) @import
      `,
      [Language.JAVA]: `
        (class_declaration name: (identifier) @class)
        (interface_declaration name: (identifier) @interface)
        (enum_declaration name: (identifier) @enum)
        (method_declaration name: (identifier) @method)
        (import_declaration) @import
      `,
    };
    return queries[language] ?? null;
  }
}
