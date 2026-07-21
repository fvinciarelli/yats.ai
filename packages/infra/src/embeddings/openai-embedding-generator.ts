import { createLogger, type Logger } from "@code-indexer/shared";
import type { EmbeddingGenerator } from "@code-indexer/shared";
import { Language } from "@code-indexer/shared";

// ============================================================
// OpenAI Embedding Generator
// Uses text-embedding-3-small by default (1536 dimensions)
// ============================================================

export interface OpenAIConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

function loadOpenAIConfig(): OpenAIConfig {
  return {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_MODEL ?? "text-embedding-3-small",
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  };
}

export class OpenAIEmbeddingGenerator implements EmbeddingGenerator {
  readonly dimensions = 1536; // text-embedding-3-small
  private readonly config: OpenAIConfig;
  private readonly logger: Logger;

  constructor(config?: Partial<OpenAIConfig>) {
    this.config = { ...loadOpenAIConfig(), ...config };
    this.logger = createLogger("embeddings:openai");
  }

  async embed(text: string): Promise<number[]> {
    const embeddings = await this.callOpenAI([text]);
    return embeddings[0]!;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.callOpenAI(texts);
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
    return !!this.config.apiKey;
  }

  // ============================================================
  // Private
  // ============================================================

  private async callOpenAI(inputs: string[]): Promise<number[][]> {
    if (!this.config.apiKey) {
      throw new Error("OpenAI API key not configured");
    }

    let attempt = 0;
    const maxRetries = 3;

    while (attempt < maxRetries) {
      const response = await fetch(
        `${this.config.baseUrl}/embeddings`,
        {
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
        },
      );

      if (response.status === 429) {
        // Rate limited — back off
        const retryAfter = response.headers.get("retry-after");
        const delay = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.pow(2, attempt) * 1000;

        this.logger.warn(
          `OpenAI rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`,
        );
        await sleep(delay);
        attempt++;
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `OpenAI embeddings API error (${response.status}): ${text}`,
        );
      }

      const data = (await response.json()) as {
        data: Array<{ embedding: number[] }>;
      };
      return data.data.map((d) => d.embedding);
    }

    throw new Error("OpenAI rate limit exceeded after retries");
  }

  private prepareCodeText(code: string, language: Language): string {
    return `[${language}] ${code}`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
