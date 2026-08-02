import { createLogger, type Logger } from "@yats/shared";
import type { EmbeddingGenerator } from "@yats/shared";
import { Language } from "@yats/shared";

// ============================================================
// Voyage AI Embedding Generator
// Uses voyage-code-2 by default (1536 dimensions)
// Optimized for code embeddings
// API docs: https://docs.voyageai.com/reference/embeddings-api
// ============================================================

export interface VoyageConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

function loadVoyageConfig(): VoyageConfig {
  return {
    apiKey: process.env.VOYAGE_API_KEY ?? "",
    model: process.env.VOYAGE_MODEL ?? "voyage-code-2",
    baseUrl: process.env.VOYAGE_BASE_URL ?? "https://api.voyageai.com/v1",
  };
}

export class VoyageEmbeddingGenerator implements EmbeddingGenerator {
  readonly dimensions = 1536; // voyage-code-2
  private readonly config: VoyageConfig;
  private readonly logger: Logger;

  constructor(config?: Partial<VoyageConfig>) {
    this.config = { ...loadVoyageConfig(), ...config };
    this.logger = createLogger("embeddings:voyage");
  }

  async embed(text: string): Promise<number[]> {
    const embeddings = await this.callVoyage([text]);
    return embeddings[0]!;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Voyage supports batches natively
    return this.callVoyage(texts);
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

  private async callVoyage(inputs: string[]): Promise<number[][]> {
    if (!this.config.apiKey) {
      throw new Error("Voyage API key not configured");
    }

    let attempt = 0;
    const maxRetries = 3;

    while (attempt < maxRetries) {
      const response = await fetch(`${this.config.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          input: inputs,
          input_type: "document", // "document" for general text, "query" for search queries
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (response.status === 429) {
        const delay = Math.pow(2, attempt) * 1000;
        this.logger.warn(
          `Voyage rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`,
        );
        await sleep(delay);
        attempt++;
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Voyage embeddings API error (${response.status}): ${text}`,
        );
      }

      const data = (await response.json()) as {
        data: Array<{ embedding: number[] }>;
      };
      return data.data.map((d) => d.embedding);
    }

    throw new Error("Voyage rate limit exceeded after retries");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
