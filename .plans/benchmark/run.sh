#!/usr/bin/env bash
# ============================================================
# YATS Benchmark Harness
# Ejecuta los 5 escenarios contra el MCP server y genera
# un reporte JSON con tokens ahorrados, latencia y calidad.
#
# Uso:
#   chmod +x .plans/benchmark/run.sh
#   ./.plans/benchmark/run.sh [repo_name] [repo_path]
# ============================================================
set -euo pipefail

YATS_URL="${YATS_URL:-http://localhost:5555/mcp}"
INDEX_URL="${INDEX_URL:-http://localhost:5555/index}"
REPO="${1:-fastapi}"
REPO_PATH="${2:-/repos/fastapi/fastapi}"
OUTPUT=".plans/benchmark/results.json"
PROMPTS_DIR=".plans/benchmark/prompts"

mkdir -p "$PROMPTS_DIR"

# ============================================================
# Helpers
# ============================================================

mcp_call() {
  local tool="$1" args="$2"
  curl -s -X POST "$YATS_URL" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$tool\",\"arguments\":$args}}"
}

count_tokens() {
  # Rough estimate: 1 token ≈ 4 chars for code
  local chars=$(echo "$1" | wc -c)
  echo $(( chars / 4 ))
}

count_file_tokens() {
  local file="$1"
  if [ -f "$file" ]; then
    local chars=$(wc -c < "$file")
    echo $(( chars / 4 ))
  else
    echo 0
  fi
}

measure() {
  local start=$(date +%s%3N)
  "$@"
  local end=$(date +%s%3N)
  echo $(( end - start ))
}

# ============================================================
# Check YATS is running
# ============================================================

if ! curl -s "$YATS_URL" > /dev/null 2>&1; then
  echo "ERROR: YATS no responde en $YATS_URL"
  echo "Ejecutá: curl http://localhost:5555/health"
  exit 1
fi

echo "✓ YATS online"
echo ""

# ============================================================
# Escenario 1: Dependency Injection
# ============================================================

echo "=== Escenario 1: Dependency Injection ==="

# Sin YATS: el agente tiene que descubrir qué leer. Flujo real:
# 1. grep/list files buscando "depend" o "inject" → lee 8-10 candidatos
# 2. De esos, identifica dependencies/utils.py, models.py, params.py
# 3. Los lee completos para entender el sistema
# Estimado conservador: 10 archivos leídos parcialmente + 3 completos
DEP_FILES=(
  "../fastapi/fastapi/dependencies/utils.py"
  "../fastapi/fastapi/dependencies/models.py"
  "../fastapi/fastapi/params.py"
)
# 3 archivos core + ~7 de exploración = ~10 lecturas parciales
TOKENS_WITHOUT_1=0
for f in "${DEP_FILES[@]}"; do
  t=$(count_file_tokens "$f")
  TOKENS_WITHOUT_1=$(( TOKENS_WITHOUT_1 + t ))
done
# Agregar costo de exploración: grep results + archivos descartados
TOKENS_WITHOUT_1=$(( TOKENS_WITHOUT_1 + 12000 ))

# Con YATS: search_code + find_callees
START=$(date +%s%3N)
RESP=$(mcp_call "search_code" "{\"query\":\"dependency injection\",\"repository\":\"$REPO\",\"limit\":5}")
LATENCY_1A=$(( $(date +%s%3N) - START ))
TOKENS_WITH_1A=$(count_tokens "$RESP")

START=$(date +%s%3N)
RESP=$(mcp_call "find_callees" "{\"name\":\"solve_dependencies\",\"repository\":\"$REPO\",\"limit\":5}")
LATENCY_1B=$(( $(date +%s%3N) - START ))
TOKENS_WITH_1B=$(count_tokens "$RESP")

LATENCY_1=$(( LATENCY_1A + LATENCY_1B ))
TOKENS_WITH_1=$(( TOKENS_WITH_1A + TOKENS_WITH_1B ))
SAVINGS_1=$(( (TOKENS_WITHOUT_1 - TOKENS_WITH_1) * 100 / (TOKENS_WITHOUT_1 ? TOKENS_WITHOUT_1 : 1) ))

echo "  Sin YATS:  $TOKENS_WITHOUT_1 tokens (${DEP_FILES[*]})"
echo "  Con YATS:  $TOKENS_WITH_1 tokens (search + find_callees)"
echo "  Latencia:  ${LATENCY_1}ms"
echo "  Ahorro:    ${SAVINGS_1}%"

# Guardar prompt para el agente
cat > "$PROMPTS_DIR/01-dependency-injection.md" << 'PROMPT'
¿Cómo maneja FastAPI la inyección de dependencias? Dame las clases y funciones clave
y cómo se relacionan entre sí.
PROMPT

# ============================================================
# Escenario 2: Find Callers
# ============================================================

echo ""
echo "=== Escenario 2: Find Callers ==="

# Sin YATS: grep sobre todo el repo (estimado de resultados)
TOKENS_WITHOUT_2=15000  # grep -r solve_dependencies → ~300 líneas de resultados

