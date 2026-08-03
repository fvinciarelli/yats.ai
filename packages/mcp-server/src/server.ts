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
import { validateArgs } from "./middleware/validation.js";

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
  _sessionId?: string;
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
              protocolVersion: "2025-03-26",
              capabilities: { tools: {} },
              serverInfo: { name: "yats", version: "0.1.0" },
            },
            _sessionId: crypto.randomUUID(),
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

          // Validate arguments with zod schemas
          const validation = validateArgs(toolName, toolArgs);
          if (!validation.ok) {
            return {
              jsonrpc: "2.0",
              id,
              error: { code: -32602, message: validation.error },
            };
          }

          this.logger.info(`Tool call: ${toolName}`);
          const result = await handler(validation.parsed);

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
        this.logger.info(`MCP: ${req.method} ${req.url} Accept=${req.headers["accept"]} Session=${req.headers["mcp-session-id"] || "none"}`);
        if (req.method === "DELETE") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
          return;
        }
        if (req.method === "GET") {
          const accept = req.headers["accept"] ?? "";
          if (accept.includes("text/event-stream")) {
            const existingSessionId = req.headers["mcp-session-id"] as string | undefined;
            this.logger.info(`SSE connect: sessionId header=${existingSessionId || "none"}`);
            this.handleSseConnect(res, existingSessionId);
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
            this.logger.info(`MCP request: ${request.method} id=${request.id}`);
            const response = await this.handleRequest(request);
            if (response) {
              const sessionId = (response as any)._sessionId;
              delete (response as any)._sessionId;
              const headers: Record<string, string> = { "Content-Type": "application/json" };
              if (sessionId) {
                headers["Mcp-Session-Id"] = sessionId;
              }
              res.writeHead(200, headers);
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
      if (req.method === "POST" && url.pathname === "/index/remove") {
        this.handleIndexRemove(req, res);
        return;
      }

      // 404
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });

    server.on("error", (err) => {
      this.logger.error(`HTTP server error: ${err.message}`);
    });

    // Keep connections alive longer — MCP tools/call can arrive seconds after tools/list
    server.keepAliveTimeout = 300_000; // 5 minutes
    server.headersTimeout = 310_000;

    // Prevent EPIPE crashes from abrupt client disconnects
    server.on("clientError", (err, socket) => {
      if ((err as any).code === "EPIPE" || (err as any).code === "ECONNRESET") {
        socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      }
    });

    // Global EPIPE handler — last line of defense
    process.on("uncaughtException", (err) => {
      if ((err as any).code === "EPIPE" || (err as any).code === "ECONNRESET") {
        return; // swallow silently
      }
      throw err;
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

  private handleSseConnect(res: http.ServerResponse, existingSessionId?: string): void {
    const sessionId = existingSessionId || crypto.randomUUID();
    const isNew = !existingSessionId;

    // SSE headers for Streamable HTTP (no legacy "event: endpoint")
    // JSON-RPC goes via POST /mcp, SSE is only for server→client notifications
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    this.sessions.set(sessionId, { id: sessionId, res });
    this.logger.info(`SSE session ${isNew ? "opened" : "attached"}: ${sessionId}`);

    // Send initial comment to signal stream is alive
    res.write(": connected\n\n");

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
    }, 3_000);

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
      const params = JSON.parse(body);
      const repoName = params.repoName || params.repository;
      const filePath = params.filePath || params.path;
      const content = params.content;
      if (!repoName || !filePath || content === undefined) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "repoName/repository, filePath/path, and content are required" }));
        return;
      }
      const result = await this.indexer.indexFileContent(repoName, filePath, content);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, status: result.status, reason: result.reason, file: filePath }));
    } catch (err: any) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
  }

  private async handleIndexRemove(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const body = await this.readBody(req);
    try {
      const { repository, path } = JSON.parse(body);
      if (!repository || !path) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "repository and path are required" }));
        return;
      }
      const result = await this.indexer.removeFile(repository, path);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, removed: result.removed, file: path }));
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
