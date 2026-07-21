import type { RankedContextItem } from "@yats/shared";
import { SymbolKind } from "@yats/shared";

// ============================================================
// Context Compression — trims snippets to save tokens
// ============================================================

export interface CompressOptions {
  /** Whether to include test symbols */
  includeTests?: boolean;
  /** Max snippet lines per item */
  maxSnippetLines?: number;
}

const DEFAULT_MAX_SNIPPET_LINES = 50;

export class ContextCompressorService {
  /**
   * Apply compression strategies to fit within context.
   */
  compress(
    items: RankedContextItem[],
    options: CompressOptions = {},
  ): RankedContextItem[] {
    const maxLines = options.maxSnippetLines ?? DEFAULT_MAX_SNIPPET_LINES;
    const includeTests = options.includeTests ?? true;

    return items
      // Remove test symbols if not requested
      .filter((item) => {
        if (!includeTests && item.symbol.kind === SymbolKind.TEST) {
          return false;
        }
        return true;
      })
      // Truncate long snippets
      .map((item) => {
        const snippet = item.snippet ?? "";

        // Truncate by line count
        const lines = snippet.split("\n");
        if (lines.length > maxLines) {
          return {
            ...item,
            snippet: lines.slice(0, maxLines).join("\n") + "\n// ... (truncated)",
          };
        }

        // Strip import/export lines from top (but keep the symbol code)
        const trimmed = this.stripImports(snippet);
        if (trimmed !== snippet) {
          return { ...item, snippet: trimmed };
        }

        return item;
      });
  }

  /**
   * Remove import/export lines when they're not the result.
   * This saves significant tokens in large files.
   */
  private stripImports(code: string): string {
    const lines = code.split("\n");
    let firstCodeLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (
        line.startsWith("import ") ||
        line.startsWith("export ") ||
        line.startsWith("from ") ||
        line === ""
      ) {
        firstCodeLine = i + 1;
      } else {
        break;
      }
    }

    if (firstCodeLine > 0 && firstCodeLine < lines.length) {
      return lines.slice(firstCodeLine).join("\n");
    }

    return code;
  }
}
