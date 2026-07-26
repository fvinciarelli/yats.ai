#!/usr/bin/env bash

# Compare the same Codex prompt with YATS enabled and disabled.
# Run from the repository root:
#   ./scripts/compare-codex-mcp.sh
# Or provide a different prompt:
#   ./scripts/compare-codex-mcp.sh 'Explain the authentication flow in FastAPI.'

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# The benchmark script lives under .plans/, so its parent is not the repository root.
# Git finds the actual project root regardless of the script's location inside it.
readonly REPOSITORY_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
readonly RUN_ID="$(date +%Y%m%dT%H%M%S)"
readonly OUTPUT_DIR="${OUTPUT_DIR:-$REPOSITORY_ROOT/artifacts/codex-mcp-comparison/$RUN_ID}"
readonly DEFAULT_PROMPT='Explain how FastAPI resolves dependency injection. If YATS is available, consult it before answering. Mention get_dependant, Dependant, and solve_dependencies. Do not modify files. Maximum 200 words.'
readonly PROMPT="${1:-$DEFAULT_PROMPT}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 127
  }
}

require_command codex
require_command jq

if [[ ! -f "$REPOSITORY_ROOT/.codex/config.toml" ]] || ! grep -q '^\[mcp_servers\.yats\]' "$REPOSITORY_ROOT/.codex/config.toml"; then
  echo "YATS is not configured in $REPOSITORY_ROOT/.codex/config.toml" >&2
  exit 2
fi

mkdir -p "$OUTPUT_DIR"

write_summary_header() {
  printf 'case\texit_code\telapsed_ms\tinput_tokens\tcached_input_tokens\toutput_tokens\treasoning_output_tokens\tmcp_tool_events\n' > "$OUTPUT_DIR/summary.tsv"
}

append_summary() {
  local case_name="$1"
  local exit_code="$2"
  local elapsed_ms="$3"
  local jsonl_file="$4"
  local usage
  local mcp_tool_events

  usage="$(jq -r 'select(.type == "turn.completed") | [.usage.input_tokens // 0, .usage.cached_input_tokens // 0, .usage.output_tokens // 0, .usage.reasoning_output_tokens // 0] | @tsv' "$jsonl_file" | tail -n 1)"
  usage="${usage:-$'0\t0\t0\t0'}"
  mcp_tool_events="$(grep -c '"mcp_tool_call"' "$jsonl_file" || true)"

  printf '%s\t%s\t%s\t%s\t%s\n' "$case_name" "$exit_code" "$elapsed_ms" "$usage" "$mcp_tool_events" >> "$OUTPUT_DIR/summary.tsv"
}

run_case() {
  local case_name="$1"
  shift

  local jsonl_file="$OUTPUT_DIR/$case_name.jsonl"
  local answer_file="$OUTPUT_DIR/$case_name.md"
  local stderr_file="$OUTPUT_DIR/$case_name.stderr.log"
  local start_ns
  local end_ns
  local elapsed_ms
  local exit_code

  start_ns="$(date +%s%N)"
  set +e
  (
    cd "$REPOSITORY_ROOT"
    codex exec "$@" --json --output-last-message "$answer_file" "$PROMPT"
  ) > "$jsonl_file" 2> "$stderr_file"
  exit_code=$?
  set -e
  end_ns="$(date +%s%N)"
  elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))

  append_summary "$case_name" "$exit_code" "$elapsed_ms" "$jsonl_file"
  printf '%s finished in %sms (exit %s)\n' "$case_name" "$elapsed_ms" "$exit_code"
}

write_summary_header

run_case with-mcp \
  -c 'mcp_servers.yats.enabled=true' \
  -c 'mcp_servers.yats.required=true'

run_case without-mcp \
  -c 'mcp_servers.yats.enabled=false'

echo
echo "Results: $OUTPUT_DIR"
column -t -s $'\t' "$OUTPUT_DIR/summary.tsv" 2>/dev/null || cat "$OUTPUT_DIR/summary.tsv"
