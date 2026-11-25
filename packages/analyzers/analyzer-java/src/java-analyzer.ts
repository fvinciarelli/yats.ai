import { Language, SymbolKind, RelationshipKind } from "@yats/shared";
import type { Symbol, Relationship, AnalysisResult, AnalysisError } from "@yats/shared";
import { AbstractAnalyzer } from "@yats/analyzer-interface";
import { hashContent, createSymbolId } from "@yats/shared";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================
// Java Analyzer — spawns the JavaParser bridge (shaded jar)
// ============================================================

const JAVA_EXTENSIONS = new Set([".java"]);

interface JavaBridgeResult {
  symbols: RawJavaSymbol[];
  relationships: RawJavaRelationship[];
  errors: AnalysisError[];
  warnings: AnalysisError[];
}

interface RawJavaSymbol {
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

interface RawJavaRelationship {
  id: string;
  sourceSymbolId: string;
  targetSymbolId: string;
  kind: string;
  metadata: Record<string, unknown>;
}

/** Candidate jar locations, in priority order (container env wins). */
function defaultJarCandidates(dir: string): string[] {
  const candidates: string[] = [];
  if (process.env.YATS_JAVA_BRIDGE) candidates.push(process.env.YATS_JAVA_BRIDGE);
  candidates.push(
    path.join(dir, "java-bridge", "target", "yats-java-bridge.jar"),
    path.join(dir, "..", "src", "java-bridge", "target", "yats-java-bridge.jar"),
    "/usr/local/lib/yats-java-bridge/yats-java-bridge.jar",
  );
  return candidates;
}

export class JavaAnalyzer extends AbstractAnalyzer {
  readonly language = Language.JAVA;
  private readonly bridgeJar: string | null;

  constructor(bridgeJar?: string) {
    super();
    const dir = import.meta.dirname;
    const candidates = bridgeJar
      ? [bridgeJar]
      : defaultJarCandidates(dir);
    this.bridgeJar = candidates.find((c) => {
      try {
        return fs.existsSync(c) && fs.statSync(c).size > 0;
      } catch {
        return false;
      }
    }) ?? null;
  }

  canAnalyze(filePath: string, _content: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return JAVA_EXTENSIONS.has(ext);
  }

  async analyze(
    filePath: string,
    content: string,
    repositoryName: string,
  ): Promise<AnalysisResult> {
    if (!this.bridgeJar) {
      return this.analyzeFallback(filePath, content, repositoryName);
    }
    try {
      return await this.analyzeWithBridge(filePath, content, repositoryName);
    } catch (err) {
      const result = this.analyzeFallback(filePath, content, repositoryName);
      result.errors.push(this.bridgeFailureWarning("java", err));
      return result;
    }
  }

