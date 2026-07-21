import { createLogger, type Logger } from "@code-indexer/shared";
import type { ToolHandler, ToolResult } from "../tools/all-tools.js";

// ============================================================
// Logging Middleware
// Logs every tool call with timing
// ============================================================

export function withLogging(handler: ToolHandler, toolName: string): ToolHandler {
  const logger = createLogger(`mcp:tool:${toolName}`);

  return async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    // Log the call (without potentially huge content values)
    const safeArgs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === "string" && value.length > 200) {
        safeArgs[key] = `${value.slice(0, 200)}... (${value.length} chars)`;
      } else {
        safeArgs[key] = value;
      }
    }

    logger.info(`-> ${toolName}`, safeArgs);

    const result = await handler(args);

    const duration = Date.now() - startTime;

    // Log result summary
    if (result.isError) {
      logger.warn(`<- ${toolName} ERROR (${duration}ms)`);
    } else {
      const textLen = result.content.reduce(
        (sum, c) => sum + (c.text?.length ?? 0),
        0,
      );
      logger.info(`<- ${toolName} OK (${duration}ms, ${textLen} chars)`);
    }

    return result;
  };
}
