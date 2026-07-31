import { container, initializeConnections, TOKENS } from "@yats/infra";
import { RetrieverService } from "@yats/retrieval";
import "dotenv/config";
import "reflect-metadata";

async function main() {
  await initializeConnections();
  const graphRepo = container.resolve(TOKENS.GRAPH_REPOSITORY);
  const vectorRepo = container.resolve(TOKENS.VECTOR_REPOSITORY);
  const embeddings = container.resolve(TOKENS.EMBEDDING_GENERATOR);
  const retriever = new RetrieverService(graphRepo, vectorRepo, embeddings);

  console.log("=== search_code 'Basket' repo=eShopOnWeb ===");
  const r1 = await retriever.retrieve({ query: "Basket", repository: "eShopOnWeb", maxResults: 5 });
  for (const i of r1.items) {
    console.log(" ", i.symbol.kind, i.symbol.name, "repo=" + i.symbol.location.repository);
  }

  console.log("");
  console.log("=== search_code 'Basket' repo=Slim ===");
  const r2 = await retriever.retrieve({ query: "Basket", repository: "Slim", maxResults: 5 });
  for (const i of r2.items) {
    console.log(" ", i.symbol.kind, i.symbol.name, "repo=" + i.symbol.location.repository);
  }
  if (r2.items.length === 0) console.log("  (no results — correct, Slim has no Basket)");

  process.exit(0);
}
main();
