# Benchmark Automatizado con code-server + Playwright MCP

## Objetivo

Automatizar el benchmark de YATS midiendo tokens reales consumidos por agentes AI
(Continue, Cursor, Claude) al responder preguntas sobre FastAPI con/sin YATS MCP.

Actualmente el benchmark depende de testing manual. Con esto sería 100% reproducible.

## Arquitectura

```
┌──────────────────────────────────────────────────┐
│ docker-compose (3 servicios)                     │
│                                                  │
│  ┌──────────┐  ┌────────────┐  ┌─────────────┐  │
│  │ YATS     │  │ code-server │  │ Playwright  │  │
│  │ :5555    │  │ :8080       │  │ MCP :3000   │  │
│  │ (MCP)    │  │ (VS Code    │  │ (browser    │  │
│  │          │  │  +Continue) │  │  control)   │  │
│  └──────────┘  └────────────┘  └─────────────┘  │
│       │              │               │           │
│       └──────────────┴───────────────┘           │
│               orchestrador (run-benchmark.js)     │
└──────────────────────────────────────────────────┘
```

## Componentes

### 1. code-server (coder/code-server)
- VS Code corriendo en browser headless
- Se instala Continue extension vía `--install-extension`
- Se configura MCP apuntando a YATS

### 2. Playwright MCP (@playwright/mcp)
- Controla el navegador chromium
- Escribe prompts en el chat de Continue
- Espera respuestas
- Captura tokens del panel de Continue (o estima por longitud)

### 3. Orquestrador
- Script Node.js que:
  1. Levanta los servicios
  2. Para cada escenario (5 prompts):
     - Ejecuta con MCP activo → mide tokens
     - Ejecuta sin MCP → mide tokens
  3. Genera results.json
  4. Apaga servicios

## Tareas

- [ ] Investigar si Continue expone uso de tokens en UI/API
- [ ] Crear docker-compose con code-server + playwright
- [ ] Script de install de Continue + config MCP
- [ ] Script de automatización Playwright (escribir prompt, esperar, capturar)
- [ ] Integrar con el harness actual (.plans/benchmark/run.sh)
- [ ] CI-friendly (todo headless, sin GPU)

## Alternativa más simple

Usar **Anthropic API directamente** con tool use (simulando el agente):
- Mediría tokens reales del modelo
- No mediría overhead de Continue/Cursor UI
- Más fácil pero menos realista

## Referencias

- code-server: https://github.com/coder/code-server
- Playwright MCP: https://github.com/microsoft/playwright-mcp
- Continue extension: https://github.com/continuedev/continue
