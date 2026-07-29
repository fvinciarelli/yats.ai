# Benchmark YATS — Codex + MCP stdio

**Fecha:** 2026-07-29
**Codex:** 0.145.0
**Modelo:** gpt-4.1-mini (vía DeepSeek)
**Pregunta:** "Find NewParserWorker function signature with parameter types and return values"
**Repo:** lab_hub (Go, 478 archivos)

---

## Resultado

| Métrica | Sin YATS (lee archivos) | Con YATS (MCP stdio) | Ahorro |
|---------|------------------------|----------------------|--------|
| Input tokens | 100,363 | 26,924 | **↓ 73%** |
| Output tokens | 268 | 99 | ↓ 63% |
| Operaciones | 5 bash commands (3 fallidos) | 1 MCP tool call | ↓ 80% |
| Respuesta | ✅ `func NewParserWorker(bus eventbus.Bus, profiles *template.Loader) *ParserWorker` | ✅ Misma respuesta | — |

---

## Sin YATS — qué hizo Codex

```
[rg --json NewParserWorker ...] → FAIL (flags inválidos)
[rg --json NewParserWorker ...] → FAIL (flags inválidos)  
[rg NewParserWorker ...]        → OK (encuentra el símbolo)
[rg -w 'func NewParserWorker']  → OK (extrae la firma)
[head -40 workers.go]           → OK (lee el archivo)
```

5 comandos bash, 3 fallidos, 100k tokens. Codex usó ripgrep (rg) para buscar el símbolo y `head` para leer el archivo.

---

## Con YATS — qué hizo Codex

```
[MCP] find_symbol("NewParserWorker", repository="lab_hub", exact=true)
  → { id: "lab_hub::...workers.go::NewParserWorker", line: 31, kind: "function", language: "go" }
```

1 llamada MCP, 27k tokens. YATS devolvió ubicación exacta en milisegundos.

---

## Configuración ganadora

### `.codex/config.toml`
```toml
model = "gpt-4.1-mini"
sandbox_mode = "danger-full-access"
approval_policy = "never"

[features]
multi_agent = false              # ← CLAVE: evita subagentes sin MCP

[mcp_servers.yats]
command = "node"
args = ["/path/to/mcp-bridge-stdio.cjs", "--stdio"]
```

### `AGENTS.md` (repo root)
```markdown
# YATS Code Intelligence
You have YATS MCP tools: search_code, find_symbol, find_callers, find_callees, expand_graph.
Use YATS tools DIRECTLY. Do NOT spawn subagents.
Max 3 YATS calls. Repository: "lab_hub".
```

---

## Arquitectura

```
Codex CLI
  ├── MCP stdio → mcp-bridge-stdio.cjs → YATS MCP (localhost:5555)
  │                                       ├── Neo4j (knowledge graph)
  │                                       └── Qdrant (vectors)
  └── LLM → DeepSeek API (deepseek-chat)
```

### Bridge stdio
Script Node.js zero-deps que wrappea YATS MCP como servidor stdio:
- `initialize` → protocolo 2025-03-26
- `tools/list` → 20 tools (search_code, find_symbol, expand_graph, find_callers, etc.)
- `tools/call` → forward a YATS HTTP

---

## Lo que NO funcionó

| Intento | Problema |
|---------|----------|
| MCP SSE nativo | Bug rmcp: `RunningService dropped` a los 5s |
| Bridge HTTP + api_base | Codex ignora `api_base` en config.toml |
| Sin `multi_agent = false` | Codex delega a subagentes que no heredan MCP |
| Aider | Diseñado para editar código, no Q&A; system prompt conflictúa |

---

## Cómo reproducir

```bash
# 1. YATS MCP server corriendo en localhost:5555
# 2. Configurar .codex/config.toml como arriba
# 3. AGENTS.md en repo root
# 4. Ejecutar:
codex exec --json "tu pregunta sobre el código"

# El bridge stdio se inicia automáticamente como subproceso de Codex
```
