import { Language, SymbolKind, RelationshipKind } from "@yats/shared";
import type { Symbol, Relationship, AnalysisResult } from "@yats/shared";
import { AbstractAnalyzer } from "@yats/analyzer-interface";
import { hashContent, createSymbolId } from "@yats/shared";
import { spawn } from "node:child_process";
import * as path from "node:path";

// ============================================================
// Go Analyzer — spawns Go bridge process
// ============================================================

const GO_EXTENSIONS = new Set([".go"]);

interface GoBridgeResult {
  symbols: RawGoSymbol[];
  relationships: RawGoRelationship[];
  errors: string[];
  warnings: string[];
}

interface RawGoSymbol {
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

interface RawGoRelationship {
  id: string;
  sourceSymbolId: string;
  targetSymbolId: string;
  kind: string;
  metadata: Record<string, unknown>;
}

export class GoAnalyzer extends AbstractAnalyzer {
  readonly language = Language.GO;
  private readonly bridgePath: string;

  constructor(bridgePath?: string) {
    super();
    if (bridgePath) {
      this.bridgePath = bridgePath;
    } else {
      const dir = import.meta.dirname;
      if (dir.endsWith("/dist")) {
        this.bridgePath = path.join(dir, "..", "src", "go-bridge", "analyze.go");
      } else {
        this.bridgePath = path.join(dir, "go-bridge", "analyze.go");
      }
    }
  }

  canAnalyze(filePath: string, _content: string): boolean {
    return GO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
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
    // In Docker: use pre-compiled binary. In dev: use "go run".
    const bridgeBin = process.env.YATS_GO_BRIDGE;
    const fs = await import("node:fs");

    const useBinary = bridgeBin && fs.existsSync(bridgeBin) && fs.statSync(bridgeBin).size > 0;
    const cmd = useBinary ? bridgeBin : "go";
    const args = useBinary
      ? ["--file", filePath, "--repo", repositoryName, "--stdin"]
      : ["run", this.bridgePath, "--file", filePath, "--repo", repositoryName, "--stdin"];

    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, {
        timeout: 30000,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

      proc.on("close", (code: number) => {
        if (code !== 0) {
          reject(new Error(`Go bridge exited with code ${code}: ${stderr}`));
          return;
        }
        try {
          const result = JSON.parse(stdout) as GoBridgeResult;
          resolve({
            symbols: this.normalizeSymbols(result.symbols),
            relationships: this.normalizeRelationships(result.relationships),
            errors: (result.errors ?? []).map((e: string) => ({
              message: e, line: 0, column: 0, severity: "error" as const,
            })),
            warnings: (result.warnings ?? []) as any[],
          });
        } catch (err: any) {
          reject(new Error(`Failed to parse Go bridge output: ${err.message}`));
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
    const namespace = filePath.replace(/\//g, ".").replace(/\.go$/, "");

    // Structs
    const structRe = /type\s+(\w+)\s+struct\s*\{/g;
    let match;
    while ((match = structRe.exec(content)) !== null) {
      const name = match[1]!;
      const id = createSymbolId(repositoryName, filePath, `${namespace}.${name}`);
      const sym = this.createSymbol({
        id, name, kind: SymbolKind.STRUCT, language: Language.GO,
        repository: repositoryName, relativePath: filePath, namespace,
        startLine: this.getLine(content, match.index),
      });
      this.detectConvention(sym, filePath);
      symbols.push(sym);
    }

    // Interfaces
    const ifaceRe = /type\s+(\w+)\s+interface\s*\{/g;
    while ((match = ifaceRe.exec(content)) !== null) {
      const name = match[1]!;
      const id = createSymbolId(repositoryName, filePath, `${namespace}.${name}`);
      symbols.push(this.createSymbol({
        id, name, kind: SymbolKind.INTERFACE, language: Language.GO,
        repository: repositoryName, relativePath: filePath, namespace,
        startLine: this.getLine(content, match.index),
      }));
    }

    // Functions (with or without receiver)
    const funcRe = /func\s+(?:\(\s*\w+\s+\*?(\w+)\s*\)\s+)?(\w+)\s*\(/g;
    while ((match = funcRe.exec(content)) !== null) {
      const receiver = match[1] ?? null;
      const name = match[2]!;
      const kind = receiver ? "method" : "function";
      const id = createSymbolId(repositoryName, filePath, `${namespace}.${name}`);
      symbols.push(this.createSymbol({
        id, name,
        kind: kind === "method" ? SymbolKind.METHOD : SymbolKind.FUNCTION,
        language: Language.GO,
        repository: repositoryName, relativePath: filePath, namespace,
        parentClass: receiver,
        startLine: this.getLine(content, match.index),
        signature: match[0],
      }));

      if (receiver) {
        const recvId = createSymbolId(repositoryName, filePath, `${namespace}.${receiver}`);
        relationships.push(this.createRelationship(recvId, id, RelationshipKind.CONTAINS));
      }
    }

    return { symbols, relationships, errors: [], warnings: [] };
  }

  private normalizeSymbols(raw: RawGoSymbol[]): Symbol[] {
    return raw.map((r) => ({
      id: r.id,
      name: r.name,
      kind: (r.kind as SymbolKind) || SymbolKind.STRUCT,
      language: Language.GO,
      location: r.location ?? {
        repository: "", relativePath: "", startLine: 1, endLine: 1,
        startColumn: 0, endColumn: 0,
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

  private normalizeRelationships(raw: RawGoRelationship[]): Relationship[] {
    return raw.map((r) => ({
      id: r.id,
      sourceSymbolId: r.sourceSymbolId,
      targetSymbolId: r.targetSymbolId,
      kind: (r.kind as RelationshipKind) || RelationshipKind.REFERENCES,
      metadata: r.metadata ?? {},
    }));
  }

  private getLine(content: string, index: number): number {
    return content.slice(0, index).split("\n").length;
  }

  private detectConvention(sym: Symbol, filePath: string): void {
    const isTest = filePath.endsWith("_test.go");
    const name = sym.name;

    if (name.endsWith("Service")) {
      sym.kind = SymbolKind.SERVICE;
    } else if (name.endsWith("Controller") || name.endsWith("Handler")) {
      sym.kind = SymbolKind.CONTROLLER;
    } else if (name.endsWith("Repository")) {
      sym.kind = SymbolKind.REPOSITORY;
    } else if (name.endsWith("DTO") || name.endsWith("Dto")) {
      sym.kind = SymbolKind.DTO;
    } else if (name.endsWith("Entity") || name.endsWith("Model")) {
      sym.kind = SymbolKind.ENTITY;
    } else if (name.endsWith("Middleware")) {
      sym.kind = SymbolKind.MIDDLEWARE;
    }

    if (isTest) {
      sym.kind = SymbolKind.TEST;
      sym.metadata["isTest"] = true;
    }
  }
}
