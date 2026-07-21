import { createLogger, type Logger } from "@yats/shared";
import type { IndexResult, GitAdapter, FileSystem, LanguageAnalyzer, GraphRepository, VectorRepository, EmbeddingGenerator } from "@yats/shared";
import { AnalyzerFactory } from "@yats/analyzer-interface";
import { SymbolDiffer } from "./symbol-differ.service.js";
import { detectLanguage } from "../../infrastructure/language-detector.js";
import { hashContent } from "@yats/shared";
import type { Symbol, Relationship } from "@yats/shared";

// ============================================================
// Incremental Indexer — indexes only changed files
// ============================================================

export interface IncrementalIndexerDeps {
  graphRepository: GraphRepository;
  vectorRepository: VectorRepository;
  embeddingGenerator: EmbeddingGenerator;
  fileSystem: FileSystem;
  gitAdapter: GitAdapter;
  analyzerFactory: AnalyzerFactory;
}

export class IncrementalIndexerService {
  private readonly logger: Logger;
  private readonly differ: SymbolDiffer;

  constructor(private readonly deps: IncrementalIndexerDeps) {
    this.logger = createLogger("indexer:incremental");
    this.differ = new SymbolDiffer();
  }

  /**
   * Incrementally index a repository: only process files changed since the given commit.
   */
  async indexSince(
    repositoryPath: string,
    repoName: string,
    sinceCommit: string,
  ): Promise<IndexResult> {
    const startTime = Date.now();
    this.logger.info(`Incremental indexing ${repoName} since ${sinceCommit.slice(0, 8)}...`);

    // Get changed files from git
    const changedFiles = await this.deps.gitAdapter.getChangedFiles(
      repositoryPath,
      sinceCommit,
    );

    this.logger.info(
      `Changed files: ${changedFiles.length} (${changedFiles.filter(f => f.status === "added").length} added, ${changedFiles.filter(f => f.status === "modified").length} modified, ${changedFiles.filter(f => f.status === "deleted").length} deleted)`,
    );

    let totalSymbols = 0;
    let totalRels = 0;
    let totalErrors = 0;

    for (const change of changedFiles) {
      try {
        switch (change.status) {
          case "added":
          case "modified": {
            const result = await this.reindexFile(
              repositoryPath, repoName, change.path,
            );
            totalSymbols += result.symbols;
            totalRels += result.relationships;
            totalErrors += result.errors;
            break;
          }
          case "deleted": {
            await this.removeFileSymbols(repoName, change.path);
            break;
          }
          case "renamed": {
            // Remove old path, index new path
            if (change.previousPath) {
              await this.removeFileSymbols(repoName, change.previousPath);
            }
            const result = await this.reindexFile(
              repositoryPath, repoName, change.path,
            );
            totalSymbols += result.symbols;
            totalRels += result.relationships;
            totalErrors += result.errors;
            break;
          }
        }
      } catch (err: any) {
        totalErrors++;
        this.logger.error(`Error processing ${change.path}: ${err.message}`);
      }
    }

    const duration = Date.now() - startTime;
    this.logger.info(
      `Incremental index complete: ${totalSymbols} symbols, ${totalRels} rels, ${totalErrors} errors in ${duration}ms`,
    );

    return {
      repository: repoName,
      symbolsFound: totalSymbols,
      relationshipsFound: totalRels,
      vectorsCreated: totalSymbols,
      docsIndexed: 0,
      errors: totalErrors,
      duration,
    };
  }

  /**
   * Reindex a single file: detect language, analyze, store.
   */
  private async reindexFile(
    repoPath: string,
    repoName: string,
    filePath: string,
  ): Promise<{ symbols: number; relationships: number; errors: number }> {
    const fullPath = await this.deps.fileSystem.resolvePath(repoName, filePath);
    const exists = await this.deps.fileSystem.exists(fullPath);
    if (!exists) return { symbols: 0, relationships: 0, errors: 0 };

    const content = await this.deps.fileSystem.readFile(fullPath);
    const language = detectLanguage(filePath, content);
    if (!language) return { symbols: 0, relationships: 0, errors: 0 };

    const analyzer = this.deps.analyzerFactory.getAnalyzer(language);
    if (!analyzer) return { symbols: 0, relationships: 0, errors: 0 };

    // Remove old symbols for this file
    await this.removeFileSymbols(repoName, filePath);

    // Analyze
    const result = await analyzer.analyze(filePath, content, repoName);

    if (result.symbols.length === 0) {
      return { symbols: 0, relationships: 0, errors: result.errors.length };
    }

    // Compute content hashes
    for (const sym of result.symbols) {
      if (!sym.contentHash) {
        sym.contentHash = hashContent(sym.sourceSnippet || "");
      }
    }

    // Generate embeddings
    const texts = result.symbols.map((s) =>
      `[${s.language}] [${s.kind}] ${s.namespace}.${s.name}\n${s.signature ?? ""}\n${s.docComment ?? ""}\n${(s.sourceSnippet ?? "").slice(0, 1500)}`,
    );
    const vectors = await this.deps.embeddingGenerator.embedBatch(texts);

    // Store
    await this.deps.graphRepository.upsertSymbols(result.symbols);
    await this.deps.graphRepository.upsertRelationships(result.relationships);
    await this.deps.vectorRepository.upsertVectors(
      result.symbols.map((symbol, i) => ({
        id: symbol.id,
        vector: vectors[i] ?? [],
        payload: {
          symbolId: symbol.id,
          language: symbol.language as any,
          repository: repoName,
          relativePath: filePath,
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

    return {
      symbols: result.symbols.length,
      relationships: result.relationships.length,
      errors: result.errors.length,
    };
  }

  /**
   * Remove all symbols belonging to a file.
   */
  private async removeFileSymbols(
    repoName: string,
    filePath: string,
  ): Promise<void> {
    // Query Neo4j for symbols with this file path, then delete them
    const symbols = await this.deps.graphRepository.listSymbols(repoName, undefined, 1000, 0);
    const toDelete = symbols.filter(
      (s) => s.location.relativePath === filePath,
    );

    if (toDelete.length > 0) {
      const ids = toDelete.map((s) => s.id);
      await this.deps.graphRepository.deleteSymbols(ids);
      await this.deps.vectorRepository.deleteVectors(ids);
      this.logger.debug(`Removed ${ids.length} symbols for ${filePath}`);
    }
  }
}
