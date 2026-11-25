import { createLogger, type Logger } from "@yats/shared";
import type { EmbeddingGenerator } from "@yats/shared";
import { Language } from "@yats/shared";

// ============================================================
// Mistral AI Embedding Generator
// Uses mistral-embed by default (1024 dimensions)
// API docs: https://docs.mistral.ai/api/#tag/Embeddings
// ============================================================

export interface MistralConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

function loadMistralConfig(): MistralConfig {
  return {
    apiKey: process.env.MISTRAL_API_KEY ?? "",
    model: process.env.MISTRAL_MODEL ?? "mistral-embed",
    baseUrl: process.env.MISTRAL_BASE_URL ?? "https://api.mistral.ai/v1",
  };
}

const MISTRAL_MODEL_DIMENSIONS: Record<string, number> = {
  "mistral-embed": 1024,
};

export class MistralEmbeddingGenerator implements EmbeddingGenerator {
  readonly dimensions: number;
  private readonly config: MistralConfig;
  private readonly logger: Logger;

  constructor(config?: Partial<MistralConfig>) {
    this.config = { ...loadMistralConfig(), ...config };
    this.dimensions = MISTRAL_MODEL_DIMENSIONS[this.config.model] ?? 1024;
    this.logger = createLogger("embeddings:mistral");
  }

  async embed(text: string): Promise<number[]> {
    const embeddings = await this.callMistral([text]);
    return embeddings[0]!;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.callMistral(texts);
  }

  async embedCode(code: string, language: Language): Promise<number[]> {
    return this.embed(`[${language}] ${code}`);
  }

  async embedDocumentation(text: string): Promise<number[]> {
    return this.embed(`[documentation] ${text}`);
  }

  async isAvailable(): Promise<boolean> {
    if (!this.config.apiKey) return false;
    try {
      const response = await fetch(`${this.config.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async callMistral(inputs: string[]): Promise<number[][]> {
    if (!this.config.apiKey) {
      throw new Error("Mistral API key not configured");
    }

    const response = await fetch(`${this.config.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        input: inputs,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Mistral embeddings API error (${response.status}): ${text}`,
      );
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    return data.data.map((d) => d.embedding);
  }
}
