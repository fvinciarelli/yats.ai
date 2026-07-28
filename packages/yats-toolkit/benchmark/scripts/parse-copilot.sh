#!/bin/bash
# YATS Benchmark — Copilot-specific token & tool extractor
# Usage: parse-copilot.sh <output_file>

file="$1"

# Count MCP tool calls
mcp_calls=$(grep -c "(MCP: yats)" "$file" 2>/dev/null || echo 0)

# Extract tokens and credits from last summary line
summary=$(grep "Tokens" "$file" | tail -1)
credits=$(echo "$summary" | grep -oP 'AI Credits \K[\d.]+' || echo 0)
time_s=$(echo "$summary" | grep -oP '\(\K\d+' | head -1 || echo 0)

# Token breakdown
tokens_total=$(echo "$summary" | grep -oP '↑ \K[\d.]+k' | head -1 | sed 's/k//' || echo 0)
cached=$(echo "$summary" | grep -oP '[\d.]+k cached' | head -1 | grep -oP '[\d.]+' || echo 0)
written=$(echo "$summary" | grep -oP '[\d.]+k written' | head -1 | grep -oP '[\d.]+' || echo 0)

# Count file reads (non-MCP reads)
file_reads=$(grep -c "● Read" "$file" 2>/dev/null || echo 0)

python3 -c "
import json
print(json.dumps({
  'mcp_calls': $mcp_calls,
  'file_reads': $file_reads,
  'credits': $credits,
  'time_s': $time_s,
  'tokens_total': '${tokens_total}k',
  'tokens_cached': '${cached}k',
  'tokens_written': '${written}k',
  'savings': 'MCP tool calls replace grep/file scanning'
}))" 2>/dev/null
