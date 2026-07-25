# 🧪 YATS Benchmark Plan — FastAPI

## Objetivo

Medir **ahorro de tokens**, **calidad de respuestas** y **latencia** con/sin YATS,
usando FastAPI (`../fastapi/`) como repo de prueba.

---

## Configuraciones MCP por Agente

### 1. Continue (VS Code)

Archivo: `~/.continue/config.json`

```json
{
  "experimental": {
    "mcpServers": {
      "yats": {
        "url": "http://localhost:5555/mcp/sse"
      }
    }
  }
}
```

> Nota: Requiere Continue ≥ v1.0.0 con soporte MCP experimental.

---

### 2. Cursor / Cline / Roo Code (VS Code)

Archivo: `~/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "yats": {
      "url": "http://localhost:5555/mcp/sse"
    }
  }
}
```

> Cursor 0.45+ soporta MCP nativo. Alternativa: VS Code settings `"mcp.servers"`.

---

### 3. Claude Desktop

Archivo: `~/.claude/claude_desktop_config.json` (macOS) o `%APPDATA%/Claude/claude_desktop_config.json` (Windows)

Claude Desktop solo soporta **stdio MCP**. Se necesita el bridge:

```bash
# Primero asegurate que YATS está corriendo (docker compose up -d)
node packages/setup/bin/setup.js bridge
```

```json
{
  "mcpServers": {
    "yats": {
      "command": "npx",
      "args": ["yats-bridge"]
    }
  }
}
```

> Alternativa manual (sin npx): usar `node /ruta/a/yats/packages/setup/src/bridge.js`

---

### 4. Aider

Aider **no soporta MCP nativamente**. Workaround:

**Opción A — via `/run` command:**
```
/run curl -s http://localhost:5555/mcp -H "Content-Type: application/json" -d '...'
```

**Opción B — via archivo de contexto:**
```bash
# Indexar el repo primero, luego pasar el summary como contexto
curl -s -X POST http://localhost:5555/mcp \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"architecture_summary","arguments":{"repository":"fastapi"}}}' \
  | jq -r '.result.content[0].text' > fastapi_context.txt

aider --read fastapi_context.txt
```

---

## Escenarios de Prueba

Cada escenario se prueba **sin YATS** (solo lectura de archivos) y **con YATS** (usando MCP tools).

### Escenario 1: "¿Cómo maneja FastAPI la inyección de dependencias?"

| | Sin YATS | Con YATS |
|---|---|---|
| Método | Leer `dependencies/utils.py`, `params.py` | `search_code`, `find_callers` |
| Archivos leídos | ~5 archivos | 0 archivos |
| Tokens aprox | ~18,000 | ~800 |
| Tiempo aprox | 15-30s (lectura + análisis LLM) | 2-3s |
| Calidad esperada | Alta (lee el source) | Alta (respuestas graph-precisas) |

### Escenario 2: "¿Quién llama a `solve_dependencies`?"

| | Sin YATS | Con YATS |
|---|---|---|
| Método | `grep -r solve_dependencies fastapi/` | `find_callers("solve_dependencies")` |
| Archivos leídos | 0 (grep) | 0 |
| Tokens aprox | ~200 (resultados grep) | ~300 |
| Calidad esperada | Baja (grep no distingue defs de calls) | Alta (solo calls reales) |

### Escenario 3: "Listame todos los endpoints HTTP de FastAPI"

| | Sin YATS | Con YATS |
|---|---|---|
| Método | `grep -rn "@app\.\|@router\." fastapi/` | `find_routes` |
| Archivos leídos | ~50 archivos de resultados grep | 0 |
| Tokens aprox | ~25,000 | ~1,000 |
| Calidad esperada | Media (grep captura comentarios, strings) | Alta (100 rutas clasificadas) |

### Escenario 4: "¿Cómo se relacionan las clases OAuth2?"

| | Sin YATS | Con YATS |
|---|---|---|
| Método | Leer `security/oauth2.py`, `openapi/models.py` | `search_code` + `expand_graph` |
| Archivos leídos | ~3 archivos | 0 archivos |
| Tokens aprox | ~12,000 | ~1,500 |
| Calidad esperada | Alta | Alta + grafo de relaciones |

### Escenario 5: "¿Qué tests cubren el router de WebSocket?"

| | Sin YATS | Con YATS |
|---|---|---|
| Método | Leer `tests/test_ws_router.py` + buscar imports | `find_tests` + `find_callers` |
| Archivos leídos | ~5 archivos | 0 archivos |
| Tokens aprox | ~20,000 | ~600 |
| Calidad esperada | Media | Alta (tests linkeados por CALLS) |

---

## Métricas a medir

| Métrica | Cómo medir |
|---------|-----------|
| **Tokens sin YATS** | Contar líneas leídas ÷ 3.5 (estimado) o usar tokenizer |
| **Tokens con YATS** | Sumar tokens de MCP responses |
| **Ahorro** | (sin - con) / sin × 100 |
| **Latencia sin YATS** | Tiempo del agente en leer + procesar |
| **Latencia con YATS** | Tiempo del agente + tiempo MCP (45-600ms) |
| **Precisión** | ¿La respuesta responde correctamente la pregunta? (Sí/No/Parcial) |

---

## Setup para la prueba

```bash
# 1. Asegurar que YATS corre
docker compose -f ~/.yats/docker-compose.yml up -d
curl http://localhost:5555/health

# 2. Verificar que FastAPI está indexado
curl -s -X POST http://localhost:5555/mcp \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_repositories","arguments":{}}}' \
  | jq .

# 3. Si no está indexado:
curl -s -X POST http://localhost:5555/index \
  -d '{"path":"/repos/fastapi/fastapi"}'

# 4. Configurar el agente (ver sección de arriba)
```
