import { createLogger, type Logger } from "@code-indexer/shared";
import type { ToolHandler, ToolResult } from "../tools/all-tools.js";

// ============================================================
// Rate Limiter Middleware
// Limits tool calls per time window
// ============================================================

export interface RateLimiterConfig {
  /** Maximum calls per window */
  maxCalls: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxCalls: 60,
  windowMs: 60_000, // 60 calls per minute
};

export function createRateLimiter(
  config: Partial<RateLimiterConfig> = {},
) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const logger = createLogger("mcp:rate-limiter");

  const callTimestamps: number[] = [];

  /**
   * Check if a new call is allowed. Returns true if within limits.
   */
  function allow(): boolean {
    const now = Date.now();
    const windowStart = now - cfg.windowMs;

    // Purge old entries
    while (callTimestamps.length > 0 && (callTimestamps[0] ?? 0) < windowStart) {
      callTimestamps.shift();
    }

    if (callTimestamps.length >= cfg.maxCalls) {
      logger.warn(`Rate limit exceeded: ${callTimestamps.length}/${cfg.maxCalls} in ${cfg.windowMs}ms`);
      return false;
    }

    callTimestamps.push(now);
    return true;
  }

  /**
   * Wrap a tool handler with rate limiting.
   */
  function withRateLimit(handler: ToolHandler): ToolHandler {
    return async (args: Record<string, unknown>): Promise<ToolResult> => {
      if (!allow()) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "RateLimitExceeded",
                message: `Too many requests. Limit: ${cfg.maxCalls}/${cfg.windowMs}ms`,
                retryAfterMs: cfg.windowMs,
              }),
            },
          ],
          isError: true,
        };
      }

      return handler(args);
    };
  }

  return {
    allow,
    withRateLimit,
    get remaining(): number {
      const now = Date.now();
      const windowStart = now - cfg.windowMs;
      while (callTimestamps.length > 0 && (callTimestamps[0] ?? 0) < windowStart) {
        callTimestamps.shift();
      }
      return Math.max(0, cfg.maxCalls - callTimestamps.length);
    },
  };
}
