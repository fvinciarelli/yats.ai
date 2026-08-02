import { createLogger, type Logger } from "@yats/shared";
import type { EmbeddingGenerator } from "@yats/shared";
import { Language } from "@yats/shared";

// ============================================================
// Ollama Embedding Generator
// Uses nomic-embed-text by default (768 dimensions)
// ============================================================

export interface OllamaConfig {
  url: string;
  model: string;
}

function loadOllamaConfig(): OllamaConfig {
  return {
    url: process.env.OLLAMA_URL ?? "http://localhost:11434",
    model: process.env.OLLAMA_MODEL ?? "nomic-embed-text",
  };
}

export class OllamaEmbeddingGenerator implements EmbeddingGenerator {
  readonly dimensions = 768; // nomic-embed-text
  private readonly config: OllamaConfig;
  private readonly logger: Logger;

  constructor(config?: Partial<OllamaConfig>) {
    this.config = { ...loadOllamaConfig(), ...config };
    this.logger = createLogger("embeddings:ollama");
  }

  async embed(text: string): Promise<number[]> {
    const embeddings = await this.callOllama([text]);
    return embeddings[0]!;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Ollama doesn't have native batching — process sequentially with concurrency
    const results: number[][] = [];
    const CONCURRENCY = 4;

    for (let i = 0; i < texts.length; i += CONCURRENCY) {
      const batch = texts.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map((t) => this.callOllama([t]).then((e) => e[0]!)),
      );
      results.push(...batchResults);
    }

    return results;
  }

  async embedCode(code: string, language: Language): Promise<number[]> {
    const text = this.prepareCodeText(code, language);
    return this.embed(text);
  }

  async embedDocumentation(text: string): Promise<number[]> {
    const prepared = `[documentation] ${text}`;
    return this.embed(prepared);
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.url}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // ============================================================
  // Private
  // ============================================================

  private async callOllama(inputs: string[]): Promise<number[][]> {
    const response = await fetch(`${this.config.url}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.config.model,
        input: inputs,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Ollama embed API error (${response.status}): ${text}`,
      );
    }

    const data = (await response.json()) as { embeddings: number[][] };
    return data.embeddings;
  }

  private prepareCodeText(code: string, language: Language): string {
    return `[${language}] ${code}`;
  }
}
