import { Language, SymbolKind, RelationshipKind } from "@yats/shared";
import type { Symbol, Relationship, AnalysisResult } from "@yats/shared";
import { AbstractAnalyzer } from "@yats/analyzer-interface";
import { hashContent, createSymbolId } from "@yats/shared";
import { spawn } from "node:child_process";
import * as path from "node:path";

// ============================================================
// C# Analyzer — spawns Roslyn bridge (dotnet run)
// ============================================================

const CSHARP_EXTENSIONS = new Set([".cs", ".csx"]);

interface CSharpBridgeResult {
  symbols: RawCSharpSymbol[];
  relationships: RawCSharpRelationship[];
  errors: string[];
  warnings: string[];
}

interface RawCSharpSymbol {
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

interface RawCSharpRelationship {
  id: string;
  sourceSymbolId: string;
  targetSymbolId: string;
  kind: string;
  metadata: Record<string, unknown>;
}

export class CSharpAnalyzer extends AbstractAnalyzer {
  readonly language = Language.CSHARP;
  private readonly bridgeDir: string;

  constructor(bridgeDir?: string) {
    super();
    // When imported from dist/, import.meta.dirname is .../dist/.
    // When imported via tsx (source), it's .../src/.
    // Normalize: if we're in dist/, go up one level and into src/csharp-bridge/.
    if (bridgeDir) {
      this.bridgeDir = bridgeDir;
    } else {
      const dir = import.meta.dirname;
      if (dir.endsWith("/dist")) {
        this.bridgeDir = path.join(dir, "..", "src", "csharp-bridge");
      } else {
        this.bridgeDir = path.join(dir, "csharp-bridge");
      }
    }
  }

  canAnalyze(filePath: string, _content: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return CSHARP_EXTENSIONS.has(ext);
  }

  async analyze(
    filePath: string,
    content: string,
    repositoryName: string,
  ): Promise<AnalysisResult> {
    try {
      return await this.analyzeWithBridge(filePath, content, repositoryName);
    } catch {
      return this.analyzeFallback(filePath, content, repositoryName);
    }
  }

  private async analyzeWithBridge(
    filePath: string,
    content: string,
    repositoryName: string,
  ): Promise<AnalysisResult> {
    // In Docker: use pre-compiled binary. In dev: use "dotnet run".
    const bridgeBin = process.env.YATS_CSHARP_BRIDGE
      ? `${process.env.YATS_CSHARP_BRIDGE}/RoslynAnalyzer`
      : null;
    const fs = await import("node:fs");

    const useBinary = bridgeBin && fs.existsSync(bridgeBin) && fs.statSync(bridgeBin).size > 0;
    const cmd = useBinary ? bridgeBin! : "dotnet";
    const args = useBinary
      ? ["--file", filePath, "--repo", repositoryName, "--stdin"]
      : ["run", "--no-build", "--project", this.bridgeDir, "--", "--file", filePath, "--repo", repositoryName, "--stdin"];

    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, {
        timeout: 60000,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

      proc.on("close", (code: number) => {
        if (code !== 0) {
          reject(new Error(`C# bridge exited with code ${code}: ${stderr}`));
          return;
        }
        try {
          // With self-contained binary there's no build output
          const jsonStart = useBinary ? 0 : stdout.indexOf("{");
          if (jsonStart === -1) {
            reject(new Error("C# bridge produced no valid JSON output"));
            return;
          }
          const json = useBinary ? stdout : stdout.slice(jsonStart);
          const result = JSON.parse(json) as CSharpBridgeResult;
          resolve({
            symbols: this.normalizeSymbols(result.symbols),
            relationships: this.normalizeRelationships(result.relationships),
            errors: (result.errors ?? []).map((e: string) => ({
              message: e, line: 0, column: 0, severity: "error" as const,
            })),
            warnings: (result.warnings ?? []) as any[],
          });
        } catch (err: any) {
          reject(new Error(`Failed to parse C# bridge output: ${err.message}`));
        }
      });

      proc.on("error", reject);

      // Write content to stdin and close (bridge uses --stdin mode)
      proc.stdin!.write(content);
      proc.stdin!.end();
    });
  }

