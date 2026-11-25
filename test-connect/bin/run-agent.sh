#!/usr/bin/env bash
# Runs an AI agent inside the isolated lab container.
#
# Usage (host):
#   bin/run-agent.sh <agent> <question-file> [--with-yats|--without-yats]
#
# The fixture repo is mounted at ITS OWN absolute path inside the container,
# so tool calls pass `path=` values that the YATS server recognizes.
# Agent state (auth/config/caches) lives ONLY in test-connect/homes/<agent>.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Optional DeepSeek key: runs the agent model-independently (BYOK)
[ -f "$DIR/.env" ] && set -a && . "$DIR/.env" && set +a
AGENT="${1:?usage: run-agent.sh <agent> <question-file> [--with-yats|--without-yats]}"
QUESTION_FILE="${2:?question file required}"
MODE="${3:---with-yats}"

QUESTION_FILE="$(realpath "$QUESTION_FILE")"
REPO_DIR="${YATS_TEST_REPO_DIR:-$(realpath "$DIR/fixture/abs-bench")}"

[ -f "$QUESTION_FILE" ] || { echo "✗ question file not found: $QUESTION_FILE" >&2; exit 1; }
[ -d "$REPO_DIR" ] || { echo "✗ fixture repo not found: $REPO_DIR (run bin/prepare-fixture.sh)" >&2; exit 1; }

HOME_DIR="$DIR/homes/$AGENT"
mkdir -p "$HOME_DIR"

OUT_DIR="$DIR/results/$AGENT"
mkdir -p "$OUT_DIR"

# Multi-run support: YATS_TEST_RUNS=N repeats the whole cell (reset+install+run)
# so noisy single runs average out. Output: <q>__<mode>__run<i>.jsonl
RUNS="${YATS_TEST_RUNS:-1}"
for run_i in $(seq 1 "$RUNS"); do
  if [ "$RUNS" -gt 1 ]; then
    OUT_FILE="$OUT_DIR/$(basename "$QUESTION_FILE" .md)__${MODE#--}__run${run_i}.jsonl"
  else
    OUT_FILE="$OUT_DIR/$(basename "$QUESTION_FILE" .md)__${MODE#--}.jsonl"
  fi

echo "▶ $AGENT · $(basename "$QUESTION_FILE") · ${MODE#--} [run $run_i/$RUNS] → $OUT_FILE"

# --- Reset the fixture to a clean state for this agent, then install connect
# config only when testing WITH yats (baseline = the repo as-is, no YATS).
RESET_FILES=""
case "$AGENT" in
  claude)  RESET_FILES=".mcp.json .claude" ;;
  codex)   RESET_FILES="AGENTS.md .codex" ;;
  copilot) RESET_FILES=".mcp.json .github/copilot-instructions.md" ;;
  gemini)  RESET_FILES="GEMINI.md .gemini" ;;
  cursor)  RESET_FILES=".cursor" ;;
  pi)      RESET_FILES="AGENTS.md .pi" ;;
  vscode)  RESET_FILES=".vscode" ;;
esac

docker run --rm -u 1000:1000 -v "$REPO_DIR:$REPO_DIR" -w "$REPO_DIR" \
  yats-agent-lab:latest bash -c "rm -rf $RESET_FILES"

if [ "$MODE" = "--with-yats" ]; then
  echo "▶ installing connect config for $AGENT"
  docker run --rm -u 1000:1000 -v "$REPO_DIR:$REPO_DIR" -w "$REPO_DIR" \
    yats-agent-lab:latest bash -c "printf 'y\n' | yats connect --install $AGENT" | grep -E "✓|↻|Created|Merged" || true
fi

# pi.dev: reuse the host npm install (bind-mounted read-only) — the user's exact version
PI_AGENT_DIR="${PI_AGENT_DIR:-$HOME/.local/share/pi-node/node-v22.22.3-linux-x64/lib/node_modules/@earendil-works/pi-coding-agent}"
PI_MOUNT=()
if [ "$AGENT" = "pi" ] && [ -f "$PI_AGENT_DIR/dist/bundle/cli.js" ]; then
  PI_MOUNT=(-v "$PI_AGENT_DIR:/opt/pi-agent:ro")
fi

timeout "${YATS_TEST_TIMEOUT:-300}" docker run --rm --network host \
  -u 1000:1000 \
  -v "$HOME_DIR:/home/agent" \
  -v "$REPO_DIR:$REPO_DIR" \
  -v "$DIR/bin:/test-connect-bin:ro" \
  "${PI_MOUNT[@]}" \
  -w "$REPO_DIR" \
  -e HOME=/home/agent \
  -e AGENT_NAME="$AGENT" \
  -e AGENT_MODE="${MODE#--}" \
  -e YATS_TEST_MODEL="${YATS_TEST_MODEL:-}" \
  -e DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY:-}" \
  -e GEMINI_API_KEY="${GEMINI_API_KEY:-}" \
  -e CURSOR_API_KEY="${CURSOR_API_KEY:-}" \
  yats-agent-lab:latest \
  /test-connect-bin/agent-entry.sh "$(cat "$QUESTION_FILE")" 2>&1 | tee "$OUT_FILE"
done
