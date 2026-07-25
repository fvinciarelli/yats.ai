# YATS Benchmark

Mide cuántos tokens ahorra YATS vs leer archivos directamente.

## Ejecutar

```bash
./.plans/benchmark/run.sh
```

Genera `results.json` con tokens, latencia y ahorro por escenario.

## Resultado actual (FastAPI, 6,129 símbolos)

| # | Pregunta | Tokens sin YATS | Tokens con YATS | Ahorro |
|---|----------|----------------|-----------------|--------|
| 1 | ¿Cómo maneja FastAPI la inyección de dependencias? | 18,788 | 848 | 95% |
| 2 | ¿Qué funciones llaman a `solve_dependencies`? | 15,000 | 488 | 96% |
| 3 | Listame todos los endpoints HTTP | 25,000 | 11,606 | 53% |
| 4 | ¿Cómo funciona OAuth2? | 9,696 | 823 | 91% |
| 5 | ¿Qué tests cubren el router de WebSocket? | 6,912 | 19 | 99% |
|   | **TOTAL** | **75,396** | **13,784** | **86%** |

Latencia promedio MCP: **398ms**.

## Probar con agentes

### Paso 1: Configurar el agente

Copiá el archivo de `configs/` que corresponda:

| Agente | Archivo | Destino |
|--------|---------|---------|
| Continue | `configs/continue-config.json` | `~/.continue/config.json` |
| Cursor | `configs/cursor-mcp.json` | `~/.cursor/mcp.json` |
| Codex | `configs/codex-mcp.json` | `.mcp.json` (raíz del proyecto) |
| Copilot | `configs/copilot-mcp.json` | `.vscode/mcp.json` (raíz del proyecto) |
| Claude Desktop | `configs/claude-desktop-config.json` | `~/.claude/claude_desktop_config.json` |
| Claude CLI | `configs/claude-cli-config.sh` | Ejecutar `claude mcp add --transport sse yats http://localhost:5555/mcp/sse` |
| Aider | `configs/aider-context.sh` | Ejecutar antes de iniciar Aider |

### Paso 2: Hacer las preguntas

Copiá cada prompt de `prompts/` y pegala en el agente. Hacé cada pregunta **dos veces**:

1. **Sin YATS** (desactivá el MCP server del agente)
2. **Con YATS** (activá el MCP server)

Anotá:
- ¿Respondió correctamente? (✅/⚠️/❌)
- ¿Cuánto tardó?
- ¿Cuántos archivos leyó? (sin YATS) / ¿Usó las tools? (con YATS)

### Paso 3: Completar resultados

Agregá tus observaciones a `results.json` en el campo `agent_results` de cada escenario.