  private async analyzeWithBridge(
    filePath: string,
    content: string,
    repositoryName: string,
  ): Promise<AnalysisResult> {
    const jar = this.bridgeJar!;
    return new Promise((resolve, reject) => {
      const proc = spawn("java", [
        "-jar", jar,
        "--file", filePath,
        "--repo", repositoryName,
        "--stdin",
      ], {
        timeout: 30000,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

      proc.on("close", (code: number) => {
        if (code !== 0) {
          reject(new Error(`Java bridge exited with code ${code}: ${stderr}`));
          return;
        }
        try {
          const result = JSON.parse(stdout) as JavaBridgeResult;
          resolve({
            symbols: this.normalizeSymbols(result.symbols),
            relationships: this.normalizeRelationships(result.relationships),
            errors: result.errors ?? [],
            warnings: result.warnings ?? [],
          });
        } catch (err: any) {
          reject(new Error(`Failed to parse Java bridge output: ${err.message}`));
        }
      });

      proc.on("error", reject);

      proc.stdin!.write(content);
      proc.stdin!.end();
    });
  }

  // ============================================================
  // Fallback: regex-based (no JVM available) — degraded, name-based
  // ============================================================

  private analyzeFallback(
    filePath: string,
    content: string,
    repositoryName: string,
  ): AnalysisResult {
    const symbols: Symbol[] = [];
    const relationships: Relationship[] = [];
    const pkgMatch = content.match(/package\s+([\w.]+)\s*;/);
    const namespace = pkgMatch?.[1] ?? "";

    const typeRe = /\b(public\s+|protected\s+|private\s+)?(abstract\s+|final\s+)?(class|interface|enum|record)\s+(\w+)(?:\s+extends\s+([\w.<>?]+))?(?:\s+implements\s+([\w.<>?,\s]+))?/g;
    let m: RegExpExecArray | null;
    while ((m = typeRe.exec(content)) !== null) {
      const name = m[4]!;
      const kindRaw = m[3]!;
      const kind =
        kindRaw === "interface" ? SymbolKind.INTERFACE :
        kindRaw === "enum" ? SymbolKind.ENUM :
        kindRaw === "record" ? SymbolKind.RECORD :
        SymbolKind.CLASS;
      const id = createSymbolId(repositoryName, filePath, `${namespace}.${name}`);
      const sym = this.createSymbol({
        id, name, kind, language: Language.JAVA,
        repository: repositoryName, relativePath: filePath, namespace,
        startLine: this.getLine(content, m.index),
        signature: m[0],
        metadata: { abstract: m[2]?.includes("abstract") ?? false },
      });
      this.detectConvention(sym, filePath);
      symbols.push(sym);

      if (m[5]) {
        const t = createSymbolId(repositoryName, filePath, `${m[5]}`);
        relationships.push(this.createRelationship(id, t, RelationshipKind.INHERITS));
      }
      if (m[6]) {
        for (const iface of m[6].split(",")) {
          const t = createSymbolId(repositoryName, filePath, `${iface.trim()}`);
          relationships.push(this.createRelationship(id, t, RelationshipKind.IMPLEMENTS));
        }
      }
    }

    const memberRe = /(?:@\w+(?:\([^)]*\))?\s*)*(public\s+|protected\s+|private\s+)?(static\s+|final\s+|abstract\s+)*(?:([\w.<>?\[\]]+)\s+)?(\w+)\s*\(([^)]*)\)\s*(?:\{|\;)/g;
    while ((m = memberRe.exec(content)) !== null) {
      const name = m[4]!;
      const parent = this.findEnclosingType(content, m.index, repositoryName, filePath);
      if (!parent) continue;
      const kind = name === parent.name ? SymbolKind.CONSTRUCTOR : SymbolKind.METHOD;
      const id = createSymbolId(repositoryName, filePath, `${namespace}.${parent.name}.${name}`);
      const sym = this.createSymbol({
        id, name, kind, language: Language.JAVA,
        repository: repositoryName, relativePath: filePath, namespace,
        parentClass: parent.name,
        startLine: this.getLine(content, m.index),
        signature: m[0],
      });
      symbols.push(sym);
      relationships.push(
        this.createRelationship(parent.id, id, RelationshipKind.CONTAINS),
      );
    }

    const fieldRe = /(?:public\s+|protected\s+|private\s+)?(?:static\s+|final\s+)*(?:[\w.<>?\[\]]+)\s+(\w+)\s*(?:=|;)/g;
    while ((m = fieldRe.exec(content)) !== null) {
      const parent = this.findEnclosingType(content, m.index, repositoryName, filePath);
      if (!parent) continue;
      const name = m[1]!;
      const id = createSymbolId(repositoryName, filePath, `${namespace}.${parent.name}.${name}`);
      const sym = this.createSymbol({
        id, name, kind: SymbolKind.FIELD, language: Language.JAVA,
        repository: repositoryName, relativePath: filePath, namespace,
        parentClass: parent.name,
        startLine: this.getLine(content, m.index),
      });
      symbols.push(sym);
      relationships.push(
        this.createRelationship(parent.id, id, RelationshipKind.CONTAINS),
      );
    }

    return { symbols, relationships, errors: [], warnings: [] };
  }

  private findEnclosingType(
    content: string,
    index: number,
    repositoryName: string,
    filePath: string,
  ): { name: string; id: string } | null {
    const before = content.slice(0, index);
    const matches = [...before.matchAll(/\b(?:class|interface|enum|record)\s+(\w+)/g)];
    if (matches.length === 0) return null;
    const last = matches[matches.length - 1]!;
    const id = createSymbolId(repositoryName, filePath, `${last[1]}`);
    return { name: last[1]!, id };
  }

  private getLine(content: string, index: number): number {
    return content.slice(0, index).split("\n").length;
  }

  private detectConvention(sym: Symbol, filePath: string): void {
    const isTest = filePath.includes("/test/") || /Test\.java$/.test(filePath);
    const name = sym.name;
    if (name.endsWith("Controller")) {
      sym.kind = SymbolKind.CONTROLLER;
    } else if (name.endsWith("Service")) {
      sym.kind = SymbolKind.SERVICE;
    } else if (name.endsWith("Repository")) {
      sym.kind = SymbolKind.REPOSITORY;
    } else if (name.endsWith("DTO") || name.endsWith("Dto")) {
      sym.kind = SymbolKind.DTO;
    } else if (name.endsWith("Entity") || name.endsWith("Model")) {
      sym.kind = SymbolKind.ENTITY;
    } else if (name.endsWith("Command")) {
      sym.kind = SymbolKind.COMMAND;
    } else if (name.endsWith("Event")) {
      sym.kind = SymbolKind.EVENT;
    } else if (name.endsWith("Factory")) {
      sym.kind = SymbolKind.FACTORY;
    }
    if (isTest) {
      sym.kind = SymbolKind.TEST;
      sym.metadata["isTest"] = true;
    }
  }

  // ============================================================
  // Normalization
  // ============================================================

  private normalizeSymbols(raw: RawJavaSymbol[]): Symbol[] {
    return raw.map((r) => ({
      id: r.id,
      name: r.name,
      kind: (r.kind as SymbolKind) || SymbolKind.CLASS,
      language: Language.JAVA,
      location: r.location ?? {
        repository: "", relativePath: "", startLine: 1, endLine: 1,
        startColumn: 0, endColumn: 0,
      },
      namespace: r.namespace ?? "",
      parentClass: r.parentClass ?? null,
      signature: r.signature ?? null,
      docComment: r.docComment ?? null,
      sourceSnippet: r.sourceSnippet ?? "",
      contentHash: r.contentHash ?? hashContent(r.sourceSnippet ?? ""),
      metadata: r.metadata ?? {},
    }));
  }

  private normalizeRelationships(raw: RawJavaRelationship[]): Relationship[] {
    return raw.map((r) => ({
      id: r.id,
      sourceSymbolId: r.sourceSymbolId,
      targetSymbolId: r.targetSymbolId,
      kind: (r.kind as RelationshipKind) || RelationshipKind.REFERENCES,
      metadata: r.metadata ?? {},
    }));
  }
}
