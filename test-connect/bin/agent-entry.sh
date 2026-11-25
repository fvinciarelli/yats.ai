#!/usr/bin/env bash
# Inside the lab container: invoke the right agent CLI in headless mode.
# The connect-installed config lives in the fixture repo (cwd):
#   claude → .mcp.json (stdio bridge)          gemini → .gemini/settings.json
#   codex  → .codex/config.toml                copilot → .mcp.json
#   cursor → .cursor/mcp.json (HTTP)
set -euo pipefail

PROMPT="$1"
AGENT="${AGENT_NAME:?AGENT_NAME required}"
MODE="${AGENT_MODE:-with-yats}"
MODEL="${YATS_TEST_MODEL:-}"

echo "=== yats-agent-lab · $AGENT · $MODE ==="
echo "--- workspace: $PWD ---"

# --- DeepSeek BYOK: same model behind every agent, isolating agent behaviour ---
# (never touches the user-level configs; codex gets a fresh HOME-level config)
if [ -n "${DEEPSEEK_API_KEY:-}" ]; then
  DS_MODEL="${MODEL:-deepseek-v4-pro}"
  echo "--- provider: DeepSeek ($DS_MODEL) ---"
  export ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"
  export ANTHROPIC_AUTH_TOKEN="$DEEPSEEK_API_KEY"
  export ANTHROPIC_MODEL="$DS_MODEL"
  export ANTHROPIC_SMALL_FAST_MODEL="$DS_MODEL"
  export COPILOT_PROVIDER_TYPE="anthropic"
  export COPILOT_PROVIDER_BASE_URL="https://api.deepseek.com/anthropic"
  export COPILOT_PROVIDER_API_KEY="$DEEPSEEK_API_KEY"
  export COPILOT_MODEL="$DS_MODEL"
  export COPILOT_OFFLINE="true"
  if [ "$AGENT" = "codex" ]; then
    mkdir -p "$HOME/.codex"
    cat > "$HOME/.codex/config.toml" << CODEXDS
model = "$DS_MODEL"
model_provider = "deepseek"
preferred_auth_method = "apikey"
suppress_unstable_features_warning = true

[model_providers.deepseek]
name = "DeepSeek"
base_url = "https://api.deepseek.com/"
wire_api = "responses"
env_key = "DEEPSEEK_API_KEY"
CODEXDS
  fi
fi

case "$AGENT" in
  claude)
    if [ "$MODE" = "with-yats" ]; then
      MCP_ARGS=(--mcp-config "$PWD/.mcp.json")
    else
      MCP_ARGS=()
    fi
    claude -p "$PROMPT" \
      ${MODEL:+--model "$MODEL"} \
      --output-format stream-json \
      --verbose \
      --dangerously-skip-permissions \
      "${MCP_ARGS[@]}"
    ;;

  codex)
    # sandbox_mode=danger-full-access: bwrap is unavailable in the test container
    # baseline has no .codex/config.toml (runner resets it) → no MCP servers
    codex exec --json --trust --skip-git-repo-check -c sandbox_mode=danger-full-access "$PROMPT"
    ;;

  gemini)
    if [ "$MODE" = "with-yats" ]; then
      export GEMINI_CLI_TRUST_WORKSPACE=true
      gemini -p "$PROMPT" \
        ${MODEL:+--model "$MODEL"} \
        --output-format stream-json --yolo
    else
      mv .gemini .gemini.disabled 2>/dev/null || true
      export GEMINI_CLI_TRUST_WORKSPACE=true
      gemini -p "$PROMPT" \
        ${MODEL:+--model "$MODEL"} \
        --output-format stream-json --yolo
      mv .gemini.disabled .gemini 2>/dev/null || true
    fi
    ;;

  copilot)
    # COPILOT_ALLOW_ALL: trust the workspace so the connect-installed .mcp.json
    # actually loads (headless runs have no interactive trust prompt)
    export COPILOT_ALLOW_ALL="true"
    copilot -p "$PROMPT" --output-format json --allow-all
    ;;

  cursor)
    if [ "$MODE" = "with-yats" ]; then
      export CURSOR_MCP_CONFIG="$PWD/.cursor/mcp.json"
      agent -p "$PROMPT" --force --output-format stream-json
    else
      agent -p "$PROMPT" --force --output-format stream-json
    fi
    ;;

  *)
    echo "✗ unknown agent: $AGENT" >&2
    exit 1
    ;;
esac
