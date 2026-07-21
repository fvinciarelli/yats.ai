import { Language, SymbolKind, RelationshipKind } from "@yats/shared";
import type { Symbol, Relationship, AnalysisResult, AnalysisError } from "@yats/shared";
import { AbstractAnalyzer } from "@yats/analyzer-interface";
import { hashContent } from "@yats/shared";
import { createSymbolId } from "@yats/shared";
import { spawn } from "node:child_process";
import * as path from "node:path";

// ============================================================
// Python Analyzer — spawns Python bridge + regex fallback
// ============================================================

const PY_EXTENSIONS = new Set([".py", ".pyi", ".pyx", ".pyw"]);

export class PythonAnalyzer extends AbstractAnalyzer {
  readonly language = Language.PYTHON;
  private readonly bridgePath: string;

  constructor(bridgePath?: string) {
    super();
    this.bridgePath = bridgePath ?? path.join(
      import.meta.dirname,
      "python-bridge",
      "analyzer.py",
    );
  }

  canAnalyze(filePath: string, _content: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return PY_EXTENSIONS.has(ext);
  }

  async analyze(
    filePath: string,
    content: string,
    repositoryName: string,
  ): Promise<AnalysisResult> {
    try {
      return await this.analyzeWithBridge(filePath, repositoryName);
    } catch {
      // Fallback to basic analysis
      return this.analyzeFallback(filePath, content, repositoryName);
    }
  }

  // ============================================================
  // Python Bridge (subprocess)
  // ============================================================

