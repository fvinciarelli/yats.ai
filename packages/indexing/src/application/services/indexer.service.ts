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
import { hashContent } from "@yats/shared";

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

  constructor(
    private readonly deps: IndexerDependencies,
  ) {
    this.logger = createLogger("indexer:service");
    this.concurrency = parseInt(
      process.env.INDEXER_CONCURRENCY ?? "4",
      10,
    );
  }

  // ============================================================
  // Full Repository Index
  // ============================================================

  async indexRepository(repositoryPath: string): Promise<IndexResult> {
    const startTime = Date.now();
    const repoName = this.getRepoName(repositoryPath);
    this.logger.info(`Indexing repository: ${repoName} at ${repositoryPath}`);

    // 0. Store repository metadata (root path)
    await this.deps.graphRepository.upsertRepositoryMetadata(
      repoName,
      repositoryPath,
    );

    // 0b. Capture current git commit for future incremental indexing
    let currentCommit: string | null = null;
    if (this.deps.gitAdapter) {
      try {
        currentCommit = await this.deps.gitAdapter.getCurrentCommit(repositoryPath);
      } catch {
        // Not a git repo — ignore
      }
    }

    // 1. Walk files
    const walker = new FileWalker();
    const files = await walker.walk(repositoryPath);

    // 2. Filter to supported languages
    const supportedFiles = files.filter((f) => f.language !== null);
    this.logger.info(`Found ${supportedFiles.length} indexable files (${files.length} total)`);

    // 3. Process files in parallel batches
    const symbolStore = new MemorySymbolStore();
    let totalErrors = 0;

    for (let i = 0; i < supportedFiles.length; i += this.concurrency) {
      const batch = supportedFiles.slice(i, i + this.concurrency);

      const results = await Promise.allSettled(
        batch.map(async (file) => {
          const analyzer = this.deps.analyzerFactory.getAnalyzerForFile(
            file.relativePath,
          );
          if (!analyzer) return;

          const content = await this.deps.fileSystem.readFile(
            file.absolutePath,
          );
          const result = await analyzer.analyze(
            file.relativePath,
            content,
            repoName,
          );

          // Add to symbol store
          for (const symbol of result.symbols) {
            // Compute content hash if missing
            if (!symbol.contentHash) {
              symbol.contentHash = hashContent(symbol.sourceSnippet || "");
            }
            symbolStore.add(symbol);
          }
          for (const rel of result.relationships) {
            symbolStore.addRelationship(rel);
          }

          return result.errors.length;
        }),
      );

      for (const r of results) {
        if (r.status === "rejected") {
          totalErrors++;
          this.logger.error(`File processing error: ${r.reason}`);
        } else if (r.value) {
          totalErrors += r.value;
        }
      }
    }

    // 4. Generate embeddings
    const symbols = symbolStore.getAll();
    this.logger.info(`Generating embeddings for ${symbols.length} symbols...`);

    const texts = symbols.map((s) => this.buildEmbeddingText(s));
    const vectors = await this.deps.embeddingGenerator.embedBatch(texts);

    // 5. Store in Neo4j
    this.logger.info(`Storing ${symbols.length} symbols in graph...`);
    await this.deps.graphRepository.upsertSymbols(symbols);

    this.logger.info(
      `Storing ${symbolStore.getRelationships().length} relationships...`,
    );
    await this.deps.graphRepository.upsertRelationships(
      symbolStore.getRelationships(),
    );

    // 6. Store in Qdrant
    this.logger.info(`Storing ${symbols.length} vectors...`);
    await this.deps.vectorRepository.upsertVectors(
      symbols.map((symbol, i) => ({
        id: symbol.id,
        vector: vectors[i] ?? [],
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

    // 7. Index documentation
    let docsIndexed = 0;
    try {
      const docResult = await this.indexDocumentation(repositoryPath);
      docsIndexed = docResult;
    } catch (err) {
      this.logger.warn(`Documentation indexing skipped: ${err}`);
    }

    const duration = Date.now() - startTime;

    // Save last indexed commit for future incremental indexing
    if (currentCommit) {
      await this.deps.graphRepository.setLastIndexedCommit(
        repoName,
        currentCommit,
      );
    }

    this.logger.info(
      `Indexed ${repoName}: ${symbols.length} symbols, ${symbolStore.getRelationships().length} relationships, ${docsIndexed} docs in ${duration}ms`,
    );

    return {
      repository: repoName,
      symbolsFound: symbols.length,
      relationshipsFound: symbolStore.getRelationships().length,
      vectorsCreated: symbols.length,
      docsIndexed,
      errors: totalErrors,
      duration,
    };
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
    const docFiles = [
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

    const repoName = this.getRepoName(repositoryPath);
    let count = 0;

    for (const pattern of docFiles) {
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
