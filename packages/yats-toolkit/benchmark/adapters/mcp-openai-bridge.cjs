#!/usr/bin/env node
/**
 * YATS Benchmark — MCP→OpenAI Bridge
 *
 * Minimal zero-dependency bridge that:
 * 1. Fetches tool definitions from YATS MCP
 * 2. Exposes an OpenAI-compatible /v1/chat/completions endpoint
 * 3. Forwards requests to the real LLM API (OpenAI or Anthropic)
 * 4. Intercepts tool_calls → routes to YATS MCP → returns results
 *
 * Usage:
 *   node mcp-openai-bridge.js [--port 8000] [--mcp http://localhost:5555/mcp]
 */

const http = require("node:http");
const https = require("node:https");

// ── Config ──────────────────────────────────────────────
const PORT = parseInt(process.env.YATS_BRIDGE_PORT || "8000", 10);
const MCP_URL = process.env.YATS_MCP_URL || "http://localhost:5555/mcp";
const UPSTREAM = process.env.YATS_BRIDGE_UPSTREAM || "openai"; // openai | anthropic
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const UPSTREAM_URL = process.env.YATS_BRIDGE_UPSTREAM_URL || (
  UPSTREAM === "anthropic"
    ? "https://api.anthropic.com/v1/messages"
    : "https://api.openai.com/v1/chat/completions"
);
const UPSTREAM_KEY = process.env.YATS_BRIDGE_UPSTREAM_KEY || (UPSTREAM === "anthropic" ? ANTHROPIC_KEY : OPENAI_KEY);

// ── State ────────────────────────────────────────────────
let mcpTools = [];
let requestId = 0;

// ── Logger ───────────────────────────────────────────────
const log = (msg) => process.stderr.write(`[bridge] ${msg}\n`);

// ── MCP: fetch tools ─────────────────────────────────────
async function fetchMcpTools() {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {},
  });

  return new Promise((resolve, reject) => {
    const url = new URL(MCP_URL);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const r = JSON.parse(data);
            if (r.result?.tools) {
              resolve(r.result.tools);
            } else {
              reject(new Error(`MCP error: ${JSON.stringify(r)}`));
            }
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Convert MCP tools → OpenAI functions ─────────────────
function mcpToOpenAITools(tools) {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description || "",
      parameters: t.inputSchema || { type: "object", properties: {} },
    },
  }));
}

// ── MCP: call a tool ─────────────────────────────────────
async function callMcpTool(name, args) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: Date.now(),
    method: "tools/call",
    params: { name, arguments: args },
  });

  return new Promise((resolve, reject) => {
    const url = new URL(MCP_URL);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const r = JSON.parse(data);
            if (r.result?.content) {
              resolve(r.result.content);
            } else if (r.error) {
              resolve([{ type: "text", text: `Error: ${r.error.message}` }]);
            } else {
              resolve([{ type: "text", text: JSON.stringify(r) }]);
            }
          } catch (e) {
            resolve([{ type: "text", text: `Parse error: ${e.message}` }]);
          }
        });
      },
    );
    req.on("error", (e) => {
      resolve([{ type: "text", text: `MCP call error: ${e.message}` }]);
    });
    req.write(body);
    req.end();
  });
}

// ── Model name mapping for different upstreams ───────────
function mapModelName(model) {
  // When using non-OpenAI upstream, map common model names
  if (UPSTREAM_URL.includes("deepseek.com")) {
    const map = {
      "gpt-4o-mini": "deepseek-chat",
      "gpt-4o": "deepseek-chat",
      "gpt-4": "deepseek-chat",
      "gpt-3.5-turbo": "deepseek-chat",
      "sonnet": "deepseek-chat",
    };
    return map[model] || model;
  }
  return model;
}

// ── Upstream: forward to LLM ─────────────────────────────
function callUpstreamOpenAI(messages, tools, model) {
  const body = JSON.stringify({
    model: model || "gpt-4o-mini",
    messages,
    tools,
    tool_choice: tools.length > 0 ? "auto" : undefined,
    stream: false,
  });

  const transport = UPSTREAM_URL.startsWith("https") ? https : http;
  return new Promise((resolve, reject) => {
    const url = new URL(UPSTREAM_URL);
    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${UPSTREAM_KEY}`,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`OpenAI parse error: ${e.message} — ${data.slice(0, 200)}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(120_000, () => { req.destroy(); reject(new Error("OpenAI timeout")); });
    req.write(body);
    req.end();
  });
}

