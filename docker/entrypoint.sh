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

# Wait for Ollama (only when provider is ollama).
#
# OLLAMA_URL is the canonical variable written by `yats setup` and the compose
# files (host, custom and bundled modes). OLLAMA_HOST is kept for backwards
# compatibility with hand-written compose files. Reading only OLLAMA_HOST made
# host-mode installs wait forever: there is no `ollama` service, so the default
# hostname never resolves. The wait is bounded so a missing/loopback-only
# Ollama degrades the embeddings instead of hanging the whole server.
if [ "${EMBEDDING_PROVIDER}" = "ollama" ]; then
  OLLAMA_BASE="${OLLAMA_URL:-http://${OLLAMA_HOST:-ollama}:11434}"
  OLLAMA_BASE="${OLLAMA_BASE%/}"
  ATTEMPTS="${OLLAMA_WAIT_ATTEMPTS:-30}"
  echo "  Waiting for Ollama at ${OLLAMA_BASE}..."
  i=0
  until curl -s "${OLLAMA_BASE}/api/tags" > /dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -ge "$ATTEMPTS" ]; then
      echo "  ⚠  Ollama not reachable at ${OLLAMA_BASE} after $((ATTEMPTS * 2))s."
      echo "     If Ollama runs on the host, it must listen on 0.0.0.0"
      echo "     (set OLLAMA_HOST=0.0.0.0 there and restart it) and the firewall"
      echo "     must allow port 11434. Starting anyway — graph queries work,"
      echo "     indexing needs embeddings and will fail until this is fixed."
      break
    fi
    sleep 2
  done
  if [ "$i" -lt "$ATTEMPTS" ]; then
    echo "  ✓ Ollama ready"
  fi
fi

echo ""
echo "  Starting YATS MCP server..."
echo "  Transport: HTTP+SSE on port ${YATS_PORT:-5555}"
echo "  Embedding provider: ${EMBEDDING_PROVIDER:-ollama}"
echo ""

# Start the MCP server in HTTP mode
exec node packages/dev-cli/dist/index.js start --http --port "${YATS_PORT:-5555}"
