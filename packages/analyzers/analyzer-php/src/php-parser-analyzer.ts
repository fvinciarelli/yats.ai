import { Language, SymbolKind, RelationshipKind } from "@code-indexer/shared";
import type { Symbol, Relationship, AnalysisResult, AnalysisError } from "@code-indexer/shared";
import { AbstractAnalyzer } from "@code-indexer/analyzer-interface";
import { hashContent } from "@code-indexer/shared";
import { createSymbolId } from "@code-indexer/shared";
import { spawn } from "node:child_process";
import * as path from "node:path";

// ============================================================
// PHP Analyzer — spawns PHP bridge process
// ============================================================

const PHP_EXTENSIONS = new Set([".php", ".phtml", ".php7", ".php8"]);

interface PhpBridgeResult {
  symbols: RawPhpSymbol[];
  relationships: RawPhpRelationship[];
  errors: AnalysisError[];
  warnings: AnalysisError[];
}

interface RawPhpSymbol {
  id: string;
  name: string;
  kind: string;
  language: string;
  location: {
    repository: string;
    relativePath: string;
    startLine: number;
    endLine: number;
    startColumn: number;
    endColumn: number;
  };
  namespace: string;
  parentClass: string | null;
  signature: string | null;
  docComment: string | null;
  sourceSnippet: string;
  contentHash: string;
  metadata: Record<string, unknown>;
}

interface RawPhpRelationship {
  id: string;
  sourceSymbolId: string;
  targetSymbolId: string;
  kind: string;
  metadata: Record<string, unknown>;
}

export class PhpAnalyzer extends AbstractAnalyzer {
  readonly language = Language.PHP;
  private readonly bridgePath: string;

  constructor(bridgePath?: string) {
    super();
    this.bridgePath = bridgePath ?? path.join(
      import.meta.dirname,
      "php-bridge",
      "analyzer.php",
    );
  }

  canAnalyze(filePath: string, _content: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return PHP_EXTENSIONS.has(ext);
  }

  async analyze(
    filePath: string,
    content: string,
    repositoryName: string,
  ): Promise<AnalysisResult> {
    try {
      // Try using the PHP bridge (subprocess)
      return await this.analyzeWithBridge(filePath, repositoryName);
    } catch {
      // Fallback: basic regex-based analysis
      return this.analyzeFallback(filePath, content, repositoryName);
    }
  }

  // ============================================================
  // PHP Bridge (subprocess)
  // ============================================================