  private analyzeWithBridge(
    filePath: string,
    repositoryName: string,
  ): Promise<AnalysisResult> {
    return new Promise((resolve, reject) => {
      const pyProc = spawn("python3", [
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

      pyProc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
      pyProc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

      pyProc.on("close", (code: number) => {
        if (code !== 0) {
          reject(new Error(`Python bridge exited ${code}: ${stderr}`));
          return;
        }
        try {
          const result = JSON.parse(stdout);
          resolve({
            symbols: result.symbols.map((s: any) => this.normalizeSymbol(s)),
            relationships: result.relationships.map((r: any) => ({
              id: r.id,
              sourceSymbolId: r.sourceSymbolId,
              targetSymbolId: r.targetSymbolId,
              kind: r.kind as RelationshipKind,
              metadata: r.metadata ?? {},
            })),
            errors: result.errors ?? [],
            warnings: result.warnings ?? [],
          });
        } catch (err: any) {
          reject(new Error(`Bad bridge JSON: ${err.message}`));
        }
      });

      pyProc.on("error", reject);
    });
  }

  // ============================================================
  // Fallback: regex-based analysis
  // ============================================================

  private analyzeFallback(
    filePath: string,
    content: string,
    repositoryName: string,
  ): AnalysisResult {
    const symbols: Symbol[] = [];
    const relationships: Relationship[] = [];
    const namespace = path.basename(filePath).replace(/\.(py|pyi|pyx|pyw)$/, "");

    // Classes
    const classRegex = /class\s+(\w+)(?:\s*\(\s*([\w\s,.]*?)\s*\))?\s*:/g;
    let match;
    while ((match = classRegex.exec(content)) !== null) {
      const name = match[1]!;
      const bases = match[2] ?? "";
      const id = createSymbolId(repositoryName, filePath, `${namespace}.${name}`);

      const sym = this.createSymbol({
        id,
        name,
        kind: SymbolKind.CLASS,
        language: Language.PYTHON,
        repository: repositoryName,
        relativePath: filePath,
        namespace,
        startLine: this.getLine(content, match.index),
        sourceSnippet: content.slice(match.index, match.index + 500),
        contentHash: hashContent(match[0]),
      });

      this.detectPyConvention(sym, filePath);
      symbols.push(sym);

      // Inheritance
      for (const base of bases.split(",").map((b) => b.trim()).filter(Boolean)) {
        if (base === "object") continue;
        const targetId = createSymbolId(repositoryName, filePath, `${namespace}.${base}`);
        relationships.push(
          this.createRelationship(id, targetId, RelationshipKind.INHERITS),
        );
      }
    }

    // Functions/methods
    const funcRegex = /(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*(\S+))?\s*:/g;
    while ((match = funcRegex.exec(content)) !== null) {
      const name = match[1]!;
      const params = match[2] ?? "";
      const returns = match[3] ?? null;
      const id = createSymbolId(repositoryName, filePath, `${namespace}.${name}`);
      const sig = `def ${name}(${params})${returns ? ` -> ${returns}` : ""}`;

      const kind = name === "__init__"
        ? SymbolKind.CONSTRUCTOR
        : name.startsWith("__") && name.endsWith("__")
          ? SymbolKind.METHOD
          : SymbolKind.FUNCTION;

      const sym = this.createSymbol({
        id,
        name,
        kind,
        language: Language.PYTHON,
        repository: repositoryName,
        relativePath: filePath,
        namespace,
        signature: sig,
        startLine: this.getLine(content, match.index),
        sourceSnippet: content.slice(match.index, match.index + 500),
        contentHash: hashContent(match[0]),
      });

      // Route detection for FastAPI/Flask
      if (this.isFastAPIRouteDecorator(content, match.index)) {
        sym.kind = SymbolKind.ROUTE;
        sym.metadata["framework"] = "fastapi";
      }

      symbols.push(sym);
    }

    // Imports
    const importRegex = /^(?:from\s+(\S+)\s+)?import\s+(.+)$/gm;
    while ((match = importRegex.exec(content)) !== null) {
      const module = match[1] ?? "";
      const names = match[2]!.split(",").map((n) => n.trim().split(" as ")[0]!.trim());
      for (const impName of names) {
        const fullName = module ? `${module}.${impName}` : impName;
        const targetId = createSymbolId(repositoryName, filePath, fullName);
        const sourceId = createSymbolId(repositoryName, filePath, `import:${impName}`);
        relationships.push(
          this.createRelationship(sourceId, targetId, RelationshipKind.IMPORTS, { module }),
        );
      }
    }

    return { symbols, relationships, errors: [], warnings: [] };
  }

  // ============================================================
  // Normalization
  // ============================================================

  private normalizeSymbol(raw: any): Symbol {
    return {
      id: raw.id,
      name: raw.name,
      kind: (raw.kind as SymbolKind) || SymbolKind.CLASS,
      language: Language.PYTHON,
      location: raw.location ?? {
        repository: "", relativePath: "", startLine: 1, endLine: 1, startColumn: 0, endColumn: 0,
      },
      namespace: raw.namespace ?? "",
      parentClass: raw.parentClass ?? null,
      signature: raw.signature ?? null,
      docComment: raw.docComment ?? null,
      sourceSnippet: raw.sourceSnippet ?? "",
      contentHash: raw.contentHash ?? "",
      metadata: raw.metadata ?? {},
    };
  }

  // ============================================================
  // Helpers
  // ============================================================

  private getLine(content: string, index: number): number {
    return content.slice(0, index).split("\n").length;
  }

  private detectPyConvention(symbol: Symbol, filePath: string): void {
    const name = symbol.name;
    const isTestFile =
      filePath.startsWith("test_") ||
      filePath.endsWith("_test.py") ||
      filePath.includes("/tests/") ||
      filePath.includes("/test/");

    const isConfigFile =
      filePath.includes("config") ||
      filePath.includes("settings");

    if (name.endsWith("Controller")) { symbol.kind = SymbolKind.CONTROLLER; }
    else if (name.endsWith("Service")) { symbol.kind = SymbolKind.SERVICE; }
    else if (name.endsWith("Repository")) { symbol.kind = SymbolKind.REPOSITORY; }
    else if (name.endsWith("DTO") || name.endsWith("Dto") || name.endsWith("Schema")) { symbol.kind = SymbolKind.DTO; }
    else if (name.endsWith("Entity") || name.endsWith("Model")) { symbol.kind = SymbolKind.ENTITY; }
    else if (name.endsWith("Command")) { symbol.kind = SymbolKind.COMMAND; }
    else if (name.endsWith("Query")) { symbol.kind = SymbolKind.QUERY; }
    else if (name.endsWith("Event")) { symbol.kind = SymbolKind.EVENT; }
    else if (name.endsWith("Middleware")) { symbol.kind = SymbolKind.MIDDLEWARE; }
    else if (name.endsWith("Factory")) { symbol.kind = SymbolKind.FACTORY; }

    if (isTestFile) {
      symbol.kind = SymbolKind.TEST;
      symbol.metadata["isTest"] = true;
    }

    if (isConfigFile && symbol.kind === SymbolKind.CLASS) {
      symbol.kind = SymbolKind.CONFIG;
      symbol.metadata["isConfig"] = true;
    }
  }

  private isFastAPIRouteDecorator(content: string, funcIdx: number): boolean {
    // Look backwards from the function to find decorators
    const before = content.slice(Math.max(0, funcIdx - 200), funcIdx);
    return /@(app|router)\.(get|post|put|patch|delete)\b/.test(before);
  }
}
