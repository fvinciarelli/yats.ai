/**
 * Tests — setup wizard env persistence (applyEnvKeys), generated docker-compose
 * (generateCompose), and the Windows PATH helper (windowsPathPowerShell).
 *
 * The compose tests parse the generated YAML so any indentation regression in
 * the embedded template (e.g. the ollama service leaking into another service
 * or a volume becoming a service) fails here instead of on a user's machine.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import YAML from "yaml";

import { applyEnvKeys, generateCompose, windowsPathPowerShell } from "./setup.js";

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

  it("persists an external Ollama URL and clears it for container mode", () => {
    const env = applyEnvKeys({}, {
      provider: "ollama",
      model: "nomic-embed-text",
      ollamaUrl: "http://host.docker.internal:11434",
    });
    assert.equal(env.OLLAMA_URL, "http://host.docker.internal:11434");

    // Choosing the bundled container clears any external URL so the compose
    // falls back to its default (http://ollama:11434).
    const containerMode = applyEnvKeys(env, {
      provider: "ollama",
      model: "nomic-embed-text",
      ollamaUrl: "http://ollama:11434",
    });
    assert.ok(!("OLLAMA_URL" in containerMode));

    const noUrl = applyEnvKeys(containerMode, {
      provider: "ollama",
      model: "mxbai-embed-large",
    });
    assert.ok(!("OLLAMA_URL" in noUrl));
  });
});

describe("generateCompose", () => {
  function parseCompose(provider, ollamaUrl = "") {
    const compose = generateCompose(provider, 5555, 4, true, 300, ollamaUrl);
    const doc = YAML.parse(compose);
    assert.ok(doc.services, "services section missing");
    return doc;
  }

  it("generates valid YAML with the core services for every provider", () => {
    for (const provider of ["ollama", "openai", "azure", "mistral", "voyage"]) {
      const doc = parseCompose(provider);
      assert.ok(doc.services.neo4j, `neo4j missing (${provider})`);
      assert.ok(doc.services.qdrant, `qdrant missing (${provider})`);
      assert.ok(doc.services.yats, `yats missing (${provider})`);
      assert.ok("neo4j-data" in doc.volumes, `neo4j-data volume missing (${provider})`);
    }
  });

  it("bundles a top-level Ollama service and its volume (container mode)", () => {
    const doc = parseCompose("ollama");

    // Regression guard: the ollama service used to be emitted misindented
    // (nested under qdrant) and its volume ended up parsed as a service.
    assert.ok(doc.services.ollama, "ollama service missing");
    assert.equal(doc.services.ollama.image, "ollama/ollama:latest");
    assert.ok(doc.services.qdrant.ollama === undefined, "ollama leaked into qdrant");
    assert.ok(!doc.services["ollama-models"], "volume became a service");
    assert.ok("ollama-models" in doc.volumes, "ollama-models volume missing");

    // The yats container must reach a host-installed Ollama on any platform.
    assert.deepEqual(
      doc.services.yats.extra_hosts,
      ["host.docker.internal:host-gateway"],
    );
    // The URL comes from .env at compose time with a sane default.
    assert.ok(
      doc.services.yats.environment.includes("OLLAMA_URL=${OLLAMA_URL:-http://ollama:11434}"),
    );
  });

  it("omits the Ollama service when an external Ollama is used", () => {
    const doc = parseCompose("ollama", "http://host.docker.internal:11434");
    assert.ok(!doc.services.ollama, "ollama service should be omitted");
    assert.ok(!("ollama-models" in doc.volumes), "ollama volume should be omitted");
    assert.deepEqual(
      doc.services.yats.extra_hosts,
      ["host.docker.internal:host-gateway"],
    );
  });

  it("omits Ollama for non-ollama providers", () => {
    const doc = parseCompose("openai");
    assert.ok(!doc.services.ollama, "ollama service should be omitted");
    assert.ok(!("ollama-models" in doc.volumes), "ollama volume should be omitted");
  });
});

describe("windowsPathPowerShell", () => {
  it("builds an idempotent, non-truncating, REG_EXPAND_SZ PATH update", () => {
    const cmd = windowsPathPowerShell("C:\\Users\\franco\\.yats\\bin");
    assert.match(cmd, /GetEnvironmentVariable\('Path','User'\)/);
    assert.match(cmd, /SetValue\('HKEY_CURRENT_USER\\Environment','Path'/);
    assert.match(cmd, /'ExpandString'/);
    assert.ok(!cmd.includes("%PATH%"), "must not write a literal %PATH%");
    assert.ok(!cmd.includes("setx"), "must not use setx");
  });

  it("escapes single quotes in the bin directory", () => {
    const cmd = windowsPathPowerShell("C:\\Users\\o'reilly\\.yats\\bin");
    assert.match(cmd, /o''reilly/);
  });
});
