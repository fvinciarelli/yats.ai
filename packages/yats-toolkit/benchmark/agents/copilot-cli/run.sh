#!/bin/bash
QUESTION_FILE="$1"
QUESTION=$(cat "$QUESTION_FILE")
gh copilot suggest "$QUESTION"
