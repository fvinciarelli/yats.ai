import { createLogger, type Logger } from "@yats/shared";
import type { ToolHandler, ToolResult } from "../tools/all-tools.js";

// ============================================================
// Error Handler Middleware
// Wraps tool handlers to catch unhandled exceptions
// ============================================================

export function withErrorHandler(handler: ToolHandler, toolName: string): ToolHandler {
  const logger = createLogger(`mcp:tool:${toolName}`);

  return async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      return await handler(args);
    } catch (err: any) {
      logger.error(`Unhandled error in ${toolName}: ${err.message}`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "InternalError",
              message: err.message ?? "Unknown error",
              tool: toolName,
            }),
          },
        ],
        isError: true,
      };
    }
  };
}