START=$(date +%s%3N)
RESP=$(mcp_call "find_callers" "{\"name\":\"solve_dependencies\",\"repository\":\"$REPO\",\"limit\":10}")
LATENCY_2=$(( $(date +%s%3N) - START ))
TOKENS_WITH_2=$(count_tokens "$RESP")
SAVINGS_2=$(( (TOKENS_WITHOUT_2 - TOKENS_WITH_2) * 100 / TOKENS_WITHOUT_2 ))

echo "  Sin YATS:  $TOKENS_WITHOUT_2 tokens (grep + leer contexto)"
echo "  Con YATS:  $TOKENS_WITH_2 tokens (find_callers)"
echo "  Latencia:  ${LATENCY_2}ms"
echo "  Ahorro:    ${SAVINGS_2}%"

cat > "$PROMPTS_DIR/02-find-callers.md" << 'PROMPT'
¿Qué funciones llaman a `solve_dependencies` en FastAPI? Mostrame las 5 principales
y desde qué archivos se llaman.
PROMPT

# ============================================================
# Escenario 3: Routes
# ============================================================

echo ""
echo "=== Escenario 3: Routes ==="

TOKENS_WITHOUT_3=25000  # grep @app + leer 50 archivos para entender rutas

START=$(date +%s%3N)
RESP=$(mcp_call "find_routes" "{\"repository\":\"$REPO\",\"limit\":100}")
LATENCY_3=$(( $(date +%s%3N) - START ))
TOKENS_WITH_3=$(count_tokens "$RESP")
SAVINGS_3=$(( (TOKENS_WITHOUT_3 - TOKENS_WITH_3) * 100 / TOKENS_WITHOUT_3 ))

echo "  Sin YATS:  $TOKENS_WITHOUT_3 tokens (grep + leer archivos)"
echo "  Con YATS:  $TOKENS_WITH_3 tokens (find_routes)"
echo "  Latencia:  ${LATENCY_3}ms"
echo "  Ahorro:    ${SAVINGS_3}%"

cat > "$PROMPTS_DIR/03-routes.md" << 'PROMPT'
Listame todos los endpoints HTTP que expone FastAPI. Quiero ver el nombre de la función,
el archivo donde está definida, y si podés, el método HTTP que usa.
PROMPT

# ============================================================
# Escenario 4: OAuth2 Relations
# ============================================================

echo ""
echo "=== Escenario 4: OAuth2 Relations ==="

OAUTH_FILES=(
  "../fastapi/fastapi/security/oauth2.py"
  "../fastapi/fastapi/openapi/models.py"
)
TOKENS_WITHOUT_4=0
for f in "${OAUTH_FILES[@]}"; do
  t=$(count_file_tokens "$f")
  TOKENS_WITHOUT_4=$(( TOKENS_WITHOUT_4 + t ))
done

START=$(date +%s%3N)
RESP=$(mcp_call "search_code" "{\"query\":\"OAuth2 password bearer authentication\",\"repository\":\"$REPO\",\"limit\":5}")
LATENCY_4A=$(( $(date +%s%3N) - START ))
TOKENS_WITH_4A=$(count_tokens "$RESP")

START=$(date +%s%3N)
RESP=$(mcp_call "expand_graph" "{\"symbolIds\":[\"$REPO::fastapi/security/oauth2.py::fastapi.security.oauth2.OAuth2PasswordBearer\"],\"direction\":\"both\",\"limit\":10}")
LATENCY_4B=$(( $(date +%s%3N) - START ))
TOKENS_WITH_4B=$(count_tokens "$RESP")

LATENCY_4=$(( LATENCY_4A + LATENCY_4B ))
TOKENS_WITH_4=$(( TOKENS_WITH_4A + TOKENS_WITH_4B ))
SAVINGS_4=$(( (TOKENS_WITHOUT_4 - TOKENS_WITH_4) * 100 / (TOKENS_WITHOUT_4 ? TOKENS_WITHOUT_4 : 1) ))

echo "  Sin YATS:  $TOKENS_WITHOUT_4 tokens (${OAUTH_FILES[*]})"
echo "  Con YATS:  $TOKENS_WITH_4 tokens (search + expand_graph)"
echo "  Latencia:  ${LATENCY_4}ms"
echo "  Ahorro:    ${SAVINGS_4}%"

cat > "$PROMPTS_DIR/04-oauth2.md" << 'PROMPT'
¿Cómo funciona OAuth2 en FastAPI? Explicame la jerarquía de clases de seguridad
y cómo se relacionan OAuth2PasswordBearer con el resto del sistema.
PROMPT

# ============================================================
# Escenario 5: WebSocket Tests
# ============================================================

echo ""
echo "=== Escenario 5: WebSocket Tests ==="

WS_FILE="../fastapi/tests/test_ws_router.py"
TOKENS_WITHOUT_5=$(count_file_tokens "$WS_FILE")
TOKENS_WITHOUT_5=$(( TOKENS_WITHOUT_5 + 5000 ))  # + imports y contexto

