import { Language, SymbolKind, RelationshipKind } from "@yats/shared";
import type { Symbol, Relationship, AnalysisResult } from "@yats/shared";
import { AbstractAnalyzer } from "@yats/analyzer-interface";
import { createSymbolId } from "@yats/shared";
import { spawn } from "node:child_process";
import * as path from "node:path";

// ============================================================
// Rust Analyzer — semantic analysis via the rust-analyzer LSP
//
// Spawns the `rust-analyzer` binary, speaks JSON-RPC over stdio, and pulls
// documentSymbol + callHierarchy/incomingCalls for one file at a time.
// Files are "detached" (no cargo workspace is available inside the indexing
// container), so rust-analyzer degrades gracefully to parse-level semantics
// (symbols + impl/trait structure + incoming calls). If the binary is
// unavailable, a regex fallback keeps indexing working.
// ============================================================

const RUST_EXTENSIONS = new Set([".rs"]);

interface LspPosition { line: number; character: number }
interface LspRange { start: LspPosition; end: LspPosition }

/** rust-analyzer returns the FLAT SymbolInformation[] variant of documentSymbol. */
interface LspSymbolInfo {
  name: string;
  kind: number;
  location: { uri: string; range: LspRange };
  containerName?: string;
}

interface CallHierarchyItem {
  name: string;
  kind: number;
  uri: string;
  range: LspRange;
  selectionRange: LspRange;
  data?: unknown;
}

interface IncomingCall {
  from: CallHierarchyItem;
  fromRanges: LspRange[];
}

interface PendingRequest {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/** Minimal LSP JSON-RPC client over a child process. */
class LspClient {
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private dead = false;

