import { createLogger, type Logger } from "@yats/shared";
import * as http from "node:http";
import * as crypto from "node:crypto";
import {
  getAllToolDefinitions,
  createToolHandlers,
  type ToolDefinition,
  type ToolHandler,
  type McpDependencies,
} from "./tools/all-tools.js";

// ============================================================
// Types
// ============================================================

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

interface SseSession {
  id: string;
  res: http.ServerResponse;
}

// ============================================================
// McpServer — supports stdio and HTTP+SSE transports
// ============================================================

export class McpServer {
  private readonly tools: ToolDefinition[];
  private readonly handlers: Map<string, ToolHandler>;
  private readonly logger: Logger;
  private readonly indexer: McpDependencies["indexer"];
  private running = false;

  constructor(deps: McpDependencies) {
    this.logger = createLogger("mcp:server");
    this.tools = getAllToolDefinitions();
    this.handlers = createToolHandlers(deps);
    this.indexer = deps.indexer;
  }

  // ==========================================================
  // Public API
  // ==========================================================

  /**
   * Start the MCP server.
   * 
   * @param options.transport — "stdio" (default) or "http"
   * @param options.port — HTTP port (default 5555, only for http transport)
   */
  async start(options?: { transport?: "stdio" | "http"; port?: number }): Promise<void> {
    const transport = options?.transport ?? "stdio";

    if (transport === "http") {
      return this.startHttp(options?.port ?? 5555);
    }
    return this.startStdio();
  }

  /**
   * Handle a JSON-RPC request and return the response.
   * Public so both transports can use it.
   */
  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const { id, method, params } = request;

    // Notifications (no id) — JSON-RPC spec: MUST NOT reply
    if (id === undefined || id === null) return null;

