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
usa YATS / empieza por `search_code` / pasa `path=` / presupuesto ≤4 llamadas /
fallbacks a shell-web / tokens / ahorro % / respuesta correcta.

## Agentes soportados

| Agente | Modelo en el lab | Estado |
|---|---|---|
| claude | DeepSeek (BYOK vía ANTHROPIC_BASE_URL) | ✅ verde |
| codex | DeepSeek (provider custom) | ✅ verde |
| copilot | DeepSeek (BYOK, sin cuenta GitHub) | ✅ verde |
| pi (pi.dev) | DeepSeek (models.json custom provider) | ✅ verde |
| gemini | gemini-flash-latest (key propia) | ⏳ falta GEMINI_API_KEY en .env |
| cursor | modelo de cuenta (subscription pool) | ⏳ falta CURSOR_API_KEY en .env |

**pi.dev** no se instala en la imagen: se monta read-only el bundle npm del host
(`PI_AGENT_DIR`, por defecto el install de pi-node). Cero crecimiento de imagen.

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

## Catálogo de versiones (agente+versión → prompt/config)

`connect/catalog.json` (en `packages/yats-toolkit/connect/`) registra, por agente,
rangos de versión → templates que mejor rindieron, con la evidencia medida
(fecha, versión exacta, modelo, matriz, resultado). `yats connect` detecta la
versión del CLI instalado, matchea el rango y aplica esos templates; si no hay
match o no detecta, usa los defaults. Ej: codex < 0.172 usa
`[features].multi_agent`; 0.172+ usa `[agents].enabled = false`.

## Proceso: salió una versión nueva de un agente

1. **Actualizar el lab** — `./test-connect/build-image.sh` trae los CLIs más nuevos
   (pi se monta del host: `npm update -g` ahí si aplica).
2. **Ver la versión nueva** dentro del container:
   `docker run --rm -u 1000:1000 yats-agent-lab:latest <cli> --version`
3. **Correr la celda con multi-run** (y el baseline si pudo cambiar):
   ```bash
   YATS_TEST_RUNS=2 ./test-connect/bin/run-agent.sh <agent> test-connect/questions/abs/01-cli-commands.md --with-yats
   YATS_TEST_RUNS=2 ./test-connect/bin/run-agent.sh <agent> test-connect/questions/abs/01-cli-commands.md --without-yats
   ```
4. **Scorear** con `python3 test-connect/bin/score.py <expects> <transcripts...>`.
5. **Registrar el resultado en `connect/catalog.json`**:
   - Todo verde → actualizar la entrada existente (`agentVersion`, `date`,
     `result`) o, si esa versión cambió de comportamiento, agregar una entrada
     nueva con su rango `since`/`until` y los `files` overrides necesarios.
   - Algo falla → iterar el prompt/config de esa entrada (o crear variantes
     nuevas) hasta verde ANTES de registrar.
6. **Re-empaquetar y verificar**: `./test-connect/build-image.sh` y confirmar que
   `yats connect --install <agent>` muestra el “Known-good” correcto para esa
   versión.
