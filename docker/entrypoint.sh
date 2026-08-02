#!/bin/sh
set -e

echo ""
echo "  ╔══════════════════════════════════╗"
echo "  ║          YATS                    ║"
echo "  ║  Yet Another Token Saver         ║"
echo "  ╚══════════════════════════════════╝"
echo ""

# Wait for Neo4j
echo "  Waiting for Neo4j..."
until curl -s "http://${NEO4J_HOST:-neo4j}:7474" > /dev/null 2>&1; do
  sleep 2
done
echo "  ✓ Neo4j ready"

# Wait for Qdrant
echo "  Waiting for Qdrant..."
until curl -s "http://${QDRANT_HOST:-qdrant}:6333/healthz" > /dev/null 2>&1; do
  sleep 2
done
echo "  ✓ Qdrant ready"

# Wait for Ollama (only when provider is ollama)
if [ "${EMBEDDING_PROVIDER}" = "ollama" ]; then
  echo "  Waiting for Ollama..."
  until curl -s "http://${OLLAMA_HOST:-ollama}:11434/api/tags" > /dev/null 2>&1; do
    sleep 2
  done
  echo "  ✓ Ollama ready"
fi

echo ""
echo "  Starting YATS MCP server..."
echo "  Transport: HTTP+SSE on port ${YATS_PORT:-5555}"
echo "  Embedding provider: ${EMBEDDING_PROVIDER:-ollama}"
echo ""

# Start the MCP server in HTTP mode
exec node packages/dev-cli/dist/index.js start --http --port "${YATS_PORT:-5555}"
