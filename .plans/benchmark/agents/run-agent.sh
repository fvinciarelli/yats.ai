#!/bin/bash
# YATS Benchmark — Agent runner
# Usage: run-agent.sh <agent> <question_file> [mcp_config]

agent="$1"
question_file="$2"
mcp_config="$3"
question=$(cat "$question_file")

# Check if agent CLI is available
check_cmd() {
  command -v "$1" >/dev/null 2>&1
}

case "$agent" in
  cursor)
    if check_cmd cursor-agent; then
      if [ -n "$mcp_config" ]; then
        cp "$mcp_config" /tmp/yats-bench-mcp.json
        export CURSOR_MCP_CONFIG=/tmp/yats-bench-mcp.json
      fi
      cursor-agent -p "$question" --output-format stream-json --force --model claude-sonnet-5 2>/dev/null
    else
      echo '{"type":"result","usage":{"input_tokens":0,"output_tokens":0}}'
      echo "cursor-agent not installed. Install: https://cursor.com/docs/cli" >&2
    fi
    ;;

  claude-cli)
    if check_cmd claude; then
      if [ -n "$mcp_config" ]; then
        claude -p "$question" --output-format stream-json --verbose 2>/dev/null
      else
        claude -p "$question" --output-format stream-json --verbose 2>/dev/null
      fi
    else
      echo '{"type":"message","usage":{"input_tokens":0,"output_tokens":0}}'
      echo "claude not installed. Install: npm install -g @anthropic-ai/claude-code" >&2
    fi
    ;;

  copilot-cli)
    if check_cmd copilot || check_cmd gh; then
      cmd="copilot"
      check_cmd copilot || cmd="gh copilot"
      $cmd -p "$question" 2>/dev/null
    else
      echo "copilot CLI not installed." >&2
    fi
    ;;

  codex)
    if check_cmd codex; then
      if [ -n "$mcp_config" ]; then
        codex -p "$question" --mcp-config "$mcp_config" 2>/dev/null
      else
        codex -p "$question" 2>/dev/null
      fi
    else
      echo "codex not installed." >&2
    fi
    ;;
esac