function callUpstreamAnthropic(messages, tools, model) {
  // Convert OpenAI-format messages → Anthropic format
  const systemMsg = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const chatMessages = messages.filter((m) => m.role !== "system");

  const anthropicTools = tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));

  const body = JSON.stringify({
    model: model || "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: systemMsg || undefined,
    messages: chatMessages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    })),
    tools: anthropicTools.length > 0 ? anthropicTools : undefined,
  });

  const transport = UPSTREAM_URL.startsWith("https") ? https : http;
  return new Promise((resolve, reject) => {
    const url = new URL(UPSTREAM_URL);
    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": UPSTREAM_KEY,
          "anthropic-version": "2023-06-01",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Anthropic parse error: ${e.message}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(120_000, () => { req.destroy(); reject(new Error("Anthropic timeout")); });
    req.write(body);
    req.end();
  });
}

// ── Tool call loop ───────────────────────────────────────
async function runWithTools(messages, tools, model, maxTurns = 5) {
  let currentMessages = [...messages];
  let totalTokens = 0;
  let totalToolCalls = 0;
  const MAX_TOOL_CALLS = 3;

  for (let turn = 0; turn < maxTurns; turn++) {
    let response;
    if (UPSTREAM === "anthropic") {
      response = await callUpstreamAnthropic(currentMessages, tools, model);
      // Check for tool_use in Anthropic response
      const toolUses = [];
      let textContent = "";
      for (const block of response.content || []) {
        if (block.type === "tool_use") toolUses.push(block);
        if (block.type === "text") textContent += block.text;
      }
      totalTokens += (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

      if (toolUses.length === 0) {
        // No more tool calls — return final
        return { content: textContent || JSON.stringify(response.content), tokens: totalTokens };
      }

      // Execute tools via MCP
      currentMessages.push({ role: "assistant", content: response.content });
      const toolResults = [];
      for (const tu of toolUses) {
        log(`Tool call: ${tu.name}(${JSON.stringify(tu.input).slice(0, 100)})`);
        const result = await callMcpTool(tu.name, tu.input);
        const resultText = result.map((c) => c.text || "").join("\n");
        toolResults.push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: tu.id, content: resultText }],
        });
      }
      currentMessages.push(...toolResults);
    } else {
      // OpenAI path
      response = await callUpstreamOpenAI(currentMessages, tools, model);
      totalTokens += (response.usage?.prompt_tokens || 0) + (response.usage?.completion_tokens || 0);

      const choice = response.choices?.[0];
      if (!choice) {
        return { content: JSON.stringify(response), tokens: totalTokens };
      }

      const msg = choice.message;
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        return { content: msg.content || "", tokens: totalTokens };
      }

      // Execute tools via MCP (OpenAI path)
      currentMessages.push(msg);
      for (const tc of msg.tool_calls) {
        totalToolCalls++;
        if (totalToolCalls > MAX_TOOL_CALLS) {
          // Force stop: inject error message so LLM must synthesize
          currentMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: "LIMIT REACHED: You have used all " + MAX_TOOL_CALLS + " YATS calls. Synthesize your answer NOW with what you have. Do NOT call more tools.",
          });
          log(`Tool call ${totalToolCalls}/${MAX_TOOL_CALLS}: LIMIT ENFORCED for ${tc.function.name}`);
          continue;
        }
        const args = JSON.parse(tc.function.arguments || "{}");
        log(`Tool call ${totalToolCalls}/${MAX_TOOL_CALLS}: ${tc.function.name}(${JSON.stringify(args).slice(0, 100)})`);
        const result = await callMcpTool(tc.function.name, args);
        const resultText = result.map((c) => c.text || "").join("\n");
        log(`  → ${resultText.length} chars`);
        currentMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: resultText.slice(0, 4000), // truncate to avoid token blowup
        });
      }
      log(`Turn ${turn + 1}: ${msg.tool_calls.length} tool calls, continuing...`);
    }
  }

  log(`Max turns (${maxTurns}) reached.`);
  return { content: "Max tool turns reached", tokens: totalTokens };
}