    try {
      switch (method) {
        case "initialize":
          return {
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: { name: "yats", version: "0.1.0" },
            },
          };

        case "tools/list":
          return {
            jsonrpc: "2.0",
            id,
            result: { tools: this.tools },
          };

        case "tools/call": {
          const toolName = params?.name as string;
          const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>;

          const handler = this.handlers.get(toolName);
          if (!handler) {
            return {
              jsonrpc: "2.0",
              id,
              error: { code: -32601, message: `Unknown tool: ${toolName}` },
            };
          }

          this.logger.info(`Tool call: ${toolName}`);
          const result = await handler(toolArgs);

          return { jsonrpc: "2.0", id, result };
        }

        case "shutdown":
          await this.shutdown();
          return { jsonrpc: "2.0", id, result: null };

        case "ping":
          return { jsonrpc: "2.0", id, result: {} };

        default:
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
          };
      }
    } catch (err: any) {
      this.logger.error(`Handler error for ${method}: ${err.message}`);
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: `Internal error: ${err.message}` },
      };
    }
  }

  // ==========================================================
  // Stdio Transport
  // ==========================================================

  private async startStdio(): Promise<void> {
    this.running = true;
    this.logger.info("MCP server starting on stdio...");

    process.stdin.setEncoding("utf-8");
    let buffer = "";

    process.stdin.on("data", async (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const request = JSON.parse(trimmed) as JsonRpcRequest;
          const response = await this.handleRequest(request);
          if (response) this.sendStdioResponse(response);
        } catch (err: any) {
          this.logger.error(`Parse error: ${err.message}`);
          this.sendStdioResponse({
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

    process.on("SIGINT", () => this.shutdown());
    process.on("SIGTERM", () => this.shutdown());

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!this.running) {
          clearInterval(check);
          resolve();
        }
      }, 100);
    });
  }

  private sendStdioResponse(response: JsonRpcResponse): void {
    process.stdout.write(JSON.stringify(response) + "\n");
  }

  // ==========================================================
  // HTTP + SSE Transport
  // ==========================================================

  private readonly sessions = new Map<string, SseSession>();

  private async startHttp(port: number): Promise<void> {
    this.running = true;

    const server = http.createServer(async (req, res) => {
      // Prevent EPIPE crashes when client disconnects abruptly
      res.on("error", () => {});
      
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      // CORS headers for browser-based MCP clients
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // Health check
      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: this.running ? "ok" : "shutting_down",
          transport: "http+sse",
          sessions: this.sessions.size,
        }));
        return;
      }

      // Streamable HTTP — MCP transport used by Copilot, VS Code, pi-mcp-adapter
      if (url.pathname === "/mcp") {
        if (req.method === "DELETE") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
          return;
        }
        if (req.method === "GET") {
          const accept = req.headers["accept"] ?? "";
          if (accept.includes("text/event-stream")) {
            this.handleSseConnect(res);
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
          return;
        }
        if (req.method === "POST") {
          const body = await this.readBody(req);
          try {
            const request = JSON.parse(body) as JsonRpcRequest;
            const response = await this.handleRequest(request);
            if (response) {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(response));
            } else {
              res.writeHead(202);
              res.end();
            }
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ jsonrpc: "2.0", id: 0, error: { code: -32700, message: "Parse error" } }));
          }
          return;
        }
        res.writeHead(405);
        res.end();
        return;
      }

      // SSE endpoint — client opens this to listen for responses
      if (req.method === "GET" && url.pathname === "/mcp/sse") {
        this.handleSseConnect(res);
        return;
      }

      // Message endpoint — client POSTs JSON-RPC requests here
      if (req.method === "POST" && url.pathname === "/mcp/message") {
        this.handleSseMessage(req, res, url);
        return;
      }

      // Index endpoint — trigger indexing directly (used by setup wizard)
      if (req.method === "POST" && url.pathname === "/index") {
        this.handleIndex(req, res);
        return;
      }

      // Index file endpoint — receive single file from thin CLI
      if (req.method === "POST" && url.pathname === "/index/file") {
        this.handleIndexFile(req, res);
        return;
      }

      // 404
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });

    server.on("error", (err) => {
      this.logger.error(`HTTP server error: ${err.message}`);
    });

    // Prevent EPIPE crashes from abrupt client disconnects
    server.on("clientError", (err, socket) => {
      if (err.code === "EPIPE" || err.code === "ECONNRESET") {
        socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      }
    });

    server.listen(port, () => {
      this.logger.info(`MCP server listening on http://localhost:${port} (HTTP+SSE)`);
    });

    process.on("SIGINT", () => this.shutdown());
    process.on("SIGTERM", () => this.shutdown());

    // Keep alive until shutdown
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!this.running) {
          server.close(() => resolve());
          clearInterval(check);
        }
      }, 100);
    });
  }

  private handleSseConnect(res: http.ServerResponse): void {
    const sessionId = crypto.randomUUID();

    // SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // First message: the endpoint URL for this session
    const endpointUrl = `/mcp/message?sessionId=${sessionId}`;
    res.write(`event: endpoint\ndata: ${endpointUrl}\n\n`);

    this.sessions.set(sessionId, { id: sessionId, res });
    this.logger.info(`SSE session opened: ${sessionId}`);

    // Clean up on close
    res.on("close", () => {
      this.sessions.delete(sessionId);
      this.logger.info(`SSE session closed: ${sessionId}`);
    });

    // Prevent EPIPE crashes when client disconnects abruptly
    res.on("error", (err: any) => {
      if (err.code === "EPIPE") {
        this.sessions.delete(sessionId);
        this.logger.debug(`SSE session EPIPE (client disconnected): ${sessionId}`);
      }
    });

    // Keep alive every 30s
    const keepAlive = setInterval(() => {
      res.write(": keepalive\n\n");
    }, 30_000);

    res.on("close", () => clearInterval(keepAlive));
  }

  private async handleSseMessage(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
  ): Promise<void> {
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "missing sessionId query parameter" }));
      return;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "session not found" }));
      return;
    }

    // Read request body
    const body = await this.readBody(req);

    try {
      const request = JSON.parse(body) as JsonRpcRequest;
      const response = await this.handleRequest(request);

      // Send response via SSE
      if (response) {
        session.res.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
      }
    } catch (err: any) {
      session.res.write(
        `event: message\ndata: ${JSON.stringify({
          jsonrpc: "2.0",
          id: 0,
          error: { code: -32700, message: "Parse error" },
        })}\n\n`,
      );
    }

    // Acknowledge receipt
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ accepted: true }));
  }

  private async handleIndex(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const body = await this.readBody(req);
    try {
      const { path: repoPath } = JSON.parse(body);
      if (!repoPath) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "path is required" }));
        return;
      }
      const result = await this.indexer.ensureIndexed(repoPath);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
  }

  private async handleIndexFile(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const body = await this.readBody(req);
    try {
      const { repoName, filePath, content } = JSON.parse(body);
      if (!repoName || !filePath || content === undefined) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "repoName, filePath, and content are required" }));
        return;
      }
      await this.indexer.indexFileContent(repoName, filePath, content);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, file: filePath }));
    } catch (err: any) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk: string) => (data += chunk));
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });
  }

  // ==========================================================
  // Lifecycle
  // ==========================================================

  private shutdown(): void {
    this.logger.info("Shutting down...");
    this.running = false;

    // Close all SSE sessions
    for (const session of this.sessions.values()) {
      session.res.end();
    }
    this.sessions.clear();
  }
}