  constructor(private readonly proc: ReturnType<typeof spawn>) {
    proc.stdout!.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.pump();
    });
    proc.stderr!.on("data", () => { /* rust-analyzer logs — ignored */ });
    proc.on("error", () => this.failAll(new Error("rust-analyzer process error")));
    proc.on("exit", () => this.failAll(new Error("rust-analyzer exited")));
  }

  private pump(): void {
    for (;;) {
      const sep = this.buffer.indexOf("\r\n\r\n");
      if (sep === -1) return;
      const header = this.buffer.subarray(0, sep).toString("utf-8");
      const m = header.match(/Content-Length:\s*(\d+)/i);
      const total = sep + 4 + (m ? parseInt(m[1] ?? "0", 10) : 0);
      if (this.buffer.length < total) return;
      const body = this.buffer.subarray(sep + 4, total).toString("utf-8");
      this.buffer = this.buffer.subarray(total, this.buffer.length);
      if (!m) continue;
      let msg: any;
      try {
        msg = JSON.parse(body);
      } catch {
        continue;
      }
      if (msg && typeof msg.id === "number") {
        const p = this.pending.get(msg.id);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message ?? "LSP error"));
          else p.resolve(msg.result);
        }
      }
    }
  }

  request(method: string, params: unknown, timeoutMs = 15000): Promise<any> {
    if (this.dead) return Promise.reject(new Error("LSP session dead"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private send(msg: unknown): void {
    const body = JSON.stringify(msg);
    this.proc.stdin!.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }

  private failAll(err: Error): void {
    this.dead = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  close(): void {
    try {
      this.notify("shutdown");
    } catch { /* ignore */ }
    this.proc.kill();
  }
}

// LSP SymbolKind numeric values (subset we map)
const LSP = {
  MODULE: 2, CLASS: 5, METHOD: 6, PROPERTY: 7, FIELD: 8, CONSTRUCTOR: 9,
  ENUM: 10, INTERFACE: 11, FUNCTION: 12, VARIABLE: 13, CONSTANT: 14,
  ENUM_MEMBER: 22, STRUCT: 23,
} as const;

interface RustSymbolDraft {
  name: string;
  kind: SymbolKind;
  range: LspRange;
  modulePath: string; // full "mod::Sub::Name" chain
  namespace: string;
  parentClass: string | null;
}

function inRange(pos: LspPosition, r: LspRange): boolean {
  const a = pos.line > r.start.line || (pos.line === r.start.line && pos.character >= r.start.character);
  const b = pos.line < r.end.line || (pos.line === r.end.line && pos.character <= r.end.character);
  return a && b;
}

/** Parse an impl pseudo-item name into (trait?, target). */
function parseImpl(name: string): { trait: string | null; target: string } | null {
  const m = name.match(/^impl(?:<[^>]*>)?\s+(.+?)\s+for\s+([\w:]+)/);
  if (m) return { trait: m[1]!, target: m[2]! };
  const m2 = name.match(/^impl(?:<[^>]*>)?\s+([\w:]+)/);
  if (m2) return { trait: null, target: m2[1]! };
  return null;
}

function shortName(qualified: string): string {
  return qualified.split("::").pop() ?? qualified;
}

export class RustAnalyzer extends AbstractAnalyzer {
  readonly language = Language.RUST;
  private readonly binary: string;

  constructor(binary?: string) {
    super();
    this.binary = binary ?? process.env.YATS_RUST_BRIDGE ?? "rust-analyzer";
  }

  canAnalyze(filePath: string, _content: string): boolean {
    return RUST_EXTENSIONS.has(path.extname(filePath).toLowerCase());
  }

  async analyze(
    filePath: string,
    content: string,
    repositoryName: string,
  ): Promise<AnalysisResult> {
    try {
      return await this.analyzeWithLsp(filePath, content, repositoryName);
    } catch {
      return this.analyzeFallback(filePath, content, repositoryName);
    }
  }

  // ============================================================
  // LSP analysis (rust-analyzer)
  // ============================================================

  private async analyzeWithLsp(
    filePath: string,
    content: string,
    repositoryName: string,
  ): Promise<AnalysisResult> {
    const proc = spawn(this.binary, [], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60000,
      cwd: "/tmp", // neutral dir — no workspace to load, detached-file mode
    });
    const client = new LspClient(proc);
    const killer = setTimeout(() => client.close(), 55000);

    try {
      await client.request("initialize", {
        processId: null,
        rootUri: null,
        workspaceFolders: null,
        capabilities: {},
      });
      client.notify("initialized", {});
      // File URIs must be absolute ("file:///...") or rust-analyzer rejects
      // them with "url is not a file". The file is detached (content came via
      // stdin), so the path is synthetic — only the URI shape matters.
      const uri = "file:///" + filePath.split("/").map(encodeURIComponent).join("/");
      client.notify("textDocument/didOpen", {
        textDocument: { uri, languageId: "rust", version: 1, text: content },
      });

      const raw: LspSymbolInfo[] | null = await client.request(
        "textDocument/documentSymbol",
        { textDocument: { uri } },
        30000,
      );
      if (!raw || raw.length === 0) throw new Error("rust-analyzer returned no symbols");

      const drafts: RustSymbolDraft[] = [];
      const implEdges: Array<{ source: string; target: string }> = [];
      const byName = new Map<string, LspSymbolInfo>();

      for (const item of raw) byName.set(item.name, item);

      // Resolve the container chain (flat SymbolInformation has containerName)
      const chainOf = (item: LspSymbolInfo, depth = 0): string[] => {
        if (depth > 10 || !item.containerName) return [];
        const parent = byName.get(item.containerName);
        const parentChain = parent ? chainOf(parent, depth + 1) : [];
        return [...parentChain, item.containerName];
      };

      for (const item of raw) {
        if (/^impl\b/.test(item.name)) {
          const parsed = parseImpl(item.name);
          if (parsed?.trait) implEdges.push({ source: parsed.target, target: parsed.trait });
          continue;
        }
        const kind = this.mapKind(item);
        if (!kind) continue;

        const chain = [...chainOf(item), item.name];
        const container = item.containerName ?? null;
        // Methods inside an impl have containerName "impl Type" — normalize
        // to the target type. Modules are namespaces, not parent classes.
        let parentClass: string | null = null;
        if (container) {
          if (container.startsWith("impl ")) {
            const parsed = parseImpl(container);
            parentClass = parsed ? shortName(parsed.target) : container.replace(/^impl\s+/, "");
          } else if (byName.get(container)?.kind !== LSP.MODULE) {
            parentClass = shortName(container);
          }
        }
        drafts.push({
          name: item.name,
          kind,
          range: item.location.range,
          modulePath: chain.join("::"),
          namespace: container ? shortName(container.replace(/^impl\s+/, "")) : "",
          parentClass,
        });
      }

      if (drafts.length === 0) throw new Error("no mappable symbols");

      // Build symbol objects
      const symbols: Symbol[] = drafts.map((d) => {
        return this.createSymbol({
          id: createSymbolId(repositoryName, filePath, d.modulePath),
          name: d.name,
          kind: d.kind,
          language: Language.RUST,
          repository: repositoryName,
          relativePath: filePath,
          namespace: d.namespace,
          parentClass: d.parentClass,
          startLine: d.range.start.line + 1,
          endLine: d.range.end.line + 1,
        });
      });
      const idByName = new Map<string, string>();
      for (let i = 0; i < drafts.length; i++) {
        idByName.set(drafts[i]!.modulePath, symbols[i]!.id);
      }

      const relationships: Relationship[] = [];

      // CONTAINS: nearest enclosing symbol for each draft
      for (let i = 0; i < drafts.length; i++) {
        const d = drafts[i]!;
        let parentIdx = -1;
        for (let j = 0; j < drafts.length; j++) {
          if (j === i) continue;
          const p = drafts[j]!;
          if (inRange(d.range.start, p.range) && p.range.start.line < d.range.start.line) {
            if (parentIdx === -1 || drafts[parentIdx]!.range.start.line < p.range.start.line) {
              parentIdx = j;
            }
          }
        }
        if (parentIdx !== -1) {
          relationships.push(this.createRelationship(
            symbols[parentIdx]!.id,
            symbols[i]!.id,
            RelationshipKind.CONTAINS,
          ));
        }
      }

      // IMPLEMENTS: trait impls collected during the walk
      for (const edge of implEdges) {
        const sourceId = idByName.get(edge.source)
          ?? createSymbolId(repositoryName, filePath, shortName(edge.source));
        const targetId = idByName.get(edge.target)
          ?? createSymbolId(repositoryName, filePath, shortName(edge.target));
        relationships.push(this.createRelationship(sourceId, targetId, RelationshipKind.IMPLEMENTS));
      }

      // CALLS — syntactic, name-based (call hierarchy needs a cargo
      // workspace, which detached files don't have). Targets are resolved
      // against the global symbol table during the indexing flush, like the
      // Go/PHP bridges.
      const KEYWORDS = new Set([
        "if", "else", "while", "for", "loop", "match", "return", "fn", "impl",
        "struct", "enum", "trait", "mod", "use", "let", "move", "async", "await",
        "pub", "where", "type", "const", "static", "as", "break", "continue",
        "in", "unsafe", "ref", "mut", "dyn", "box", "extern", "crate", "super",
        "self", "print", "println", "format", "vec", "clone", "Some", "None",
        "Ok", "Err", "unwrap", "expect", "to_string", "to_owned", "len", "new",
      ]);
      const lines = content.split("\n");
      const callRe = /\.([a-z_]\w*)\s*\(|([A-Z][\w:]*?)::([a-z_]\w*)\s*\(|\b([a-z_]\w*)\s*\(/g;
      const seenCalls = new Set<string>();
      let cm: RegExpExecArray | null;
      while ((cm = callRe.exec(content)) !== null) {
        const callee = cm[1] ?? cm[3] ?? cm[4]!;
        if (KEYWORDS.has(callee)) continue;
        const callLine = content.slice(0, cm.index).split("\n").length - 1;
        const pos = { line: callLine, character: cm.index };
        const caller = drafts.find(
          (d) =>
            (d.kind === SymbolKind.FUNCTION || d.kind === SymbolKind.METHOD) &&
            inRange(pos, d.range),
        );
        if (!caller) continue;
        const callerId = symbols[drafts.indexOf(caller)]!.id;
        const targetId = createSymbolId(repositoryName, filePath, callee);
        const key = `${callerId}->${targetId}`;
        if (seenCalls.has(key)) continue;
        seenCalls.add(key);
        relationships.push(this.createRelationship(callerId, targetId, RelationshipKind.CALLS));
      }

      return { symbols, relationships, errors: [], warnings: [] };
    } finally {
      clearTimeout(killer);
      client.close();
    }
  }

  private mapKind(item: LspSymbolInfo): SymbolKind | null {
    switch (item.kind) {
      case LSP.MODULE: return SymbolKind.MODULE;
      case LSP.STRUCT: return SymbolKind.STRUCT;
      case LSP.ENUM: return SymbolKind.ENUM;
      case LSP.INTERFACE: return SymbolKind.INTERFACE; // traits
      case LSP.FUNCTION: return SymbolKind.FUNCTION;
      case LSP.METHOD: return SymbolKind.METHOD;
      case LSP.CONSTRUCTOR: return SymbolKind.CONSTRUCTOR;
      case LSP.FIELD:
      case LSP.PROPERTY: return SymbolKind.FIELD;
      case LSP.CONSTANT:
      case LSP.ENUM_MEMBER: return SymbolKind.CONSTANT;
      case LSP.VARIABLE: return SymbolKind.VARIABLE;
      case LSP.CLASS: return SymbolKind.STRUCT; // unions
      default: return null;
    }
  }

  // ============================================================
  // Fallback: regex-based (no rust-analyzer available)
  // ============================================================

  private analyzeFallback(
    filePath: string,
    content: string,
    repositoryName: string,
  ): AnalysisResult {
    const symbols: Symbol[] = [];
    const relationships: Relationship[] = [];
    const lines = content.split("\n");

    // Track enclosing container per line (approximate)
    const containers: Array<{ name: string; line: number }> = [];
    const kindAtLine = new Map<number, SymbolKind>();

    const typeRe = /^\s*(pub(?:\([^)]*\))?\s+)?(struct|enum|trait|union|mod)\s+(\w+)/;
    const fnRe = /^\s*(pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)\s*\(/;
    const implRe = /^\s*impl(?:<[^>]*>)?\s+([\w:]+)(?:\s+for\s+([\w:]+))?\s*\{/;
    const constRe = /^\s*(pub(?:\([^)]*\))?\s+)?(const|static)\s+(\w+)\s*:/;
    const typeAliasRe = /^\s*(pub(?:\([^)]*\))?\s+)?type\s+(\w+)\s*=/;
    const useRe = /^\s*use\s+([\w:]+(?:\s*::\s*\{[^}]*\})?)/;

    lines.forEach((line, idx) => {
      let m: RegExpExecArray | null;

      if ((m = implRe.exec(line)) !== null) {
        const target = m[2] ? shortName(m[2]!) : shortName(m[1]!);
        containers.push({ name: target, line: idx });
        if (m[2]) {
          const sourceId = createSymbolId(repositoryName, filePath, target);
          const traitId = createSymbolId(repositoryName, filePath, shortName(m[1]!));
          relationships.push(this.createRelationship(sourceId, traitId, RelationshipKind.IMPLEMENTS));
        }
        return;
      }

      if ((m = typeRe.exec(line)) !== null) {
        const kw = m[2]!;
        const name = m[3]!;
        const kind =
          kw === "struct" ? SymbolKind.STRUCT :
          kw === "enum" ? SymbolKind.ENUM :
          kw === "trait" ? SymbolKind.INTERFACE :
          kw === "union" ? SymbolKind.STRUCT :
          SymbolKind.MODULE;
        const parent = containers[containers.length - 1];
        const id = createSymbolId(repositoryName, filePath, name);
        symbols.push(this.createSymbol({
          id, name, kind, language: Language.RUST,
          repository: repositoryName, relativePath: filePath,
          namespace: parent ? parent.name : "",
          parentClass: parent && kind !== SymbolKind.MODULE ? parent.name : null,
          startLine: idx + 1,
        }));
        kindAtLine.set(idx, kind);
        containers.push({ name, line: idx });
        return;
      }

      if ((m = fnRe.exec(line)) !== null) {
        const name = m[2]!;
        const parent = containers[containers.length - 1];
        const id = createSymbolId(repositoryName, filePath, name);
        symbols.push(this.createSymbol({
          id, name,
          kind: parent && kindAtLine.get(parent.line) !== SymbolKind.MODULE ? SymbolKind.METHOD : SymbolKind.FUNCTION,
          language: Language.RUST,
          repository: repositoryName, relativePath: filePath,
          namespace: parent ? parent.name : "",
          parentClass: parent && kindAtLine.get(parent.line) !== SymbolKind.MODULE ? parent.name : null,
          startLine: idx + 1,
        }));
        if (parent) {
          const parentId = createSymbolId(repositoryName, filePath, parent.name);
          relationships.push(this.createRelationship(parentId, id, RelationshipKind.CONTAINS));
        }
        return;
      }

      if ((m = constRe.exec(line)) !== null || (m = typeAliasRe.exec(line)) !== null) {
        const name = m[m.length - 1]!;
        const parent = containers[containers.length - 1];
        symbols.push(this.createSymbol({
          id: createSymbolId(repositoryName, filePath, name),
          name,
          kind: SymbolKind.CONSTANT,
          language: Language.RUST,
          repository: repositoryName, relativePath: filePath,
          namespace: parent ? parent.name : "",
          parentClass: parent ? parent.name : null,
          startLine: idx + 1,
        }));
        return;
      }

      if ((m = useRe.exec(line)) !== null) {
        const target = shortName(m[1]!.replace(/\s+/g, "").split("::").slice(-1)[0]!);
        const fileNodeId = createSymbolId(repositoryName, filePath, "_file_");
        relationships.push(this.createRelationship(
          fileNodeId,
          createSymbolId(repositoryName, filePath, target),
          RelationshipKind.IMPORTS,
        ));
      }
    });

    return { symbols, relationships, errors: [], warnings: [] };
  }
}
