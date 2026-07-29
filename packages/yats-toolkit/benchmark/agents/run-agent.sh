#!/bin/bash
# YATS Benchmark — Agent runner
# Usage: run-agent.sh <agent> <question_file> [mcp_config]

agent="$1"
question_file="$2"
mcp_config="$3"
model="${YATS_BENCH_MODEL:-sonnet}"
question=$(cat "$question_file")

# Change to repo directory so the agent works in the right context
if [ -n "$YATS_BENCH_REPO_DIR" ] && [ -d "$YATS_BENCH_REPO_DIR" ]; then
  cd "$YATS_BENCH_REPO_DIR" || true
fi

# Export repo name for MCP bridge auto-injection
export YATS_DEFAULT_REPO="${YATS_BENCH_REPO_NAME:-$YATS_DEFAULT_REPO}"

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
        claude -p "$question" --model "$model" --output-format stream-json --verbose --dangerously-skip-permissions --mcp-config "$mcp_config" 2>/dev/null
      else
        claude -p "$question" --model "$model" --output-format stream-json --verbose --dangerously-skip-permissions 2>/dev/null
      fi
    else
      echo '{"type":"message","usage":{"input_tokens":0,"output_tokens":0}}'
      echo "claude not installed. Install: npm install -g @anthropic-ai/claude-code" >&2
    fi
    ;;

  copilot-cli)
    if check_cmd copilot; then
      # Copilot MCP: handles both HTTP and stdio bridge formats
      if [ -n "$mcp_config" ]; then
        mkdir -p ~/.copilot
        python3 -c "
import json
with open('$mcp_config') as f:
    std = json.load(f)
servers = []
for k, v in std.get('mcpServers', {}).items():
    if 'command' in v:
        # stdio bridge format (local process)
        servers.append({'name': k, 'type': 'local', 'command': v['command'], 'args': v.get('args', [])})
    elif 'url' in v:
        # HTTP format
        servers.append({'name': k, 'type': 'http', 'url': v['url']})
with open('/tmp/copilot-mcp.json', 'w') as f:
    json.dump({'servers': servers}, f)
" 2>/dev/null
        copilot -p "$question" --mcp-config /tmp/copilot-mcp.json --output-format json --allow-all 2>/dev/null
      else
        copilot -p "$question" --output-format json --allow-all 2>/dev/null
      fi
    else
      echo "copilot not installed: npm install -g @github/copilot" >&2
    fi
    ;;

  codex)
    # Codex with MCP stdio configured via .codex/config.toml
    if check_cmd codex; then
      if [ -n "$mcp_config" ]; then
        # MCP stdio bridge is configured in .codex/config.toml
        # Use --ephemeral for clean session, multi_agent=false for direct MCP
        codex exec --json "$question" 2>/dev/null
      else
        # Baseline: without MCP config
        codex exec --json "$question" 2>/dev/null
      fi
    else
      echo "codex not installed." >&2
    fi
    ;;

  gemini)
    if check_cmd gemini; then
      gemini_model="${YATS_BENCH_GEMINI_MODEL:-gemini-flash-latest}"
      if [ -n "$mcp_config" ]; then
        # Write MCP config to .gemini/settings.json (repo root)
        export GEMINI_CLI_TRUST_WORKSPACE=true
        mkdir -p .gemini
        cp "$mcp_config" .gemini/settings.json
        gemini -p "$question" --model "$gemini_model" --output-format stream-json --yolo 2>/dev/null
      else
        # Baseline: no MCP config
        rm -f .gemini/settings.json
        export GEMINI_CLI_TRUST_WORKSPACE=true
        gemini -p "$question" --model "$gemini_model" --output-format stream-json --yolo 2>/dev/null
      fi
    else
      echo '{"type":"result","usage":{"input_tokens":0,"output_tokens":0}}'
      echo "gemini not installed." >&2
    fi
    ;;
esac