// ── HTTP Server ──────────────────────────────────────────
async function startServer() {
  // Fetch tools on startup
  try {
    log(`Fetching tools from ${MCP_URL}...`);
    mcpTools = await fetchMcpTools();
    log(`Got ${mcpTools.length} tools: ${mcpTools.map((t) => t.name).join(", ")}`);
  } catch (e) {
    log(`WARNING: Could not fetch MCP tools: ${e.message}`);
    log("Bridge will start without tools. Agents will work but without YATS.");
  }

  const openaiTools = mcpToOpenAITools(mcpTools);

  const server = http.createServer(async (req, res) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Log all requests
    log(`${req.method} ${req.url}`);

    // Health check
    if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", tools: mcpTools.length }));
      return;
    }

    // /v1/chat/completions
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      const rid = ++requestId;
      try {
        const body = await readBody(req);
        log(`[${rid}] RAW: ${body.slice(0, 250)}`);
        const payload = JSON.parse(body);
        const model = payload.model || "gpt-4o-mini";
        const messages = payload.messages || [];

        // Inject YATS system prompt to teach the agent efficient MCP usage
        const yatsSystemPrompt = `# YATS Code Intelligence — Misión: Responder con < 4 llamadas

Eres un asistente que responde preguntas sobre el código usando el grafo YATS.  
Tu única métrica de éxito es dar una respuesta útil al usuario en el MENOR número de llamadas posible.

## LEYES OBLIGATORIAS (violarlas = fallo de tarea)

1. **Tope absoluto: 3 llamadas a herramientas YATS por pregunta.**  
   - En la 3ª llamada, después de recibir su respuesta, DEBES publicar tu respuesta final.  
   - Si no tienes todos los datos, admítelo y da lo que tengas. Una respuesta parcial vale más que 27 calls.

2. **Flujo predefinido (ejecuta este guion, no improvises):**  
   - Call 1 (obligatoria): search_code(question, repository="lab_hub").  
   - Call 2 (condicional): Toma los 2 mejores símbolos de la Call 1. Llama a expand_graph(symbols=[top1, top2], repository="lab_hub") para obtener definición, callers y callees de ambos en UNA sola respuesta.  
   - Call 3 (solo si falla expand_graph): Si expand_graph no existe o devuelve vacío, usa find_callers o find_callees sobre el único símbolo más relevante.  
   - NO uses find_symbol más de 1 vez en toda la tarea, y solo si search_code no devolvió la ubicación exacta.

3. **Muestreo forzoso (anti-pesca):**  
   - Ignora el resto de resultados de search_code. Solo trabajas con el top 2.  
   - Si la pregunta es sobre "cómo funciona X", con 2 símbolos y su grafo es suficiente para dar una explicación estructural.

4. **Criterio de parada anticipada:**  
   - Después de la Call 1, si los resultados ya responden directamente la pregunta, NO hagas Call 2. Responde inmediatamente.

## PATRONES PROHIBIDOS (autobloqueo mental)
- ❌ Recorrer una lista de símbolos uno por uno con find_symbol.  
- ❌ Hacer más de 1 search_code por tarea (la primera ya te dio el contexto).  
- ❌ Llamar a find_callers para más de 1 símbolo.  
- ❌ Usar read_file antes de haber agotado las 3 calls de YATS.

## Formato de respuesta final
Sintetiza en 3 párrafos como máximo:  
1. Propósito principal del código encontrado.  
2. Flujo de llamadas/relaciones clave (usando los datos de expand_graph).  
3. Archivos/líneas concretas si son relevantes.

Recuerda: el repositorio siempre es "lab_hub".  
Comienza ahora. Tu primera llamada será search_code.`;

        // Prepend YATS system prompt if not already present
        const hasYatsSystem = messages.some((m) => m.role === "system" && m.content?.includes("YATS Code Intelligence"));
        if (!hasYatsSystem) {
          messages.unshift({ role: "system", content: yatsSystemPrompt });
          log(`[${rid}] Injected YATS system prompt`);
        }

        const upstreamModel = mapModelName(model);
        log(`[${rid}] ${messages.length} messages, model=${model}→${upstreamModel}, tools=${openaiTools.length}, stream=${payload.stream}`);

        // Strip streaming — bridge doesn't support it, Aider must accept non-streamed
        if (payload.stream) {
          payload.stream = false;
          log(`[${rid}] Stripped stream=true, forcing non-streaming`);
        }

        const result = await runWithTools(messages, openaiTools, upstreamModel);

        log(`[${rid}] Done: ~${result.tokens} tokens, content=${(result.content || "").slice(0, 80)}`);
        
        // Ensure content is a non-empty string
        const finalContent = result.content || "Analysis complete. See tool results above.";
        
        // Return in OpenAI format
        const openaiResponse = {
          id: `chatcmpl-${rid}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{
            index: 0,
            message: { role: "assistant", content: finalContent },
            finish_reason: "stop",
          }],
          usage: {
            prompt_tokens: Math.max(1, Math.floor(result.tokens * 0.7)),
            completion_tokens: Math.max(1, Math.floor(result.tokens * 0.3)),
            total_tokens: result.tokens,
          },
        };
        
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(openaiResponse));
      } catch (e) {
        log(`[${rid}] ERROR: ${e.message}`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: e.message } }));
      }
      return;
    }

    // /v1/models — needed by some clients
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        object: "list",
        data: [{ id: "gpt-4o-mini", object: "model" }],
      }));
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  return new Promise((resolve) => {
    server.listen(PORT, () => {
      log(`Bridge listening on http://localhost:${PORT}`);
      log(`  /v1/chat/completions — OpenAI-compatible endpoint`);
      log(`  /health — health check`);
      log(`  Upstream: ${UPSTREAM}`);
      log(`  MCP tools: ${mcpTools.length}`);
      resolve(server);
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// ── Main ─────────────────────────────────────────────────
startServer().catch((e) => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});
