# test-connect — suite de verificación de `yats connect` por agente

Prueba que lo que `yats connect --install <agent>` deja en un repo **funciona de
verdad**: el agente carga la config, usa las tools de YATS y ahorra tokens.
Todo corre en Docker; el host no se toca (ni CLIs instalados, ni credenciales
modificadas — las copias viven en `homes/`, gitignored).

## Flujo

```
fixture indexado → reset fixture → connect --install <agent> → correr agente headless
                 → transcript en results/ → score.py → scorecard ✅/❌
```

## Setup (una vez)

```bash
./test-connect/build-image.sh          # imagen yats-agent-lab (5 agent CLIs + yats de esta rama)
./test-connect/bin/seed-auth.sh        # copia credenciales del host a homes/ (host intacto)
./test-connect/bin/prepare-fixture.sh  # copia ~/cosas/abs → fixture/abs-bench y lo indexa
```

## Correr una prueba

```bash
./test-connect/bin/run-agent.sh codex test-connect/questions/abs/01-cli-commands.md --with-yats
./test-connect/bin/run-agent.sh codex test-connect/questions/abs/01-cli-commands.md --without-yats
python3 test-connect/bin/score.py \
  test-connect/questions/abs/01-cli-commands.expects \
  test-connect/results/codex/01-cli-commands__with-yats.jsonl \
  test-connect/results/codex/01-cli-commands__without-yats.jsonl
```

El runner resetea el fixture y reinstala la config de connect en cada corrida
(`with-yats`) o la deja limpia (`without-yats`). El scorecard evalúa:
usa YATS / empieza por `search_code` / pasa `path=` / presupuesto 3-5 llamadas /
fallbacks a shell-web / tokens / ahorro % / respuesta correcta.

## Modelo independiente: DeepSeek BYOK

Un solo key de DeepSeek corre claude, codex y copilot con **el mismo modelo**,
aislando el comportamiento del agente (no del LLM). Sin necesidad de cuentas de
GitHub ni créditos de Anthropic.

```bash
cp test-connect/env.example test-connect/.env   # completar DEEPSEEK_API_KEY
```

- claude  → `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`
- codex   → provider `deepseek` en `~/.codex/config.toml` (solo en el home aislado)
- copilot → `COPILOT_PROVIDER_*` BYOK + `COPILOT_OFFLINE=true` (sin cuenta GitHub)

gemini y cursor siguen atados a sus modelos (requieren auth propia:
`gemini` (Google AI Studio, key gratis) y `agent login` (cuenta cursor.com)).

## Variantes por versión de agente

`connect` detecta la versión del CLI instalado y elige templates específicos
(variants.json por agente). Ej: codex < 0.172 usa `[features].multi_agent`;
0.172+ usa `[agents].enabled = false`. A medida que descubrimos diferencias
entre versiones, se agregan rangos al manifest sin romper lo existente.
