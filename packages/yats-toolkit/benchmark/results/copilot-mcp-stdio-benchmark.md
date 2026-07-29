# Benchmark YATS — Copilot CLI + MCP stdio

**Fecha:** 2026-07-29
**Copilot CLI:** 1.0.75
**Modelo:** Default (GPT-based)
**Pregunta:** "Find NewParserWorker in workers.go. Show exact function signature."

---

## Resultado

| Métrica | Sin YATS | Con YATS | Mejora |
|---------|----------|----------|--------|
| Tokens enviados | 56.6k (20.5k cached) | 60.2k (54.7k cached) | — |
| Tokens recibidos | 1.2k | 597 | — |
| AI Credits | 1.19 | 0.40 | **↓ 66%** |
| Tiempo | 42s | 26s | **↓ 38%** |
| Herramientas | grep → Read | find_symbol (MCP) → Read | 1 MCP call |

---

## Sin YATS — qué hizo Copilot

```
grep "NewParserWorker" → 15 líneas encontradas
Read workers.go → 373 líneas leídas
```
Búsqueda grep por todo el repo + lectura completa del archivo.

## Con YATS — qué hizo Copilot

```
find_symbol (MCP: yats) · name: "NewParserWorker", repository: "lab_hub"
  → [{id: "lab_hub::...workers.go::NewParserWorker", line: 31, kind: "function"}]
Read workers.go → verificación adicional
```
1 MCP call encontró el símbolo en ms. Copilot hizo doble verificación leyendo el archivo.

---

## Nota: Copilot hace doble verificación

A diferencia de Codex que confía en YATS y responde directo, Copilot verifica el resultado MCP leyendo el archivo. Esto reduce la ganancia en tokens pero igual se ve mejora en créditos (66%) y velocidad (38%).

---

## Configuración ganadora

### `~/.copilot/mcp-config.json`
```json
{
  "mcpServers": {
    "yats": {
      "type": "local",
      "command": "node",
      "args": ["/path/to/mcp-bridge-stdio.cjs", "--stdio"]
    }
  }
}
```

### Comando
```bash
copilot -p "pregunta" --allow-all
```

### Errores comunes
- `"servers"` en vez de `"mcpServers"` → MCP no detectado
- Sin `--allow-all` → "Permission denied"
- `--allow-all-mcp-server-instructions` no basta solo
