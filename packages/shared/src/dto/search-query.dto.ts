import type { Language, SymbolKind } from "../domain/enums.js";

export interface SearchCodeQuery {
  query: string;
  repository: string;
  language?: Language;
  kind?: SymbolKind;
  limit?: number;
  includeTests?: boolean;
}

export interface SearchDocumentationQuery {
  query: string;
  repository: string;
  limit?: number;
}
