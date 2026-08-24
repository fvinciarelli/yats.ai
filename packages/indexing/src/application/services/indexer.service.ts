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
import { IncrementalIndexerService } from "./incremental-indexer.service.js";
import { PendingRelationshipStore } from "./pending-relationships.js";

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
  private readonly pendingRelationships: PendingRelationshipStore;

  constructor(
    private readonly deps: IndexerDependencies,
  ) {
    this.logger = createLogger("indexer:service");
    this.pendingRelationships = new PendingRelationshipStore(
      deps.graphRepository,
      deps.embeddingGenerator,
      deps.vectorRepository,
    );

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

  /**
   * Register repository metadata without walking the filesystem.
   * Used by the host CLI (`yats index`) which streams files via /index/file.
   */
  async registerRepository(repositoryName: string, rootPath: string): Promise<void> {
    await this.deps.graphRepository.upsertRepositoryMetadata(repositoryName, rootPath);
    this.pendingRelationships.touch(repositoryName);
    this.logger.info(`Registered repository "${repositoryName}" at ${rootPath} (files arrive via CLI)`);
  }

  /**
   * Whether a repository is currently mid-indexing (relationships incomplete).
   * Graph tools use this to tell agents to wait instead of showing partial data.
   */
  async getIndexingStatus(repositoryName: string): Promise<{ indexing: boolean; pendingRelationships: number }> {
    return this.pendingRelationships.status(repositoryName);
  }

  /**
   * Flush pending per-file relationships: resolve cross-file references
   * against the full symbol table and store them. Called by the debounce
   * timer after indexing quiets down, or explicitly via POST /index/complete.
   */
  async finalizeRepository(repositoryName: string): Promise<{ stored: number; filtered: number; rewritten: number }> {
    // Final flush: the symbol table is complete by now — resolve everything
    // held back and drop whatever is still unresolvable (imports, builtins).
    return this.pendingRelationships.flush(repositoryName, { final: true });
  }

  // ============================================================
  // Full Repository Index (Pipeline Architecture)
  //
  // Instead of sequential phases (analyze-all → embed-all → store-all),
  // we pipeline: analyze → accumulate → flush when chunk is full.
  // This means embedding and DB writes start while analysis is still
  // running, reducing total wall-clock time significantly.
  // ============================================================

  async indexRepository(repositoryPath: string, options?: { skipDocs?: boolean }): Promise<IndexResult> {
    const totalStart = Date.now();
    const repoName = this.getRepoName(repositoryPath);
    this.logger.info(`Indexing repository: ${repoName} at ${repositoryPath}`);

    // Fail loudly instead of reporting a successful 0-symbol index. The server
    // may run in a container without access to host paths — indexing must go
    // through the host CLI (`yats index`), which streams files over HTTP.
    let pathExists = false;
    try {
      pathExists = await this.deps.fileSystem.exists(repositoryPath);
    } catch { /* stat failed — treat as inaccessible */ }
    if (!pathExists) {
      throw new Error(
        `Repository path not accessible from the YATS server: "${repositoryPath}". ` +
        `The server cannot walk host files. Index from the host machine instead:\n\n` +
        `  yats index ${repositoryPath}\n\n` +
        `Then poll with repository_summary(path: "${repositoryPath}").`,
      );
    }

    // Track cumulative metrics
    let totalRelationships = 0;
    let walkMs = 0;
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
    const skipDocs = options?.skipDocs === true;
    const indexDocs = !skipDocs && process.env.INDEX_DOCS !== "false";
    let docsPromise: Promise<number> | null = null;

    if (indexDocs) {
      docsPromise = this.indexDocumentation(repositoryPath).catch((err) => {
        this.logger.warn(`Documentation indexing skipped: ${err}`);
        return 0;
      });
    }

    // 3. PRODUCER/CONSUMER PIPELINE
    //    Analyzer (producer) pushes results to a queue.
    //    Flusher (consumer) drains the queue and stores to DB.
    //    Both run concurrently — flush doesn't block analysis.
    const analyzeStart = Date.now();
    let allRelationships: Relationship[] = [];
    const symbolTableEntries: SymbolTableEntry[] = [];

    // Shared queue between producer and consumer
    type AnalysisBatch = { symbols: Symbol[]; relationships: Relationship[]; errors: number };
    const resultQueue: AnalysisBatch[] = [];
    let producerDone = false;
    let consumerTotalSymbols = 0;
    let consumerTotalErrors = 0;
    let consumerEmbedMs = 0;
    let consumerStoreMs = 0;
    let lastFlushPct = 0;

    // Consumer: drains the queue and flushes in chunks
    const consumerPromise = (async () => {
      const store = new MemorySymbolStore();

      while (true) {
        // Drain available results from the queue
        while (resultQueue.length > 0) {
          const batch = resultQueue.shift()!;
          consumerTotalErrors += batch.errors;

          for (const symbol of batch.symbols) {
            if (!symbol.contentHash) {
              symbol.contentHash = hashContent(symbol.sourceSnippet || "");
            }
            store.add(symbol);
            symbolTableEntries.push({
              id: symbol.id,
              name: symbol.name,
              namespace: symbol.namespace,
              relativePath: symbol.location.relativePath,
            });
          }
          for (const rel of batch.relationships) {
            allRelationships.push(rel);
          }
        }

        // Flush if enough symbols accumulated
        const accumulated = store.getAll();
        if (accumulated.length >= this.pipelineChunkSize) {
          const flushResult = await this.flushSymbols(store, repoName);
          consumerTotalSymbols += flushResult.symbols;
          consumerEmbedMs += flushResult.embedMs;
          consumerStoreMs += flushResult.storeMs;
        }

        // If producer is done and queue is empty, flush remaining and exit
        if (producerDone && resultQueue.length === 0) {
          const remaining = store.getAll();
          if (remaining.length > 0) {
            const flushResult = await this.flushSymbols(store, repoName);
            consumerTotalSymbols += flushResult.symbols;
            consumerEmbedMs += flushResult.embedMs;
            consumerStoreMs += flushResult.storeMs;
          }
          return;
        }

        // Small delay to avoid busy-waiting when queue is empty
        if (resultQueue.length === 0 && !producerDone) {
          await new Promise((r) => setTimeout(r, 50));
        }
      }
    })();

    // Producer: process batches concurrently (limited by concurrency)
    // Each batch pushes results to the shared queue when done.
    // The consumer drains the queue independently in the background.
    let batchesDispatched = 0;
    const totalBatches = Math.ceil(supportedFiles.length / this.concurrency);

    const processBatch = async (batchFiles: typeof supportedFiles) => {
      // Group files by analyzer for potential batch processing
      const byAnalyzer = new Map<LanguageAnalyzer, Array<{ file: typeof batchFiles[0]; content: string }>>();

      const reads = await Promise.allSettled(
        batchFiles.map(async (file) => {
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

      const results: Array<{
        status: "fulfilled" | "rejected";
        value?: { errors: number; symbols: Symbol[]; relationships: Relationship[] };
        reason?: any;
      }> = [];

      for (const [analyzer, group] of byAnalyzer) {
        if (analyzer.analyzeBatch) {
          const BATCH_CHUNK = this.batchAnalyzerSize;
          for (let bi = 0; bi < group.length; bi += BATCH_CHUNK) {
            const subGroup = group.slice(bi, bi + BATCH_CHUNK);
            try {
              const batchResults = await analyzer.analyzeBatch(
                subGroup.map((g) => ({ filePath: g.file.relativePath, content: g.content })),
                repositoryPath,
              );
              for (const result of batchResults) {
                results.push({
                  status: "fulfilled",
                  value: {
                    errors: result.errors.length,
                    symbols: result.symbols,
                    relationships: result.relationships,
                  },
                });
              }
            } catch (err: any) {
              this.logger.warn(`Batch analysis failed for ${analyzer.language}: ${err.message}, falling back to per-file`);
              for (const g of subGroup) {
                try {
                  const result = await analyzer.analyze(g.file.relativePath, g.content, repositoryPath);
                  results.push({
                    status: "fulfilled",
                    value: {
                      errors: result.errors.length,
                      symbols: result.symbols,
                      relationships: result.relationships,
                    },
                  });
                } catch (err2: any) {
                  results.push({ status: "rejected", reason: err2 });
                }
              }
            }
          }
        } else {
          const perFileResults = await Promise.allSettled(
            group.map(async (g) => {
              const result = await analyzer.analyze(g.file.relativePath, g.content, repositoryPath);
              return {
                errors: result.errors.length,
                symbols: result.symbols,
                relationships: result.relationships,
              };
            }),
          );
          results.push(...perFileResults);
        }
      }

      // Push results to queue for consumer (consumer is running in background)
      let batchErrors = 0;
      const batchSymbols: Symbol[] = [];
      const batchRels: Relationship[] = [];

      for (const r of results) {
        if (r.status === "rejected") {
          batchErrors++;
          this.logger.error(`File processing error: ${r.reason}`);
        } else if (r.value) {
          batchErrors += r.value.errors;
          batchSymbols.push(...r.value.symbols);
          batchRels.push(...r.value.relationships);
        }
      }

      resultQueue.push({ symbols: batchSymbols, relationships: batchRels, errors: batchErrors });
      batchesDispatched++;

      const pct = Math.round(batchesDispatched / totalBatches * 100);
      if (pct >= lastFlushPct + 10) {
        lastFlushPct = pct;
        this.logger.info(
          `Analysis ${pct}% — ${consumerTotalSymbols} symbols flushed so far`,
        );
      }
    };

    // Dispatch batches with concurrency limit.
    // Allow 2x concurrency so analysis overlaps with consumer flushing.
    const maxConcurrent = this.concurrency * 2;
    const inFlight: Promise<void>[] = [];

    for (let i = 0; i < supportedFiles.length; i += this.concurrency) {
      const batch = supportedFiles.slice(i, i + this.concurrency);

      const task = processBatch(batch).then(() => {
        // Remove self from inFlight when done
        const idx = inFlight.indexOf(task);
        if (idx >= 0) inFlight.splice(idx, 1);
      });
      inFlight.push(task);

      // If at capacity, wait for any one to finish before dispatching more
      if (inFlight.length >= maxConcurrent) {
        await Promise.race(inFlight);
      }
    }

    // Wait for all in-flight batches to complete
    await Promise.all(inFlight);
    producerDone = true;
    const analyzeEnd = Date.now();

    // Wait for consumer to finish processing remaining items
    await consumerPromise;

    const totalSymbols = consumerTotalSymbols;
    const totalErrors = consumerTotalErrors;
    const embedMs = consumerEmbedMs;
    const storeMs = consumerStoreMs;
    const analyzeMs = analyzeEnd - analyzeStart;

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

    // 4. Await docs (running in parallel since step 2, or skipped if INDEX_DOCS=false)
    const docsStart = Date.now();
    const docsIndexed = docsPromise ? await docsPromise : 0;
    docsMs = Date.now() - docsStart;
    if (docsMs < analyzeMs) docsMs = 0; // overlapped completely → zero added time

    // Save last indexed commit
    if (currentCommit) {
      await this.deps.graphRepository.setLastIndexedCommit(repositoryPath, currentCommit);
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
  async ensureIndexed(repositoryPath: string, options?: { skipDocs?: boolean }): Promise<{
    status: "indexed" | "reindexed" | "fresh";
    result?: IndexResult;
  }> {
    const repoName = this.getRepoName(repositoryPath);

    // Check if repository exists in the graph. YATS identifies repos by rootPath
    // (findRepositoryByPath + the bridge injects the full path), so a same-named
    // repo at a different path is effectively a different repo. Reindex fully so
    // the stored rootPath gets corrected instead of staying stale forever.
    const repos = await this.deps.graphRepository.listRepositories();
    const existing = repos.find((r) => r.name === repoName);
    const pathChanged = existing ? existing.rootPath !== repositoryPath : false;

    if (!existing || pathChanged) {
      this.logger.info(
        `Repository "${repoName}" ${pathChanged ? "moved to a new path" : "not indexed yet"} — full indexing...`,
      );
      const result = await this.indexRepository(repositoryPath, options);
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

  /**
   * Rebuild the entire vector index with the current embedding model.
   * Recreates the Qdrant collections at the model's dimension, then re-embeds
   * every symbol already stored in Neo4j (no re-analysis of source code).
   * May incur API embedding costs.
   */
  async rebuildVectors(): Promise<{ repositories: number; symbols: number; errors: number }> {
    this.logger.info("Rebuilding vector index (re-embedding all symbols)...");

    await this.deps.vectorRepository.recreateCollections(this.deps.embeddingGenerator.dimensions);

    const repos = await this.deps.graphRepository.listRepositories();
    let totalSymbols = 0;
    let errors = 0;
    const PAGE = 500;

    for (const repo of repos) {
      let offset = 0;
      while (true) {
        const symbols = await this.deps.graphRepository.listSymbols(repo.name, undefined, PAGE, offset);
        if (symbols.length === 0) break;
        offset += symbols.length;

        for (let i = 0; i < symbols.length; i += this.embedBatchSize) {
          const chunk = symbols.slice(i, i + this.embedBatchSize);
          const texts = chunk.map((s) => this.buildEmbeddingText(s));
          try {
            const vectors = await this.deps.embeddingGenerator.embedBatch(texts);
            await this.deps.vectorRepository.upsertVectors(
              chunk.map((symbol, j) => ({
                id: symbol.id,
                vector: vectors[j] ?? [],
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
            totalSymbols += chunk.length;
          } catch (e) {
            errors += chunk.length;
            this.logger.error(`Rebuild vectors failed for "${repo.name}": ${(e as Error).message}`);
          }
        }

        if (symbols.length < PAGE) break;
      }
    }

    this.logger.info(`Vector rebuild done — ${totalSymbols} symbols re-embedded across ${repos.length} repositories (${errors} errors)`);
    return { repositories: repos.length, symbols: totalSymbols, errors };
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
    // Route documentation files to the doc pipeline — indexed from the content
    // received over the network (not from the server filesystem).
    if (this.isDocumentationFile(filePath)) {
      await this.indexDocFileContent(filePath, repositoryName, content);
      return;
    }

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
      // Relationships are buffered and flushed once the indexing session goes
      // quiet (or on /index/complete), so cross-file targets can be resolved
      // against the complete symbol table instead of being silently dropped.
      this.pendingRelationships.touch(repositoryName);
      this.pendingRelationships.add(repositoryName, result.relationships);

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
  ): Promise<{ removed: number }> {
    const count = await this.removeFileSymbols(repositoryName, filePath);
    return { removed: count };
  }

  private async removeFileSymbols(
    repositoryName: string,
    filePath: string,
  ): Promise<number> {
    const symbols = await this.deps.graphRepository.listAllSymbols(repositoryName);
    const toDelete = symbols.filter(
      (s) => s.relativePath === filePath || s.id.includes(filePath),
    );

    if (toDelete.length > 0) {
      const ids = toDelete.map((s) => s.id);
      await this.deps.graphRepository.deleteSymbols(ids);
      await this.deps.vectorRepository.deleteVectors(ids);
      this.logger.info(`Removed ${ids.length} symbols for file: ${filePath}`);
    }

    return toDelete.length;
  }

  // ============================================================
  // Incremental Index — delegates to IncrementalIndexerService
  // ============================================================

  async incrementalIndex(
    repositoryPath: string,
    sinceCommit: string,
  ): Promise<IndexResult> {
    if (!this.deps.gitAdapter) {
      this.logger.info(`No git adapter available, falling back to full reindex for "${repositoryPath}"`);
      return this.indexRepository(repositoryPath);
    }

    this.logger.info(`Incremental indexing from commit ${sinceCommit.slice(0, 8)}...`);

    const incrementalIndexer = new IncrementalIndexerService({
      graphRepository: this.deps.graphRepository,
      vectorRepository: this.deps.vectorRepository,
      embeddingGenerator: this.deps.embeddingGenerator,
      fileSystem: this.deps.fileSystem,
      gitAdapter: this.deps.gitAdapter,
      analyzerFactory: this.deps.analyzerFactory,
      pendingRelationships: this.pendingRelationships,
    });

    const repoName = this.getRepoName(repositoryPath);
    return incrementalIndexer.indexSince(repositoryPath, repositoryPath, sinceCommit);
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

    const repoName = repositoryPath; // identity is the full path
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
    repositoryPath: string,
  ): Promise<number> {
    const content = await this.deps.fileSystem.readFile(filePath);
    return this.indexDocFileContent(filePath, repositoryPath, content);
  }

  /**
   * Index a documentation file from in-memory content (per-file indexing path —
   * the CLI sends file content over the network; no filesystem access here).
   */
  private async indexDocFileContent(
    filePath: string,
    repositoryPath: string,
    content: string,
  ): Promise<number> {
    const sections = this.parseMarkdownSections(content, filePath);

    if (sections.length === 0) return 0;

    const texts = sections.map((s) => s.content);
    const vectors = await this.deps.embeddingGenerator.embedBatch(texts);

    await this.deps.vectorRepository.upsertVectors(
      sections.map((section, i) => ({
        id: `${repositoryPath}::${filePath}#${section.heading}`,
        vector: vectors[i] ?? [],
        payload: {
          docSectionId: `${repositoryPath}::${filePath}#${section.heading}`,
          language: "markdown" as any,
          repository: repositoryPath,
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

  /**
   * Check if a file is a documentation file based on DOC_EXTENSIONS env var.
   */
  private isDocumentationFile(filePath: string): boolean {
    const docExtensions = (process.env.DOC_EXTENSIONS || ".md,.mdx,.rst,.txt,.adoc,.org,.wiki,.readme")
      .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    const lower = filePath.toLowerCase();
    return docExtensions.some((ext) => lower.endsWith(ext));
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

  private getRepoName(repositoryPath: string): string {
    return repositoryPath.split("/").pop() ?? repositoryPath;
  }
}
