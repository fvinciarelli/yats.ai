#!/usr/bin/env bash
# One-time: copy host credentials into the isolated agent homes.
# Host files are never modified; the copies live only in test-connect/homes/ (gitignored).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOMES="$DIR/homes"

# claude (OAuth tokens)
if [ -f "$HOME/.claude.json" ]; then
  mkdir -p "$HOMES/claude"
  cp "$HOME/.claude.json" "$HOMES/claude/.claude.json"
  chmod 600 "$HOMES/claude/.claude.json"
  echo "✓ claude: ~/.claude.json → homes/claude/"
else
  echo "⚠ claude: no ~/.claude.json on host"
fi

# codex (OpenAI API key or ChatGPT login)
if [ -d "$HOME/.codex" ]; then
  mkdir -p "$HOMES/codex/.codex"
  cp "$HOME/.codex/auth.json" "$HOMES/codex/.codex/auth.json" 2>/dev/null || true
  cp "$HOME/.codex/config.toml" "$HOMES/codex/.codex/config.toml" 2>/dev/null || true
  chmod -R 700 "$HOMES/codex/.codex"
  echo "✓ codex: ~/.codex → homes/codex/"
else
  echo "⚠ codex: no ~/.codex on host"
fi

echo ""
echo "Pending auth (run inside the container, device-code flows):"
echo "  gemini : docker run --rm -it --network host -v $HOMES/gemini:/home/agent -e HOME=/home/agent yats-agent-lab:latest gemini"
echo "  copilot: docker run --rm -it --network host -v $HOMES/copilot:/home/agent -e HOME=/home/agent yats-agent-lab:latest copilot auth"
echo "  cursor : docker run --rm -it --network host -v $HOMES/cursor:/home/agent -e HOME=/home/agent yats-agent-lab:latest agent login"
