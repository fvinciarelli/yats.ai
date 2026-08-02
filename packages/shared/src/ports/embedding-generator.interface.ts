import type { Language } from "../domain/enums.js";

export interface EmbeddingGenerator {
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  embedCode(code: string, language: Language): Promise<number[]>;
  embedDocumentation(text: string): Promise<number[]>;
  isAvailable(): Promise<boolean>;
}