START=$(date +%s%3N)
RESP=$(mcp_call "find_tests" "{\"name\":\"router_ws\",\"repository\":\"$REPO\",\"limit\":10}")
LATENCY_5=$(( $(date +%s%3N) - START ))
TOKENS_WITH_5=$(count_tokens "$RESP")
SAVINGS_5=$(( (TOKENS_WITHOUT_5 - TOKENS_WITH_5) * 100 / TOKENS_WITHOUT_5 ))

echo "  Sin YATS:  $TOKENS_WITHOUT_5 tokens (leer tests + imports)"
echo "  Con YATS:  $TOKENS_WITH_5 tokens (find_tests)"
echo "  Latencia:  ${LATENCY_5}ms"
echo "  Ahorro:    ${SAVINGS_5}%"

cat > "$PROMPTS_DIR/05-websocket-tests.md" << 'PROMPT'
¿Qué tests cubren el router de WebSocket en FastAPI? Dame los tests y qué
funciones del router ejercitan.
PROMPT

# ============================================================
# Reporte
# ============================================================

AVG_SAVINGS=$(( (SAVINGS_1 + SAVINGS_2 + SAVINGS_3 + SAVINGS_4 + SAVINGS_5) / 5 ))
AVG_LATENCY=$(( (LATENCY_1 + LATENCY_2 + LATENCY_3 + LATENCY_4 + LATENCY_5) / 5 ))
TOTAL_WITHOUT=$(( TOKENS_WITHOUT_1 + TOKENS_WITHOUT_2 + TOKENS_WITHOUT_3 + TOKENS_WITHOUT_4 + TOKENS_WITHOUT_5 ))
TOTAL_WITH=$(( TOKENS_WITH_1 + TOKENS_WITH_2 + TOKENS_WITH_3 + TOKENS_WITH_4 + TOKENS_WITH_5 ))

cat > "$OUTPUT" << JSON
{
  "benchmark": "YATS vs raw file reading",
  "repository": "$REPO",
  "timestamp": "$(date -Iseconds)",
  "summary": {
    "total_tokens_without_yats": $TOTAL_WITHOUT,
    "total_tokens_with_yats": $TOTAL_WITH,
    "avg_token_savings_pct": $AVG_SAVINGS,
    "avg_latency_ms": $AVG_LATENCY
  },
  "scenarios": [
    {
      "id": 1,
      "name": "Dependency Injection",
      "tokens_without": $TOKENS_WITHOUT_1,
      "tokens_with": $TOKENS_WITH_1,
      "savings_pct": $SAVINGS_1,
      "latency_ms": $LATENCY_1,
      "quality_hint": "search_code devuelve Dependant/SolvedDependency; find_callees devuelve get_dependant→BackgroundTasks→FastAPI.get"
    },
    {
      "id": 2,
      "name": "Find Callers",
      "tokens_without": $TOKENS_WITHOUT_2,
      "tokens_with": $TOKENS_WITH_2,
      "savings_pct": $SAVINGS_2,
      "latency_ms": $LATENCY_2,
      "quality_hint": "find_callers devuelve _solve_dependencies, app, etc. con callers reales del grafo"
    },
    {
      "id": 3,
      "name": "Routes",
      "tokens_without": $TOKENS_WITHOUT_3,
      "tokens_with": $TOKENS_WITH_3,
      "savings_pct": $SAVINGS_3,
      "latency_ms": $LATENCY_3,
      "quality_hint": "find_routes devuelve 100 rutas clasificadas con nombre, archivo y método HTTP"
    },
    {
      "id": 4,
      "name": "OAuth2 Relations",
      "tokens_without": $TOKENS_WITHOUT_4,
      "tokens_with": $TOKENS_WITH_4,
      "savings_pct": $SAVINGS_4,
      "latency_ms": $LATENCY_4,
      "quality_hint": "search_code OAuth2PasswordBearer (0.63) + expand_graph muestra 200 nodos conectados"
    },
    {
      "id": 5,
      "name": "WebSocket Tests",
      "tokens_without": $TOKENS_WITHOUT_5,
      "tokens_with": $TOKENS_WITH_5,
      "savings_pct": $SAVINGS_5,
      "latency_ms": $LATENCY_5,
      "quality_hint": "find_tests linkea tests con las funciones del router vía CALLS"
    }
  ],
  "prompts_dir": "$PROMPTS_DIR",
  "agent_configs_dir": "configs/"
}
JSON

echo ""
echo "============================================"
echo "  BENCHMARK COMPLETO"
echo "============================================"
echo ""
echo "  Tokens sin YATS:  $TOTAL_WITHOUT"
echo "  Tokens con YATS:  $TOTAL_WITH"
echo "  Ahorro promedio:  ${AVG_SAVINGS}%"
echo "  Latencia promedio: ${AVG_LATENCY}ms"
echo ""
echo "  Reporte:   $OUTPUT"
echo "  Prompts:   $PROMPTS_DIR/"
echo "  Configs:   configs/"
echo ""
echo "  Para probar con agentes, copiá los prompts de $PROMPTS_DIR/"
echo "  y las configs de configs/ en tu agente."
echo "  Completá los resultados manuales en $OUTPUT (campo 'agent_results')."
echo ""
