import { createLogger, type Logger } from "@yats/shared";
import type { EmbeddingGenerator } from "@yats/shared";
import { Language } from "@yats/shared";

// ============================================================
// OpenAI Embedding Generator
// Uses text-embedding-3-small by default (1536 dimensions)
// ============================================================

export interface OpenAIConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  /**
   * "openai" — OpenAI-compatible API: POST {baseUrl}/embeddings, Bearer auth.
   * "azure" — Azure OpenAI: POST {baseUrl}/openai/deployments/{model}/embeddings
   *           with `api-key` auth and an `api-version` query param.
   */
  apiStyle: "openai" | "azure";
  apiVersion: string;
  /** Explicit vector dimension override (e.g. Azure deployments with custom names). */
  dimensions?: number;
}

function loadOpenAIConfig(): OpenAIConfig {
  const apiStyle = (process.env.OPENAI_API_STYLE ?? "openai") as "openai" | "azure";
  return {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_MODEL ?? "text-embedding-3-small",
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    apiStyle,
    apiVersion: process.env.OPENAI_AZURE_API_VERSION ?? "2024-02-01",
    dimensions: process.env.OPENAI_EMBEDDING_DIMENSIONS
      ? parseInt(process.env.OPENAI_EMBEDDING_DIMENSIONS, 10) || undefined
      : undefined,
  };
}

const OPENAI_MODEL_DIMENSIONS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
};

export class OpenAIEmbeddingGenerator implements EmbeddingGenerator {
  readonly dimensions: number;
  private readonly config: OpenAIConfig;
  private readonly logger: Logger;

  constructor(config?: Partial<OpenAIConfig>) {
    this.config = { ...loadOpenAIConfig(), ...config };
    this.dimensions =
      this.config.dimensions ??
      OPENAI_MODEL_DIMENSIONS[this.config.model] ??
      1536;
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
      const response = await fetch(this.buildRequestUrl(), {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model: this.config.model,
          input: inputs,
        }),
        signal: AbortSignal.timeout(60000),
      });

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

  /**
   * OpenAI-compatible: {baseUrl}/embeddings.
   * Azure: the endpoint may be the resource base
   * (https://my-resource.openai.azure.com) or already include the deployment
   * path; we normalize both and append the api-version query param.
   */
  private buildRequestUrl(): string {
    if (this.config.apiStyle !== "azure") {
      return `${this.config.baseUrl}/embeddings`;
    }
    let base = this.config.baseUrl.replace(/\/+$/, "").split("?")[0]!;
    if (!base.includes("/openai/deployments/")) {
      base = `${base}/openai/deployments/${this.config.model}`;
    }
    if (!base.endsWith("/embeddings")) {
      base = `${base}/embeddings`;
    }
    return `${base}?api-version=${this.config.apiVersion}`;
  }

  private buildHeaders(): Record<string, string> {
    if (this.config.apiStyle === "azure") {
      return { "Content-Type": "application/json", "api-key": this.config.apiKey };
    }
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
    };
  }

  private prepareCodeText(code: string, language: Language): string {
    return `[${language}] ${code}`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
