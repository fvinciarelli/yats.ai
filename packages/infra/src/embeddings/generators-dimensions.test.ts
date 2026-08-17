import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OpenAIEmbeddingGenerator } from "./openai-embedding-generator.js";
import { MistralEmbeddingGenerator } from "./mistral-embedding-generator.js";
import { VoyageEmbeddingGenerator } from "./voyage-embedding-generator.js";
import { OllamaEmbeddingGenerator } from "./ollama-embedding-generator.js";

describe("Embedding generator dimensions (model-aware)", () => {
  it("OpenAI derives dimensions from the selected model", () => {
    assert.equal(new OpenAIEmbeddingGenerator({ model: "text-embedding-3-small" }).dimensions, 1536);
    assert.equal(new OpenAIEmbeddingGenerator({ model: "text-embedding-3-large" }).dimensions, 3072);
    assert.equal(new OpenAIEmbeddingGenerator({ model: "text-embedding-ada-002" }).dimensions, 1536);
    assert.equal(new OpenAIEmbeddingGenerator({ model: "some-unknown-model" }).dimensions, 1536);
  });

  it("Mistral derives dimensions from the selected model", () => {
    assert.equal(new MistralEmbeddingGenerator({ model: "mistral-embed" }).dimensions, 1024);
    assert.equal(new MistralEmbeddingGenerator({ model: "unknown" }).dimensions, 1024);
  });

  it("Voyage derives dimensions from the selected model", () => {
    assert.equal(new VoyageEmbeddingGenerator({ model: "voyage-code-2" }).dimensions, 1536);
    assert.equal(new VoyageEmbeddingGenerator({ model: "voyage-3" }).dimensions, 1024);
    assert.equal(new VoyageEmbeddingGenerator({ model: "voyage-3-large" }).dimensions, 1024);
    assert.equal(new VoyageEmbeddingGenerator({ model: "voyage-3-lite" }).dimensions, 512);
    assert.equal(new VoyageEmbeddingGenerator({ model: "voyage-2" }).dimensions, 1024);
    assert.equal(new VoyageEmbeddingGenerator({ model: "unknown" }).dimensions, 1536);
  });

  it("Ollama derives dimensions from the selected model", () => {
    assert.equal(new OllamaEmbeddingGenerator({ model: "nomic-embed-text" }).dimensions, 768);
    assert.equal(new OllamaEmbeddingGenerator({ model: "mxbai-embed-large" }).dimensions, 1024);
    assert.equal(new OllamaEmbeddingGenerator({ model: "bge-m3" }).dimensions, 1024);
    assert.equal(new OllamaEmbeddingGenerator({ model: "snowflake-arctic-embed" }).dimensions, 1024);
    assert.equal(new OllamaEmbeddingGenerator({ model: "unknown" }).dimensions, 768);
  });
});
