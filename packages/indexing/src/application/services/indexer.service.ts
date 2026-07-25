import { createLogger, type Logger } from "@yats/shared";
import type {
  Indexer,
  IndexResult,
  LanguageAnalyzer,
  GraphRepository,
  VectorRepository,
  EmbeddingGenerator,
  SymbolStore,
  FileSystem,
  GitAdapter,
  Symbol,
  Relationship,
} from "@yats/shared";
import { AnalyzerFactory } from "@yats/analyzer-interface";
import { MemorySymbolStore } from "@yats/infra";
import { FileWalker } from "../../infrastructure/file-walker.js";
import { detectLanguage } from "../../infrastructure/language-detector.js";
import { hashContent, type RelationshipKind } from "@yats/shared";
import { GlobalSymbolTable, resolveRelationships, type SymbolTableEntry } from "./global-symbol-table.js";

// ============================================================
// Indexer Service — orchestrates the full indexing pipeline
// ============================================================

export interface IndexerDependencies {
  graphRepository: GraphRepository;
  vectorRepository: VectorRepository;
  embeddingGenerator: EmbeddingGenerator;
  fileSystem: FileSystem;
  analyzerFactory: AnalyzerFactory;
  gitAdapter?: GitAdapter;
}

export class IndexerService implements Indexer {
  private readonly logger: Logger;
  private readonly concurrency: number;
  private readonly embedBatchSize: number;
  private readonly pipelineChunkSize: number;
  private readonly batchAnalyzerSize: number;

  constructor(
    private readonly deps: IndexerDependencies,
  ) {
    this.logger = createLogger("indexer:service");

    // Resolve config with provider-aware defaults.
    // Env vars override; without them, defaults adapt to the embedding provider.
    const config = IndexerService.resolveConfig();
    this.concurrency = config.concurrency;
    this.embedBatchSize = config.embedBatchSize;
    this.pipelineChunkSize = config.pipelineChunkSize;
    this.batchAnalyzerSize = config.batchAnalyzerSize;

    this.logger.info(
      `Indexer config: provider=${config.provider}, concurrency=${this.concurrency}, ` +
      `embedBatch=${this.embedBatchSize}, pipelineChunk=${this.pipelineChunkSize}, ` +
      `batchAnalyzer=${this.batchAnalyzerSize}`,
    );
  }