  private async analyzeWithBridge(
    filePath: string,
    repositoryName: string,
  ): Promise<AnalysisResult> {
    return new Promise((resolve, reject) => {
      const php = spawn("php", [
        this.bridgePath,
        "--file",
        filePath,
        "--repo",
        repositoryName,
      ], {
        timeout: 30000,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      php.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      php.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      php.on("close", (code: number) => {
        if (code !== 0) {
          reject(new Error(`PHP bridge exited with code ${code}: ${stderr}`));
          return;
        }

        try {
          const result = JSON.parse(stdout) as PhpBridgeResult;
          resolve({
            symbols: this.normalizeSymbols(result.symbols),
            relationships: this.normalizeRelationships(result.relationships),
            errors: result.errors ?? [],
            warnings: result.warnings ?? [],
          });
        } catch (err: any) {
          reject(new Error(`Failed to parse PHP bridge output: ${err.message}`));
        }
      });

      php.on("error", reject);
    });
  }

  // ============================================================
  // Fallback: regex-based analysis (no PHP runtime needed)
  // ============================================================

  private analyzeFallback(
    filePath: string,
    content: string,
    repositoryName: string,
  ): AnalysisResult {
    const symbols: Symbol[] = [];
    const relationships: Relationship[] = [];
    const namespace = this.extractNamespace(content);

    // Detect PHP opening tag
    if (!content.includes("<?php")) {
      return { symbols, relationships, errors: [], warnings: [] };
    }

    // Extract classes
    const classRegex = /(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w\s,]+))?/g;
    let match;
    while ((match = classRegex.exec(content)) !== null) {
      const className = match[1]!;
      const extendsClass = match[2] ?? null;
      const implementsStr = match[3] ?? null;
      const id = createSymbolId(repositoryName, filePath, `${namespace}.${className}`);

      const sym = this.createSymbol({
        id,
        name: className,
        kind: SymbolKind.CLASS,
        language: Language.PHP,
        repository: repositoryName,
        relativePath: filePath,
        namespace,
        startLine: this.getLineNumber(content, match.index),
      });

      this.detectPHPConvention(sym, filePath);
      symbols.push(sym);

      if (extendsClass) {
        const targetId = createSymbolId(repositoryName, filePath, `${namespace}.${extendsClass}`);
        relationships.push(
          this.createRelationship(id, targetId, RelationshipKind.INHERITS),
        );
      }

      if (implementsStr) {
        for (const iface of implementsStr.split(",").map(s => s.trim()).filter(Boolean)) {
          const targetId = createSymbolId(repositoryName, filePath, `${namespace}.${iface}`);
          relationships.push(
            this.createRelationship(id, targetId, RelationshipKind.IMPLEMENTS),
          );
        }
      }
    }

    // Extract interfaces
    const ifaceRegex = /interface\s+(\w+)/g;
    while ((match = ifaceRegex.exec(content)) !== null) {
      const id = createSymbolId(repositoryName, filePath, `${namespace}.${match[1]}`);
      symbols.push(this.createSymbol({
        id,
        name: match[1]!,
        kind: SymbolKind.INTERFACE,
        language: Language.PHP,
        repository: repositoryName,
        relativePath: filePath,
        namespace,
        startLine: this.getLineNumber(content, match.index),
      }));
    }

    // Extract traits
    const traitRegex = /trait\s+(\w+)/g;
    while ((match = traitRegex.exec(content)) !== null) {
      const id = createSymbolId(repositoryName, filePath, `${namespace}.${match[1]}`);
      symbols.push(this.createSymbol({
        id,
        name: match[1]!,
        kind: SymbolKind.CLASS,
        language: Language.PHP,
        repository: repositoryName,
        relativePath: filePath,
        namespace,
        startLine: this.getLineNumber(content, match.index),
        metadata: { isTrait: true },
      }));
    }

    // Extract enums (PHP 8.1+)
    const enumRegex = /enum\s+(\w+)/g;
    while ((match = enumRegex.exec(content)) !== null) {
      const id = createSymbolId(repositoryName, filePath, `${namespace}.${match[1]}`);
      symbols.push(this.createSymbol({
        id,
        name: match[1]!,
        kind: SymbolKind.ENUM,
        language: Language.PHP,
        repository: repositoryName,
        relativePath: filePath,
        namespace,
        startLine: this.getLineNumber(content, match.index),
      }));
    }

    // Extract functions
    const funcRegex = /(?:public\s+|protected\s+|private\s+)?(?:static\s+)?function\s+(\w+)\s*\(/g;
    while ((match = funcRegex.exec(content)) !== null) {
      const funcName = match[1]!;
      const id = createSymbolId(repositoryName, filePath, `${namespace}.${funcName}`);
      const sym = this.createSymbol({
        id,
        name: funcName,
        kind: funcName === "__construct" ? SymbolKind.CONSTRUCTOR : SymbolKind.METHOD,
        language: Language.PHP,
        repository: repositoryName,
        relativePath: filePath,
        namespace,
        parentClass: namespace.split(".").pop() ?? null,
        startLine: this.getLineNumber(content, match.index),
        signature: match[0],
      });
      symbols.push(sym);

      // Extract calls within this function body
      this.extractPhpCalls(
        content, match.index, id, filePath, repositoryName, namespace, relationships,
      );
    }

    // Extract use statements (imports)
    const useRegex = /use\s+([\w\\]+)(?:\s+as\s+(\w+))?\s*;/g;
    while ((match = useRegex.exec(content)) !== null) {
      const fullName = match[1]!;
      const shortName = fullName.split("\\").pop()!;
      const targetId = createSymbolId(repositoryName, filePath, shortName);
      const sourceId = createSymbolId(repositoryName, filePath, `import:${shortName}`);
      relationships.push(
        this.createRelationship(sourceId, targetId, RelationshipKind.IMPORTS, {
          fullName,
          alias: match[2] ?? null,
        }),
      );
    }

    return { symbols, relationships, errors: [], warnings: [] };
  }

  // ============================================================
  // Normalization
  // ============================================================

  private normalizeSymbols(raw: RawPhpSymbol[]): Symbol[] {
    return raw.map((r) => ({
      id: r.id,
      name: r.name,
      kind: (r.kind as SymbolKind) || SymbolKind.CLASS,
      language: Language.PHP,
      location: r.location ?? {
        repository: "",
        relativePath: "",
        startLine: 1,
        endLine: 1,
        startColumn: 0,
        endColumn: 0,
      },
      namespace: r.namespace ?? "",
      parentClass: r.parentClass ?? null,
      signature: r.signature ?? null,
      docComment: r.docComment ?? null,
      sourceSnippet: r.sourceSnippet ?? "",
      contentHash: r.contentHash ?? "",
      metadata: r.metadata ?? {},
    }));
  }

  private normalizeRelationships(raw: RawPhpRelationship[]): Relationship[] {
    return raw.map((r) => ({
      id: r.id,
      sourceSymbolId: r.sourceSymbolId,
      targetSymbolId: r.targetSymbolId,
      kind: (r.kind as RelationshipKind) || RelationshipKind.REFERENCES,
      metadata: r.metadata ?? {},
    }));
  }

  // ============================================================
  // Helpers
  // ============================================================

  private extractNamespace(content: string): string {
    const match = content.match(/namespace\s+([\w\\]+)\s*;/);
    return match ? (match[1] ?? "") : "";
  }

  private getLineNumber(content: string, index: number): number {
    return content.slice(0, index).split("\n").length;
  }

  private detectPHPConvention(symbol: Symbol, filePath: string): void {
    const isTestFile =
      filePath.includes("Test.php") ||
      filePath.includes("/tests/") ||
      filePath.includes("/test/");

    const isConfigFile =
      filePath.includes("/config/") ||
      filePath.includes(".config.php");

    const name = symbol.name;

    if (name.endsWith("Controller")) {
      symbol.kind = SymbolKind.CONTROLLER;
      symbol.metadata["detectedByConvention"] = true;
    } else if (name.endsWith("Service")) {
      symbol.kind = SymbolKind.SERVICE;
      symbol.metadata["detectedByConvention"] = true;
    } else if (name.endsWith("Repository")) {
      symbol.kind = SymbolKind.REPOSITORY;
      symbol.metadata["detectedByConvention"] = true;
    } else if (name.endsWith("DTO") || name.endsWith("Dto")) {
      symbol.kind = SymbolKind.DTO;
      symbol.metadata["detectedByConvention"] = true;
    } else if (name.endsWith("Entity") || name.endsWith("Model")) {
      symbol.kind = SymbolKind.ENTITY;
      symbol.metadata["detectedByConvention"] = true;
    } else if (name.endsWith("Command")) {
      symbol.kind = SymbolKind.COMMAND;
      symbol.metadata["detectedByConvention"] = true;
    } else if (name.endsWith("Event")) {
      symbol.kind = SymbolKind.EVENT;
      symbol.metadata["detectedByConvention"] = true;
    } else if (name.endsWith("Middleware")) {
      symbol.kind = SymbolKind.MIDDLEWARE;
      symbol.metadata["detectedByConvention"] = true;
    } else if (name.endsWith("Provider") || name.endsWith("ServiceProvider")) {
      symbol.kind = SymbolKind.PROVIDER;
      symbol.metadata["detectedByConvention"] = true;
    } else if (name.endsWith("Factory")) {
      symbol.kind = SymbolKind.FACTORY;
      symbol.metadata["detectedByConvention"] = true;
    } else if (name.endsWith("Migration")) {
      symbol.kind = SymbolKind.MIGRATION;
      symbol.metadata["detectedByConvention"] = true;
    }

    if (isTestFile) {
      symbol.kind = SymbolKind.TEST;
      symbol.metadata["isTest"] = true;
    }

    if (isConfigFile && symbol.kind === SymbolKind.CLASS) {
      symbol.kind = SymbolKind.CONFIG;
      symbol.metadata["isConfig"] = true;
    }
  }

  private extractPhpCalls(
    content: string,
    offset: number,
    callerId: string,
    filePath: string,
    repository: string,
    namespace: string,
    relationships: Relationship[],
  ): void {
    // Find the opening brace
    const braceIdx = content.indexOf("{", offset);
    if (braceIdx === -1) return;

    // Simple brace counter to find function body
    let depth = 1;
    let endIdx = braceIdx + 1;
    for (; endIdx < content.length && depth > 0; endIdx++) {
      if (content[endIdx] === "{") depth++;
      else if (content[endIdx] === "}") depth--;
    }

    const body = content.slice(braceIdx, endIdx);

    // Match ->methodName(  or  ClassName::methodName(
    const callRegex = /(?:->|::)(\w+)\s*\(/g;
    let callMatch;
    while ((callMatch = callRegex.exec(body)) !== null) {
      const calleeName = callMatch[1]!;
      const calleeId = createSymbolId(repository, filePath, `${namespace}.${calleeName}`);
      relationships.push(
        this.createRelationship(callerId, calleeId, RelationshipKind.CALLS),
      );
    }

    // Match functionName( for global function calls
    const funcCallRegex = /\b([a-z_]\w*)\s*\(/gi;
    while ((callMatch = funcCallRegex.exec(body)) !== null) {
      const funcName = callMatch[1]!;
      // Skip keywords and common functions
      if (["if", "while", "for", "switch", "return", "echo", "print", "isset", "empty",
           "array", "count", "strlen", "sprintf", "array_map", "array_filter"].includes(funcName)) {
        continue;
      }
      const calleeId = createSymbolId(repository, filePath, `${namespace}.${funcName}`);
      relationships.push(
        this.createRelationship(callerId, calleeId, RelationshipKind.CALLS),
      );
    }
  }
}
