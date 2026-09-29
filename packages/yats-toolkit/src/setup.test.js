/**
 * Tests — setup wizard env persistence (applyEnvKeys).
 *
 * Covers the Azure OpenAI provider, custom endpoints for OpenAI-compatible
 * providers, and reconfiguration between providers.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyEnvKeys } from "./setup.js";

describe("applyEnvKeys", () => {
  it("persists Azure OpenAI endpoint, key, model, and api version", () => {
    const env = applyEnvKeys({}, {
      provider: "azure",
      apiKey: "az-key",
      model: "text-embedding-3-large",
      baseUrl: "https://my-resource.openai.azure.com",
    });

    assert.equal(env.EMBEDDING_PROVIDER, "azure");
    assert.equal(env.YATS_PROVIDER, "azure");
    assert.equal(env.EMBEDDING_AZURE_API_KEY, "az-key");
    assert.equal(env.EMBEDDING_AZURE_ENDPOINT, "https://my-resource.openai.azure.com");
    assert.equal(env.EMBEDDING_AZURE_MODEL, "text-embedding-3-large");
    assert.equal(env.EMBEDDING_AZURE_API_VERSION, "2024-02-01");
  });

  it("persists a custom endpoint for OpenAI-compatible providers", () => {
    const env = applyEnvKeys({}, {
      provider: "openai",
      apiKey: "oai-key",
      model: "text-embedding-3-small",
      baseUrl: "https://proxy.corp.local/v1",
    });

    assert.equal(env.EMBEDDING_OPENAI_BASE_URL, "https://proxy.corp.local/v1");
    assert.equal(env.EMBEDDING_OPENAI_API_KEY, "oai-key");
    assert.equal(env.EMBEDDING_OPENAI_MODEL, "text-embedding-3-small");
    // No Azure keys are written for non-Azure providers.
    assert.ok(!("EMBEDDING_AZURE_API_KEY" in env));
    assert.ok(!("EMBEDDING_AZURE_ENDPOINT" in env));
  });

  it("does not write a base URL when none is given", () => {
    const env = applyEnvKeys({}, {
      provider: "mistral",
      apiKey: "m-key",
      model: "mistral-embed",
    });

    assert.ok(!("EMBEDDING_MISTRAL_BASE_URL" in env));
    assert.equal(env.EMBEDDING_MISTRAL_API_KEY, "m-key");
  });

  it("switches providers without losing unrelated keys", () => {
    const before = applyEnvKeys({}, {
      provider: "openai",
      apiKey: "oai-key",
      model: "text-embedding-3-small",
      baseUrl: "https://old-proxy/v1",
    });
    const env = applyEnvKeys(before, {
      provider: "azure",
      apiKey: "az-key",
      model: "text-embedding-3-small",
      baseUrl: "https://my-resource.openai.azure.com",
    });

    assert.equal(env.EMBEDDING_PROVIDER, "azure");
    assert.equal(env.EMBEDDING_AZURE_API_KEY, "az-key");
    // The old OpenAI key/baseUrl remain but are inert (provider is azure).
    assert.equal(env.EMBEDDING_OPENAI_API_KEY, "oai-key");
    assert.equal(env.EMBEDDING_OPENAI_BASE_URL, "https://old-proxy/v1");
  });

  it("preserves existing benchmark keys and adds missing empty ones", () => {
    const env = applyEnvKeys({ ANTHROPIC_API_KEY: "ant-key" }, {
      provider: "ollama",
      model: "nomic-embed-text",
    });

    assert.equal(env.ANTHROPIC_API_KEY, "ant-key");
    assert.equal(env.OPENAI_API_KEY, "");
    assert.equal(env.GEMINI_API_KEY, "");
    assert.equal(env.DEEPSEEK_API_KEY, "");
  });
});