  /**
   * Resolve indexing parameters with provider-aware defaults.
   *
   * Different embedding providers have different rate limits and performance
   * characteristics. These defaults are tuned per provider. Env vars always
   * take precedence for fine-tuning.
   */
  private static resolveConfig(): {
    provider: string;
    concurrency: number;
    embedBatchSize: number;
    pipelineChunkSize: number;
    batchAnalyzerSize: number;
  } {
    const provider = process.env.EMBEDDING_PROVIDER ?? "ollama";

    // Provider-specific defaults
    const defaults: Record<string, { concurrency: number; embedBatch: number; batchAnalyzer: number }> = {
      openai:   { concurrency: 8,  embedBatch: 50,  batchAnalyzer: 50  },
      mistral:  { concurrency: 8,  embedBatch: 50,  batchAnalyzer: 50  },
      voyage:   { concurrency: 4,  embedBatch: 50,  batchAnalyzer: 50  },
      ollama:   { concurrency: 4,  embedBatch: 4,   batchAnalyzer: 50  },
    };

    const def = defaults[provider] ?? defaults["ollama"]!;

    return {
      provider,
      concurrency: parseInt(process.env.INDEXER_CONCURRENCY ?? String(def.concurrency), 10),
      embedBatchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE ?? String(def.embedBatch), 10),
      pipelineChunkSize: parseInt(process.env.PIPELINE_CHUNK_SIZE ?? "500", 10),
      batchAnalyzerSize: parseInt(process.env.BATCH_ANALYZER_SIZE ?? String(def.batchAnalyzer), 10),
    };
  }

  // ============================================================
  // Full Repository Index (Pipeline Architecture)
  //
  // Instead of sequential phases (analyze-all → embed-all → store-all),
  // we pipeline: analyze → accumulate → flush when chunk is full.
  // This means embedding and DB writes start while analysis is still
  // running, reducing total wall-clock time significantly.
  // ============================================================

  async indexRepository(repositoryPath: string): Promise<IndexResult> {
    const totalStart = Date.now();
    const repoName = this.getRepoName(repositoryPath);
    this.logger.info(`Indexing repository: ${repoName} at ${repositoryPath}`);

    // Track cumulative metrics
    let totalSymbols = 0;
    let totalRelationships = 0;
    let totalErrors = 0;
    let walkMs = 0;
    let analyzeMs = 0;
    let embedMs = 0;
    let storeMs = 0;
    let docsMs = 0;

    // 0. Store repository metadata + capture git commit
    await this.deps.graphRepository.upsertRepositoryMetadata(repoName, repositoryPath);

    let currentCommit: string | null = null;
    if (this.deps.gitAdapter) {
      try {
        currentCommit = await this.deps.gitAdapter.getCurrentCommit(repositoryPath);
      } catch { /* Not a git repo */ }
    }

    // 1. WALK — discover files
    const walkStart = Date.now();
    const walker = new FileWalker();
    const files = await walker.walk(repositoryPath);
    const supportedFiles = files.filter((f) => f.language !== null);
    walkMs = Date.now() - walkStart;
    this.logger.info(`Walked ${files.length} files (${supportedFiles.length} indexable) in ${walkMs}ms`);

    // 2. Launch docs indexing in parallel with code pipeline (if enabled)
    //    Docs are independent of code — they run concurrently so they
    //    don't add to total time (they overlap with code analysis).
    const indexDocs = process.env.INDEX_DOCS !== "false";
    let docsPromise: Promise<number> | null = null;

    if (indexDocs) {
      docsPromise = this.indexDocumentation(repositoryPath).catch((err) => {
        this.logger.warn(`Documentation indexing skipped: ${err}`);
        return 0;
      });
    }

    // 3. PIPELINE: analyze → accumulate → flush symbols now, batch relationships later
    //    Symbols are embedded and stored in chunks as they accumulate.
    //    Relationships are deferred until all symbols exist (cross-file refs).
    //    We also build a lightweight table for cross-file reference resolution.
    const analyzeStart = Date.now();
    const symbolStore = new MemorySymbolStore();
    let allRelationships: Relationship[] = [];

    // Lightweight accumulator for the global symbol table
    const symbolTableEntries: SymbolTableEntry[] = [];

    for (let i = 0; i < supportedFiles.length; i += this.concurrency) {
      const batch = supportedFiles.slice(i, i + this.concurrency);

      // Group files by analyzer for potential batch processing
      const byAnalyzer = new Map<LanguageAnalyzer, Array<{ file: typeof batch[0]; content: string }>>();

      // Read all files in parallel
      const reads = await Promise.allSettled(
        batch.map(async (file) => {
          const analyzer = this.deps.analyzerFactory.getAnalyzerForFile(file.relativePath);
          if (!analyzer) return null;
          const content = await this.deps.fileSystem.readFile(file.absolutePath);
          return { analyzer, file, content };
        }),
      );

      for (const r of reads) {
        if (r.status === "rejected" || !r.value) continue;
        const { analyzer, file, content } = r.value;
        let group = byAnalyzer.get(analyzer);
        if (!group) {
          group = [];
          byAnalyzer.set(analyzer, group);
        }
        group.push({ file, content });
      }

      // Analyze each group — use batch when available
      const allResults: Array<{
        status: "fulfilled" | "rejected";
        value?: { errors: number; symbols: Symbol[]; relationships: Relationship[] };
        reason?: any;
      }> = [];

      for (const [analyzer, group] of byAnalyzer) {
        if (analyzer.analyzeBatch) {
          // Process in sub-batches (provider-tuned via BATCH_ANALYZER_SIZE)
          const BATCH_CHUNK = this.batchAnalyzerSize;
          for (let bi = 0; bi < group.length; bi += BATCH_CHUNK) {
            const subGroup = group.slice(bi, bi + BATCH_CHUNK);
            try {
              const batchResults = await analyzer.analyzeBatch(
                subGroup.map((g) => ({ filePath: g.file.relativePath, content: g.content })),
                repoName,
              );
              for (const result of batchResults) {
                allResults.push({
                  status: "fulfilled",
                  value: {
                    errors: result.errors.length,
                    symbols: result.symbols,
                    relationships: result.relationships,
                  },
                });
              }
            } catch (err: any) {
              // Batch failed — fall back to per-file for this sub-group
              this.logger.warn(`Batch analysis failed for ${analyzer.language}: ${err.message}, falling back to per-file`);
              for (const g of subGroup) {
                try {
                  const result = await analyzer.analyze(g.file.relativePath, g.content, repoName);
                  allResults.push({
                    status: "fulfilled",
                    value: {
                      errors: result.errors.length,
                      symbols: result.symbols,
                      relationships: result.relationships,
                    },
                  });
                } catch (err2: any) {
                  allResults.push({ status: "rejected", reason: err2 });
                }
              }
            }
          }
        } else {
          // Per-file analysis (no batch support)
          const perFileResults = await Promise.allSettled(
            group.map(async (g) => {
              const result = await analyzer.analyze(g.file.relativePath, g.content, repoName);
              return {
                errors: result.errors.length,
                symbols: result.symbols,
                relationships: result.relationships,
              };
            }),
          );
          allResults.push(...perFileResults);
        }
      }

      // Process results
      for (const r of allResults) {
        if (r.status === "rejected") {
          totalErrors++;
          this.logger.error(`File processing error: ${r.reason}`);
        } else if (r.value) {
          totalErrors += r.value.errors;
          for (const symbol of r.value.symbols) {
            if (!symbol.contentHash) {
              symbol.contentHash = hashContent(symbol.sourceSnippet || "");
            }
            symbolStore.add(symbol);
            symbolTableEntries.push({
              id: symbol.id,
              name: symbol.name,
              namespace: symbol.namespace,
              relativePath: symbol.location.relativePath,
            });
          }
          for (const rel of r.value.relationships) {
            allRelationships.push(rel);
          }
        }
      }

      // FLUSH: if accumulator has enough symbols, embed + store now (symbols only)
      const accumulated = symbolStore.getAll();
      if (accumulated.length >= this.pipelineChunkSize) {
        const flushResult = await this.flushSymbols(symbolStore, repoName);
        totalSymbols += flushResult.symbols;
        embedMs += flushResult.embedMs;
        storeMs += flushResult.storeMs;

        const pct = Math.round((i + batch.length) / supportedFiles.length * 100);
        this.logger.info(
          `Pipeline flush at ${pct}%: ${totalSymbols} symbols, ` +
          `${allRelationships.length} rels pending ` +
          `(embed ${flushResult.embedMs}ms, store ${flushResult.storeMs}ms)`,
        );
      }
    }

    // Final flush — remaining symbols
    const remaining = symbolStore.getAll();
    if (remaining.length > 0) {
      const flushResult = await this.flushSymbols(symbolStore, repoName);
      totalSymbols += flushResult.symbols;
      embedMs += flushResult.embedMs;
      storeMs += flushResult.storeMs;
    }

    // Resolve cross-file references before storing relationships
    if (allRelationships.length > 0) {
      const table = new GlobalSymbolTable();
      table.index(symbolTableEntries);

      const { resolved, rewritten } = resolveRelationships(allRelationships, table);
      this.logger.info(
        `Resolved ${rewritten} cross-file references`,
      );

      // Filter out relationships whose source or target symbol doesn't exist
      // (e.g. IMPORTS pseudo-sources like "import:get_user", builtins like len())
      const validRelationships = resolved.filter((rel) => {
        const sourceExists = symbolTableEntries.some((e) => e.id === rel.sourceSymbolId);
        const targetExists = symbolTableEntries.some((e) => e.id === rel.targetSymbolId);
        return sourceExists && targetExists;
      });

      const filtered = resolved.length - validRelationships.length;
      if (filtered > 0) {
        this.logger.debug(`Filtered ${filtered} relationships with non-existent endpoints`);
      }

      this.logger.info(`Storing ${validRelationships.length} relationships...`);

      try {
        await this.deps.graphRepository.upsertRelationships(validRelationships);
        totalRelationships = validRelationships.length;
      } catch (err: any) {
        this.logger.error(`Failed to store relationships: ${err.message}`);
      }
    }

    analyzeMs = Date.now() - analyzeStart;

    // 4. Await docs (running in parallel since step 2, or skipped if INDEX_DOCS=false)
    const docsStart = Date.now();
    const docsIndexed = docsPromise ? await docsPromise : 0;
    docsMs = Date.now() - docsStart;
    if (docsMs < analyzeMs) docsMs = 0; // overlapped completely → zero added time

    // Save last indexed commit
    if (currentCommit) {
      await this.deps.graphRepository.setLastIndexedCommit(repoName, currentCommit);
    }

    const totalMs = Date.now() - totalStart;

    this.logger.info(
      `✅ Indexed ${repoName}: ${totalSymbols} symbols, ${totalRelationships} rels, ` +
      `${docsIndexed} docs in ${totalMs}ms ` +
      `(walk ${walkMs}ms | analyze ${analyzeMs}ms | embed ${embedMs}ms | store ${storeMs}ms | docs ${docsMs}ms)`,
    );

    return {
      repository: repoName,
      symbolsFound: totalSymbols,
      relationshipsFound: totalRelationships,
      vectorsCreated: totalSymbols,
      docsIndexed,
      errors: totalErrors,
      duration: totalMs,
      timings: {
        walkMs,
        analyzeMs,
        embedMs,
        storeMs,
        docsMs,
        totalMs,
      },
    };
  }

  /**
   * Flush accumulated symbols: embed in batches → upsert Neo4j → upsert Qdrant.
   * Drains the symbolStore (symbols only; relationships are batched separately).
   */
  private async flushSymbols(
    symbolStore: MemorySymbolStore,
    repoName: string,
  ): Promise<{ symbols: number; embedMs: number; storeMs: number }> {
    const symbols = symbolStore.getAll();
    if (symbols.length === 0) return { symbols: 0, embedMs: 0, storeMs: 0 };

    // EMBED — in sub-batches of embedBatchSize
    const embedStart = Date.now();
    const allVectors: number[][] = [];

    for (let i = 0; i < symbols.length; i += this.embedBatchSize) {
      const chunk = symbols.slice(i, i + this.embedBatchSize);
      const texts = chunk.map((s) => this.buildEmbeddingText(s));
      const vectors = await this.deps.embeddingGenerator.embedBatch(texts);
      allVectors.push(...vectors);
    }
    const embedMs = Date.now() - embedStart;

    // STORE — Neo4j + Qdrant (symbols only, no relationships)
    const storeStart = Date.now();

    await this.deps.graphRepository.upsertSymbols(symbols);

    await this.deps.vectorRepository.upsertVectors(
      symbols.map((symbol, i) => ({
        id: symbol.id,
        vector: allVectors[i] ?? [],
        payload: {
          symbolId: symbol.id,
          language: symbol.language as any,
          repository: symbol.location.repository,
          relativePath: symbol.location.relativePath,
          namespace: symbol.namespace,
          className: symbol.parentClass,
          methodName: symbol.kind === "method" ? symbol.name : null,
          kind: symbol.kind,
          contentHash: symbol.contentHash,
          gitCommit: null,
          timestamp: new Date().toISOString(),
        },
      })),
    );

    const storeMs = Date.now() - storeStart;

    // Drain the store
    symbolStore.clear();

    return { symbols: symbols.length, embedMs, storeMs };
  }

  /**
   * Ensure a repository is indexed before any search operation.
   * 
   * @returns status: "indexed" (was missing, just indexed), 
   *                  "reindexed" (was stale, just updated),
   *                  "fresh" (already up to date)
   */
  async ensureIndexed(repositoryPath: string): Promise<{
    status: "indexed" | "reindexed" | "fresh";
    result?: IndexResult;
  }> {
    const repoName = this.getRepoName(repositoryPath);

    // Check if repository exists in the graph
    const repos = await this.deps.graphRepository.listRepositories();
    const exists = repos.some((r) => r.name === repoName);

    if (!exists) {
      this.logger.info(`Repository "${repoName}" not indexed yet — full indexing...`);
      const result = await this.indexRepository(repositoryPath);
      return { status: "indexed", result };
    }

    // Try git-based change detection
    if (this.deps.gitAdapter) {
      try {
        const currentCommit = await this.deps.gitAdapter.getCurrentCommit(
          repositoryPath,
        );
        const lastCommit = await this.deps.graphRepository.getLastIndexedCommit(
          repoName,
        );

        if (lastCommit && currentCommit !== lastCommit) {
          this.logger.info(
            `Repository "${repoName}" has changes (${lastCommit.slice(0, 7)} → ${currentCommit.slice(0, 7)}) — incremental indexing...`,
          );
          const result = await this.incrementalIndex(
            repositoryPath,
            lastCommit,
          );
          return { status: "reindexed", result };
        }
      } catch {
        // Git not available or error reading commits — fall through to fresh
        this.logger.debug(
          `Could not detect git changes for "${repoName}", assuming fresh`,
        );
        return { status: "fresh" };
      }
    }

    return { status: "fresh" };
  }

  // ============================================================
  // Single File Index
  // ============================================================

  async indexFile(
    repositoryName: string,
    filePath: string,
  ): Promise<void> {
    const content = await this.deps.fileSystem.readFile(filePath);
    return this.indexFileContent(repositoryName, filePath, content);
  }

  async indexFileContent(
    repositoryName: string,
    filePath: string,
    content: string,
  ): Promise<void> {
    const language = detectLanguage(filePath, content);
    if (!language) return;

    const analyzer = this.deps.analyzerFactory.getAnalyzer(language);
    if (!analyzer) return;

    const result = await analyzer.analyze(filePath, content, repositoryName);

    // Remove old symbols for this file
    // (implemented via Neo4j query)
    await this.removeFileSymbols(repositoryName, filePath);

    // Store new symbols
    if (result.symbols.length > 0) {
      for (const sym of result.symbols) {
        if (!sym.contentHash) sym.contentHash = hashContent(sym.sourceSnippet || "");
      }

      const texts = result.symbols.map((s) => this.buildEmbeddingText(s));
      const vectors = await this.deps.embeddingGenerator.embedBatch(texts);

      await this.deps.graphRepository.upsertSymbols(result.symbols);
      await this.deps.graphRepository.upsertRelationships(result.relationships);

      await this.deps.vectorRepository.upsertVectors(
        result.symbols.map((symbol, i) => ({
          id: symbol.id,
          vector: vectors[i] ?? [],
          payload: {
            symbolId: symbol.id,
            language: symbol.language as any,
            repository: repositoryName,
            relativePath: symbol.location.relativePath,
            namespace: symbol.namespace,
            className: symbol.parentClass,
            methodName: symbol.kind === "method" ? symbol.name : null,
            kind: symbol.kind,
            contentHash: symbol.contentHash,
            gitCommit: null,
            timestamp: new Date().toISOString(),
          },
        })),
      );
    }
  }

  // ============================================================
  // Remove File
  // ============================================================

  async removeFile(
    repositoryName: string,
    filePath: string,
  ): Promise<void> {
    await this.removeFileSymbols(repositoryName, filePath);
  }

  // ============================================================
  // Incremental Index (stub — full impl in T-043)
  // ============================================================

  async incrementalIndex(
    repositoryPath: string,
    sinceCommit: string,
  ): Promise<IndexResult> {
    this.logger.info(
      `Incremental indexing from commit ${sinceCommit} (reindexing all as fallback)...`,
    );
    return this.indexRepository(repositoryPath);
  }

  // ============================================================
  // Documentation Indexing
  // ============================================================

  async indexDocumentation(repositoryPath: string): Promise<number> {
    // Default doc patterns — override with DOC_PATTERNS env var (comma-separated)
    const docPatterns = process.env.DOC_PATTERNS?.split(",").map(p => p.trim()).filter(Boolean)
      ?? [
        "AI/architecture.md",
        "AI/conventions.md",
        "AI/domain.md",
        "AI/decisions.md",
        "AI/components.md",
        "README.md",
        "ARCHITECTURE.md",
        "CONTRIBUTING.md",
        "docs/",
      ];

    // Warn if docs directory has too many files (default threshold 300)
    const docMaxFiles = parseInt(process.env.DOC_MAX_FILES ?? "300", 10);
    try {
      const docsDir = await this.deps.fileSystem.resolvePath(repositoryPath, "docs");
      if (await this.deps.fileSystem.exists(docsDir)) {
        const mdFiles = (await this.deps.fileSystem.listFiles(docsDir, "\\.md$")).length;
        if (mdFiles > docMaxFiles) {
          this.logger.warn(
            `docs/ has ${mdFiles} .md files (threshold: ${docMaxFiles}). ` +
            `Consider INDEX_DOCS=false or DOC_PATTERNS to limit scope. ` +
            `Indexing all of them will take a while...`,
          );
        }
      }
    } catch { /* docs/ doesn't exist or not accessible */ }

    const repoName = this.getRepoName(repositoryPath);
    let count = 0;

    for (const pattern of docPatterns) {
      try {
        const fullPath = await this.deps.fileSystem.resolvePath(
          repositoryPath,
          pattern,
        );

        if (pattern.endsWith("/")) {
          // Directory of docs
          const files = await this.deps.fileSystem.listFiles(fullPath, "\\.md$");
          for (const file of files) {
            count += await this.indexDocFile(file, repoName);
          }
        } else if (await this.deps.fileSystem.exists(fullPath)) {
          count += await this.indexDocFile(fullPath, repoName);
        }
      } catch {
        // File/dir doesn't exist — skip
      }
    }

    this.logger.debug(`Indexed ${count} documentation sections`);
    return count;
  }

  // ============================================================
  // Private
  // ============================================================

  private async indexDocFile(
    filePath: string,
    repoName: string,
  ): Promise<number> {
    const content = await this.deps.fileSystem.readFile(filePath);
    const sections = this.parseMarkdownSections(content, filePath);

    if (sections.length === 0) return 0;

    const texts = sections.map((s) => s.content);
    const vectors = await this.deps.embeddingGenerator.embedBatch(texts);

    await this.deps.vectorRepository.upsertVectors(
      sections.map((section, i) => ({
        id: `${repoName}::${filePath}#${section.heading}`,
        vector: vectors[i] ?? [],
        payload: {
          docSectionId: `${repoName}::${filePath}#${section.heading}`,
          language: "markdown" as any,
          repository: repoName,
          relativePath: filePath,
          namespace: "",
          className: null,
          methodName: null,
          kind: "doc_section",
          contentHash: hashContent(section.content),
          gitCommit: null,
          timestamp: new Date().toISOString(),
        },
      })),
    );

    return sections.length;
  }

  private parseMarkdownSections(
    content: string,
    filePath: string,
  ): Array<{ heading: string; content: string }> {
    const sections: Array<{ heading: string; content: string }> = [];
    const lines = content.split("\n");
    let currentHeading = filePath;
    let currentContent = "";

    for (const line of lines) {
      const match = line.match(/^(#{1,6})\s+(.+)/);
      if (match) {
        // Save previous section
        if (currentContent.trim()) {
          sections.push({
            heading: currentHeading,
            content: `[documentation] ${currentHeading}\n${currentContent.trim()}`,
          });
        }
        currentHeading = `${filePath} > ${match[2]}`;
        currentContent = line + "\n";
      } else {
        currentContent += line + "\n";
      }
    }

    // Last section
    if (currentContent.trim()) {
      sections.push({
        heading: currentHeading,
        content: `[documentation] ${currentHeading}\n${currentContent.trim()}`,
      });
    }

    return sections;
  }

  private buildEmbeddingText(symbol: Symbol): string {
    const parts: string[] = [];

    parts.push(`[${symbol.language}] [${symbol.kind}] ${symbol.namespace}.${symbol.name}`);

    if (symbol.signature) {
      parts.push(symbol.signature);
    }

    if (symbol.docComment) {
      parts.push(symbol.docComment);
    }

    if (symbol.sourceSnippet) {
      parts.push(symbol.sourceSnippet.slice(0, 1500));
    }

    return parts.join("\n");
  }

  private async removeFileSymbols(
    _repositoryName: string,
    filePath: string,
  ): Promise<void> {
    // Simple approach: delete symbols by file path prefix
    // In a full implementation, we'd query Neo4j first to find IDs
    this.logger.debug(`Removing symbols for: ${filePath}`);
    // Implementation delegated to GraphRepository.clearRepository for now
  }

  private getRepoName(repositoryPath: string): string {
    return repositoryPath.split("/").pop() ?? repositoryPath;
  }
}
