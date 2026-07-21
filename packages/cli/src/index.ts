import "dotenv/config";
import "reflect-metadata";
import { Command } from "commander";
import { createLogger } from "@yats/shared";
import { container, initializeConnections, shutdownConnections, TOKENS } from "@yats/infra";
import type {
  GraphRepository,
  VectorRepository,
  EmbeddingGenerator,
  FileSystem,
} from "@yats/shared";
import { AnalyzerFactory } from "@yats/analyzer-interface";
import { TypeScriptAnalyzer } from "@yats/analyzer-typescript";
import { IndexerService } from "@yats/indexing";
import { RetrieverService } from "@yats/retrieval";
import { McpServer } from "@yats/mcp-server";

const logger = createLogger("cli");
const program = new Command();

program
  .name("yats")
  .description("AI Code Intelligence Platform — index, search, and understand codebases")
  .version("0.1.0");

// ============================================================
// Bootstrap
// ============================================================

async function bootstrap() {
  // Register analyzers
  const analyzerFactory = new AnalyzerFactory();
  analyzerFactory.register(new TypeScriptAnalyzer());
  // Future: register C#, PHP, Python analyzers

  // Initialize connections
  await initializeConnections();

  // Resolve dependencies
  const graphRepo = container.resolve(TOKENS.GRAPH_REPOSITORY) as GraphRepository;
  const vectorRepo = container.resolve(TOKENS.VECTOR_REPOSITORY) as VectorRepository;
  const embeddings = container.resolve(TOKENS.EMBEDDING_GENERATOR) as EmbeddingGenerator;
  const fileSystem = container.resolve(TOKENS.FILE_SYSTEM) as FileSystem;

  // Create services
  const indexer = new IndexerService({
    graphRepository: graphRepo,
    vectorRepository: vectorRepo,
    embeddingGenerator: embeddings,
    fileSystem,
    analyzerFactory,
  });

  const retriever = new RetrieverService(graphRepo, vectorRepo, embeddings);

  return { indexer, retriever, graphRepo, vectorRepo, embeddings, fileSystem };
}

// ============================================================
// Commands
// ============================================================

program
  .command("list")
  .description("List all indexed repositories")
  .action(async () => {
    try {
      const { graphRepo } = await bootstrap();
      const repos = await graphRepo.listRepositories();
      if (repos.length === 0) {
        console.log("No indexed repositories found.");
      } else {
        for (const r of repos) {
          console.log(`  ${r.name}  →  ${r.rootPath}`);
        }
      }
    } catch (err: any) {
      console.error(`❌ List failed: ${err.message}`);
    } finally {
      await shutdownConnections();
    }
  });

program
  .command("index <repository-path>")
  .description("Index a repository (full or incremental)")
  .option("--incremental", "Only index changed files")
  .option("--since <commit>", "Git commit to index from")
  .action(async (repoPath: string, options: { incremental?: boolean; since?: string }) => {
    try {
      const { indexer } = await bootstrap();
      logger.info(`Indexing: ${repoPath}`);

      const result = options.incremental && options.since
        ? await indexer.incrementalIndex(repoPath, options.since)
        : await indexer.indexRepository(repoPath);

      console.log(JSON.stringify(result, null, 2));
      console.log(`✅ Indexed ${result.symbolsFound} symbols, ${result.relationshipsFound} relationships in ${(result.duration / 1000).toFixed(1)}s`);
    } catch (err: any) {
      console.error(`❌ Index failed: ${err.message}`);
    } finally {
      await shutdownConnections();
    }
  });

program
  .command("search <query>")
  .description("Search for code symbols")
  .option("--repo <name>", "Repository name", "default")
  .option("--limit <n>", "Max results", "10")
  .action(async (query: string, options: { repo: string; limit: string }) => {
    try {
      const { retriever } = await bootstrap();
      logger.info(`Searching: "${query}"`);

      const result = await retriever.retrieve({
        query,
        repository: options.repo,
        options: {
          maxTotalResults: parseInt(options.limit, 10),
        },
      });

      console.log(`Found ${result.context.length} results (${result.tokenCount} tokens, ${result.durationMs}ms):\n`);

      for (const item of result.context) {
        console.log(`  ${item.symbol.kind.toUpperCase()} ${item.symbol.name}`);
        console.log(`    File: ${item.symbol.location.relativePath}:${item.symbol.location.startLine}`);
        console.log(`    Score: ${item.score.toFixed(2)} (${item.source})`);
        console.log("");
      }
    } catch (err: any) {
      console.error(`❌ Search failed: ${err.message}`);
    } finally {
      await shutdownConnections();
    }
  });

program
  .command("serve")
  .description("Start the MCP server (stdio transport)")
  .action(async () => {
    try {
      const { indexer, retriever, graphRepo, vectorRepo, embeddings, fileSystem } = await bootstrap();

      const mcpServer = new McpServer({
        retriever,
        graphRepository: graphRepo,
        vectorRepository: vectorRepo,
        embeddings,
        fileSystem,
        indexer,
        repositoriesRoot: process.env.REPOSITORIES_PATH ?? "/repositories",
      });

      await mcpServer.start();
    } catch (err: any) {
      console.error(`❌ MCP server failed: ${err.message}`);
    } finally {
      await shutdownConnections();
    }
  });

program
  .command("summary <repository>")
  .description("Show repository summary")
  .action(async (repo: string) => {
    try {
      const { graphRepo } = await bootstrap();
      const summary = await graphRepo.repositorySummary(repo);
      console.log(JSON.stringify(summary, null, 2));
    } catch (err: any) {
      console.error(`❌ Summary failed: ${err.message}`);
    } finally {
      await shutdownConnections();
    }
  });

program
  .command("clear <repository>")
  .description("Delete all indexed data for a repository (Neo4j + Qdrant)")
  .action(async (repo: string) => {
    try {
      const { graphRepo, vectorRepo } = await bootstrap();
      console.log(`Clearing "${repo}"...`);
      await graphRepo.clearRepository(repo);
      await vectorRepo.clearVectorsByRepository(repo);
      console.log(`✅ Repository "${repo}" cleared`);
    } catch (err: any) {
      console.error(`❌ Clear failed: ${err.message}`);
    } finally {
      await shutdownConnections();
    }
  });

// ============================================================
// Run
// ============================================================

program.parse(process.argv);
