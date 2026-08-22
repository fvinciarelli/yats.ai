// Verificación del notice de indexación: consulta repository_summary + find_callers
// vía McpServer.handleRequest directo (sin protocolo HTTP/SSE).
import { container, initializeConnections, shutdownConnections, TOKENS } from "@yats/infra";
import { AnalyzerFactory } from "@yats/analyzer-interface";
import { TypeScriptAnalyzer } from "@yats/analyzer-typescript";
import { GoAnalyzer } from "@yats/analyzer-go";
import { CSharpAnalyzer } from "@yats/analyzer-csharp";
import { PythonAnalyzer } from "@yats/analyzer-python";
import { PhpAnalyzer } from "@yats/analyzer-php";
import { IndexerService } from "@yats/indexing";
import { RetrieverService } from "@yats/retrieval";
import { McpServer } from "@yats/mcp-server";

const REPO = "test_repo";

await initializeConnections();
const graphRepo = container.resolve(TOKENS.GRAPH_REPOSITORY) as any;
const vectorRepo = container.resolve(TOKENS.VECTOR_REPOSITORY) as any;
const fileSystem = container.resolve(TOKENS.FILE_SYSTEM) as any;
const embeddings = container.resolve(TOKENS.EMBEDDING_GENERATOR) as any;

const analyzerFactory = new AnalyzerFactory();
const tsAnalyzer = new TypeScriptAnalyzer();
analyzerFactory.register(tsAnalyzer);
analyzerFactory.register(tsAnalyzer, "javascript" as any);
analyzerFactory.register(new GoAnalyzer());
analyzerFactory.register(new CSharpAnalyzer());
analyzerFactory.register(new PythonAnalyzer());
analyzerFactory.register(new PhpAnalyzer());

const indexer = new IndexerService({
  graphRepository: graphRepo,
  vectorRepository: vectorRepo,
  embeddingGenerator: embeddings,
  fileSystem,
  analyzerFactory,
});
const retriever = new RetrieverService(graphRepo as any, vectorRepo as any, embeddings as any);
const mcp = new McpServer({
  retriever: retriever as any,
  graphRepository: graphRepo,
  vectorRepository: vectorRepo,
  embeddings,
  fileSystem,
  indexer,
  repositoriesRoot: "/repos",
});

async function call(name: string, args: any) {
  const res = await mcp.handleRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  return (res as any).result?.content?.[0]?.text ?? JSON.stringify(res);
}

console.log("=== repository_summary (durante el index) ===");
const summary = await call("repository_summary", { repository: REPO });
console.log(summary.slice(0, 500));
console.log("\n=== find_callers (durante el index) ===");
const callers = await call("find_callers", { symbolId: "test_repo::auth.py::auth.verify_token" });
console.log(callers.slice(0, 400));

await shutdownConnections();
