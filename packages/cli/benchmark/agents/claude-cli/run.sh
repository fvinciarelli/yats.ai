#!/bin/bash
# Run a question through Claude CLI and measure tokens
QUESTION_FILE="$1"
QUESTION=$(cat "$QUESTION_FILE")
claude --mcp-config mcp.json -p "$QUESTION" --output-format json
