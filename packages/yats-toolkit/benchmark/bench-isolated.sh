#!/usr/bin/env bash
# YATS Benchmark — with dynamic claude.json isolation
# Usage: bash bench-isolated.sh <question_file> [--with-yats]
# Requires: ANTHROPIC_API_KEY exported in shell

set -e

QUESTION_FILE="$1"
USE_YATS="$2"
YATS_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
QUESTION=$(cat "$QUESTION_FILE")

# Dynamic claude.json
if [ "$USE_YATS" = "--with-yats" ]; then
  cat > ~/.claude.json << 'EOF'
{
  "env": {"API_TIMEOUT_MS": "3000000"},
  "permissions": {"defaultMode": "default"},
  "projects": {
    "$YATS_ROOT": {
      "mcpServers": {
        "yats": {"type": "sse", "url": "http://localhost:5555/mcp/sse"}
      }
    }
  }
}
EOF
else
  cat > ~/.claude.json << 'EOF'
{
  "env": {"API_TIMEOUT_MS": "3000000"},
  "permissions": {"defaultMode": "default"},
  "projects": {}
}
EOF
fi

RESULT_FILE="/tmp/bench-$(basename "$QUESTION_FILE" .md)-${USE_YATS:-without}.jsonl"

DISALLOW=""
if [ "$USE_YATS" = "--with-yats" ]; then
  DISALLOW="--disallowedTools Bash,Read,WebSearch,WebFetch"
fi

claude -p "$QUESTION" \
  --model "$MODEL" \
  --output-format stream-json \
  --verbose \
  --dangerously-skip-permissions \
  $DISALLOW \
  2>/dev/null > "$RESULT_FILE"

python3 -c "
import json
with open('$RESULT_FILE') as f:
    for line in f:
        r = json.loads(line.strip())
        if r.get('type') == 'result':
            u = r.get('usage', {})
            t = u.get('input_tokens',0) + u.get('output_tokens',0) + u.get('cache_read_input_tokens',0) + u.get('cache_creation_input_tokens',0)
            c = r.get('total_cost_usd', 0)
            status = r.get('terminal_reason', '?')
            print(f'  tokens={t} cost=\${c:.4f} [{status}]')
"