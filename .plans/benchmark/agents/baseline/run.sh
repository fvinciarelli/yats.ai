#!/bin/bash
# Baseline: LLM with only file tools, no YATS
QUESTION_FILE="$1"
QUESTION=$(cat "$QUESTION_FILE")
echo "Answer this using only file reading tools: $QUESTION"
