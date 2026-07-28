#!/usr/bin/env bash
# YATS Benchmark — full comparison
# Usage: bash bench-compare.sh <question_file>
# Requires: ANTHROPIC_API_KEY exported, YATS MCP running

set -e
QUESTION_FILE="$1"
BENCH_DIR="$(cd "$(dirname "$0")" && pwd)"
MODEL="${YATS_BENCH_MODEL:-haiku}"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║         YATS BENCHMARK                       ║"
echo "╠══════════════════════════════════════════════╣"
echo "║  Question: $(basename "$QUESTION_FILE" .md)  "
echo "║  Model:    $MODEL"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Baseline (sin YATS) ──
echo "▶ Running BASELINE (sin YATS)..."
bash "$BENCH_DIR/bench-run.sh" "$QUESTION_FILE"
BASELINE_OUT=$(ls -t "$BENCH_DIR/results/"*_baseline_*.jsonl 2>/dev/null | head -1)

# ── YATS ──
echo ""
echo "▶ Running YATS (con YATS)..."
bash "$BENCH_DIR/bench-run.sh" "$QUESTION_FILE" --with-yats
YATS_OUT=$(ls -t "$BENCH_DIR/results/"*_yats_*.jsonl 2>/dev/null | head -1)

# ── Compare ──
echo ""
python3 "$BENCH_DIR/scripts/compare.py" \
  "${BASELINE_OUT%.jsonl}.summary.json" \
  "${YATS_OUT%.jsonl}.summary.json"
