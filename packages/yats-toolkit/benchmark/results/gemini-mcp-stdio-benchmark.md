# Benchmark YATS — Gemini CLI + MCP stdio

**Fecha:** 2026-07-29
**Gemini CLI:** 0.53.0
**Modelo:** gemini-flash-latest (gemini-3.6-flash)
**Pregunta:** "Find NewParserWorker in workers.go. Show exact function signature."

---

## Estado

⚠️ Prueba funcional completada — benchmark de tokens pendiente (API quota agotada).

## Lo que funciona

- **16 YATS tools** descubiertas y conectadas vía MCP stdio
- **3 tool calls** ejecutadas: `list_repositories`, `find_symbol`, `search_code`
- Bridge inyecta `repository` automáticamente cuando Gemini no lo manda
- Geminile lee `GEMINI.md` correctamente y menciona las tools YATS

## Lo que falló

- API de Gemini (free tier) colapsó después de múltiples pruebas (límite 20 RPM)
- Gemini CLI crashea con "unexpected critical error" cuando la API rechaza
- El bridge y MCP funcionan — el crash es en la capa de API de Google

## Configuración ganadora

### `.gemini/settings.json`
```json
{
  "mcpServers": {
    "yats": {
      "command": "node",
      "args": ["/path/to/mcp-bridge-stdio.cjs", "--stdio"],
      "trust": true
    }
  }
}
```

### `GEMINI.md` (repo root)
Instrucciones YATS estándar (ver `docs/agents_instructions/gemini/GEMINI.md`).

### Comando
```bash
export GEMINI_API_KEY="..."
export GEMINI_CLI_TRUST_WORKSPACE=true
gemini -p "pregunta" --model gemini-flash-latest
```

## Errores comunes
- Sin `GEMINI_CLI_TRUST_WORKSPACE=true` → MCP servers disabled
- Sin `trust: true` en config → tools requieren confirmación
- `gemini-2.5-flash` → 503 (sobrecargado), usar `gemini-flash-latest`
