import { createLogger, type Logger } from "@yats/shared";
import {
  getAllToolDefinitions,
  createToolHandlers,
  type ToolDefinition,
  type ToolHandler,
  type McpDependencies,
} from "./tools/all-tools.js";

// ============================================================
// MCP JSON-RPC Server (stdio transport)
// ============================================================

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export class McpServer {
  private readonly tools: ToolDefinition[];
  private readonly handlers: Map<string, ToolHandler>;
  private readonly logger: Logger;
  private running = false;

  constructor(deps: McpDependencies) {
    this.logger = createLogger("mcp:server");
    this.tools = getAllToolDefinitions();
    this.handlers = createToolHandlers(deps);
  }

  /**
   * Start the MCP server on stdio.
   * Reads JSON-RPC from stdin, writes responses to stdout.
   */
  async start(): Promise<void> {
    this.running = true;
    this.logger.info("MCP server starting on stdio...");

    // Read from stdin
    process.stdin.setEncoding("utf-8");

    let buffer = "";

    process.stdin.on("data", async (chunk: string) => {
      buffer += chunk;

      // Process complete messages (line-delimited JSON)
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const request = JSON.parse(trimmed) as JsonRpcRequest;
          const response = await this.handleRequest(request);
          if (response) this.sendResponse(response);
        } catch (err: any) {
          this.logger.error(`Parse error: ${err.message}`);
          this.sendResponse({
            jsonrpc: "2.0",
            id: 0,
            error: { code: -32700, message: "Parse error" },
          });
        }
      }
    });

    process.stdin.on("end", () => {
      this.logger.info("stdin closed, shutting down");
      this.running = false;
    });

    // Handle process signals
    process.on("SIGINT", () => this.shutdown());
    process.on("SIGTERM", () => this.shutdown());

    // Keep alive
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!this.running) {
          clearInterval(check);
          resolve();
        }
      }, 100);
    });
  }

  /**
   * Handle a JSON-RPC request.
   */
  private async handleRequest(
    request: JsonRpcRequest,
  ): Promise<JsonRpcResponse | null> {
    const { id, method, params } = request;

    // Notifications have no id — JSON-RPC spec: MUST NOT reply
    if (id === undefined || id === null) return null;

    try {
      // Notifications have no id — silently ignore
      if (id === undefined || id === null) {
        return { jsonrpc: "2.0", id: 0, result: null };
      }

      switch (method) {
        case "initialize":
          return {
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: {
                tools: {},
              },
              serverInfo: {
                name: "yats",
                version: "0.1.0",
              },
            },
          };

        case "tools/list":
          return {
            jsonrpc: "2.0",
            id,
            result: {
              tools: this.tools,
            },
          };

        case "tools/call": {
          const toolName = params?.name as string;
          const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>;

          const handler = this.handlers.get(toolName);
          if (!handler) {
            return {
              jsonrpc: "2.0",
              id,
              error: {
                code: -32601,
                message: `Unknown tool: ${toolName}`,
              },
            };
          }

          this.logger.info(`Tool call: ${toolName}`);
          const result = await handler(toolArgs);

          return {
            jsonrpc: "2.0",
            id,
            result,
          };
        }

        case "shutdown":
          this.shutdown();
          return { jsonrpc: "2.0", id, result: null };

        case "ping":
          return { jsonrpc: "2.0", id, result: {} };

        default:
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32601,
              message: `Method not found: ${method}`,
            },
          };
      }
    } catch (err: any) {
      this.logger.error(`Handler error for ${method}: ${err.message}`);
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: `Internal error: ${err.message}`,
        },
      };
    }
  }

  /**
   * Send a JSON-RPC response to stdout.
   */
  private sendResponse(response: JsonRpcResponse): void {
    process.stdout.write(JSON.stringify(response) + "\n");
  }

  /**
   * Graceful shutdown.
   */
  private shutdown(): void {
    this.logger.info("Shutting down...");
    this.running = false;
  }
}
