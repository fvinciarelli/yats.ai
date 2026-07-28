#!/usr/bin/env bash
# YATS Benchmark — single run
# Usage: bash bench-run.sh <question_file> [--with-yats]
set -e

QUESTION_FILE="$1"
USE_YATS="$2"
MODEL="${YATS_BENCH_MODEL:-haiku}"
BENCH_DIR="$(cd "$(dirname "$0")" && pwd)"

# Resolve repo from question path (e.g. questions/go/lab_hub/... → lab_hub)
REPO=$(echo "$QUESTION_FILE" | sed 's|.*/\([^/]*\)/[^/]*\.md|\1|')
QUESTION=$(cat "$QUESTION_FILE")
RUN_ID=$(basename "$QUESTION_FILE" .md)-$(date +%H%M%S)

# ── Config ──────────────────────────────────────────────
if [ "$USE_YATS" = "--with-yats" ]; then
  TAG="yats"
  cat > ~/.claude.json << EOF
{"env":{"API_TIMEOUT_MS":"3000000"},"permissions":{"defaultMode":"default"},"projects":{"/home/franco/cosas/$REPO":{"mcpServers":{"yats":{"type":"sse","url":"http://localhost:5555/mcp/sse"}}}}}
EOF
else
  TAG="baseline"
  cat > ~/.claude.json << 'EOF'
{"env":{"API_TIMEOUT_MS":"3000000"},"permissions":{"defaultMode":"default"},"projects":{}}
EOF
fi

OUT="$BENCH_DIR/results/${REPO}_${TAG}_${RUN_ID}.jsonl"

# ── Run ─────────────────────────────────────────────────
cd "/home/franco/cosas/$REPO"

if [ "$USE_YATS" != "--with-yats" ]; then
  rm -rf .claude/skills/yats 2>/dev/null || true
fi

claude -p "$QUESTION" \
  --model "$MODEL" \
  --output-format stream-json \
  --verbose \
  --dangerously-skip-permissions \
  2>/dev/null > "$OUT"

# ── Report ───────────────────────────────────────────────
python3 "$BENCH_DIR/scripts/report.py" "$OUT" "$TAG"