  private analyzeFallback(
    filePath: string,
    content: string,
    repositoryName: string,
  ): AnalysisResult {
    const symbols: Symbol[] = [];
    const relationships: Relationship[] = [];
    const namespace = this.extractNamespace(content) || filePath.replace(/\//g, ".").replace(/\.csx?$/, "");

    // Classes
    const classRe = /(?:public\s+|internal\s+|private\s+)?(?:static\s+)?(?:partial\s+)?class\s+(\w+)\s*(?::\s*([\w.,\s<>]+))?/g;
    let match;
    while ((match = classRe.exec(content)) !== null) {
      const name = match[1]!;
      const bases = match[2] ?? null;
      const id = createSymbolId(repositoryName, filePath, `${namespace}.${name}`);
      const sym = this.createSymbol({
        id, name, kind: SymbolKind.CLASS, language: Language.CSHARP,
        repository: repositoryName, relativePath: filePath, namespace,
        startLine: this.getLine(content, match.index),
      });
      this.detectConvention(sym, filePath);
      symbols.push(sym);

      if (bases) {
        for (const base of bases.split(",").map(s => s.trim())) {
          const baseName = base.replace(/<.*>/, "").trim();
          if (!baseName) continue;
          const baseId = createSymbolId(repositoryName, filePath, `${namespace}.${baseName}`);
          const relKind = baseName.startsWith("I") ? RelationshipKind.IMPLEMENTS : RelationshipKind.INHERITS;
          relationships.push(this.createRelationship(id, baseId, relKind));
        }
      }
    }

    // Interfaces
    const ifaceRe = /(?:public\s+|internal\s+)?interface\s+(\w+)/g;
    while ((match = ifaceRe.exec(content)) !== null) {
      const id = createSymbolId(repositoryName, filePath, `${namespace}.${match[1]}`);
      symbols.push(this.createSymbol({
        id, name: match[1]!, kind: SymbolKind.INTERFACE, language: Language.CSHARP,
        repository: repositoryName, relativePath: filePath, namespace,
        startLine: this.getLine(content, match.index),
      }));
    }

    // Methods
    const methodRe = /(?:public\s+|private\s+|protected\s+|internal\s+)?(?:static\s+|async\s+|override\s+|virtual\s+)*(\w+(?:<[\w,\s<>]+>)?)\s+(\w+)\s*\(/g;
    while ((match = methodRe.exec(content)) !== null) {
      const returnType = match[1]!;
      const name = match[2]!;
      // Skip keywords
      if (["if", "while", "for", "foreach", "switch", "using", "lock", "return", "throw", "new"].includes(name)) continue;
      const id = createSymbolId(repositoryName, filePath, `${namespace}.${name}`);
      symbols.push(this.createSymbol({
        id, name,
        kind: name[0] === name[0]?.toUpperCase() ? SymbolKind.METHOD : SymbolKind.FUNCTION,
        language: Language.CSHARP,
        repository: repositoryName, relativePath: filePath, namespace,
        startLine: this.getLine(content, match.index),
        signature: match[0],
      }));
    }

    // Using directives
    const usingRe = /using\s+([\w.]+)\s*;/g;
    while ((match = usingRe.exec(content)) !== null) {
      const importPath = match[1]!;
      const srcId = createSymbolId(repositoryName, filePath, `import:${importPath}`);
      const tgtId = createSymbolId(repositoryName, filePath, importPath);
      relationships.push(this.createRelationship(srcId, tgtId, RelationshipKind.IMPORTS, { importPath }));
    }

    return { symbols, relationships, errors: [], warnings: [] };
  }

  /**
   * Map bridge kind strings (UPPERCASE) to SymbolKind enum values (lowercase).
   */
  private static readonly KIND_MAP: Record<string, SymbolKind> = {
    CLASS: SymbolKind.CLASS,
    INTERFACE: SymbolKind.INTERFACE,
    ENUM: SymbolKind.ENUM,
    STRUCT: SymbolKind.STRUCT,
    RECORD: SymbolKind.RECORD,
    METHOD: SymbolKind.METHOD,
    FUNCTION: SymbolKind.FUNCTION,
    CONSTRUCTOR: SymbolKind.CONSTRUCTOR,
    DESTRUCTOR: SymbolKind.METHOD,
    PROPERTY: SymbolKind.PROPERTY,
    FIELD: SymbolKind.FIELD,
    CONSTANT: SymbolKind.CONSTANT,
    ENUM_MEMBER: SymbolKind.FIELD,
    DELEGATE: SymbolKind.TYPE_ALIAS,
    EVENT: SymbolKind.EVENT,
    CONTROLLER: SymbolKind.CONTROLLER,
    SERVICE: SymbolKind.SERVICE,
    REPOSITORY: SymbolKind.REPOSITORY,
    DTO: SymbolKind.DTO,
    ENTITY: SymbolKind.ENTITY,
    COMMAND: SymbolKind.COMMAND,
    QUERY: SymbolKind.QUERY,
    MIDDLEWARE: SymbolKind.MIDDLEWARE,
    GUARD: SymbolKind.GUARD,
    INTERCEPTOR: SymbolKind.INTERCEPTOR,
    PROVIDER: SymbolKind.PROVIDER,
    FACTORY: SymbolKind.FACTORY,
    CONFIG: SymbolKind.CONFIG,
    MIGRATION: SymbolKind.MIGRATION,
    TEST: SymbolKind.TEST,
    ROUTE: SymbolKind.ROUTE,
    VALIDATOR: SymbolKind.SERVICE,
    EXCEPTION: SymbolKind.CLASS,
    EXTENSION_METHOD: SymbolKind.METHOD,
  };

  private normalizeSymbols(raw: RawCSharpSymbol[]): Symbol[] {
    return raw.map((r) => {
      // Use contentHash from bridge if available, compute it if not
      const hash = r.contentHash || (r.sourceSnippet ? hashContent(r.sourceSnippet) : "");
      return {
        id: r.id,
        name: r.name,
        kind: CSharpAnalyzer.KIND_MAP[r.kind] || SymbolKind.CLASS,
        language: Language.CSHARP,
        location: r.location ?? {
          repository: "", relativePath: "", startLine: 1, endLine: 1,
          startColumn: 0, endColumn: 0,
        },
        namespace: r.namespace ?? "",
        parentClass: r.parentClass ?? null,
        signature: r.signature ?? null,
        docComment: r.docComment ?? null,
        sourceSnippet: r.sourceSnippet ?? "",
        contentHash: hash,
        metadata: r.metadata ?? {},
      };
    });
  }

  private normalizeRelationships(raw: RawCSharpRelationship[]): Relationship[] {
    return raw.map((r) => ({
      id: r.id,
      sourceSymbolId: r.sourceSymbolId,
      targetSymbolId: r.targetSymbolId,
      // Bridge outputs UPPERCASE which matches RelationshipKind enum values directly
      kind: (r.kind as RelationshipKind) || RelationshipKind.REFERENCES,
      metadata: r.metadata ?? {},
    }));
  }

  private extractNamespace(content: string): string | null {
    const match = content.match(/namespace\s+([\w.]+)\s*[;{]/);
    return match ? match[1]! : null;
  }

  private getLine(content: string, index: number): number {
    return content.slice(0, index).split("\n").length;
  }

  private detectConvention(sym: Symbol, filePath: string): void {
    const isTest = filePath.includes("Test") || filePath.includes("Tests") || sym.name.endsWith("Tests");
    const name = sym.name;

    if (name.endsWith("Controller")) sym.kind = SymbolKind.CONTROLLER;
    else if (name.endsWith("Service")) sym.kind = SymbolKind.SERVICE;
    else if (name.endsWith("Repository")) sym.kind = SymbolKind.REPOSITORY;
    else if (name.endsWith("DTO") || name.endsWith("Dto")) sym.kind = SymbolKind.DTO;
    else if (name.endsWith("Entity") || name.endsWith("Model")) sym.kind = SymbolKind.ENTITY;
    else if (name.endsWith("Middleware")) sym.kind = SymbolKind.MIDDLEWARE;
    else if (name.endsWith("Handler")) sym.kind = SymbolKind.CONTROLLER;
    else if (name.endsWith("Factory")) sym.kind = SymbolKind.FACTORY;

    if (isTest) { sym.kind = SymbolKind.TEST; sym.metadata["isTest"] = true; }
  }
}
