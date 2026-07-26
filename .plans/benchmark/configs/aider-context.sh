# Aider no soporta MCP nativamente.
# Usar este script para generar contexto de FastAPI via YATS y pasarlo a Aider.

#!/bin/bash
# Generar contexto de FastAPI para Aider via YATS MCP

YATS_URL="http://localhost:5555/mcp"
REPO="fastapi"

echo "=== FastAPI Architecture Summary ==="
curl -s -X POST "$YATS_URL" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"architecture_summary\",\"arguments\":{\"repository\":\"$REPO\"}}}" \
  | jq -r '.result.content[0].text'

echo ""
echo "=== Top Routes ==="
curl -s -X POST "$YATS_URL" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"find_routes\",\"arguments\":{\"repository\":\"$REPO\",\"limit\":20}}}" \
  | jq -r '.result.content[0].text'

echo ""
echo "=== Key Symbols ==="
curl -s -X POST "$YATS_URL" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"repository_summary\",\"arguments\":{\"repository\":\"$REPO\"}}}" \
  | jq -r '.result.content[0].text'
