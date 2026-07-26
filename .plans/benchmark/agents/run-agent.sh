#!/bin/bash
# ============================================================
# YATS Benchmark — Agent integration for token measurement
# ============================================================

agent="$1"
question_file="$2"
mcp_config="$3"

question=$(cat "$question_file")

case "$agent" in
  cursor)
    # Cursor headless CLI with stream-json output
    cursor-agent -p "$question" \
      --output-format stream-json \
      --force \
      --model claude-sonnet-5 2>/dev/null | tee /tmp/yats-bench-cursor.jsonl
    ;;

  claude-cli)
    # Claude CLI
    claude -p "$question" \
      --output-format stream-json \
      --mcp-config "$mcp_config" 2>/dev/null | tee /tmp/yats-bench-claude.jsonl
    ;;

  copilot-cli)
    # GitHub Copilot CLI
    copilot -p "$question" 2>/dev/null
    # Token data available via /usage after
    ;;

  codex)
    # VS Code Codex via CLI
    codex -p "$question" \
      --mcp-config "$mcp_config" 2>/dev/null
    ;;
esac
