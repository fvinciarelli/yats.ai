#!/usr/bin/env bash
# Build the yats-agent-lab image with this branch's yats-toolkit packed inside.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"

echo "▶ Packing local yats-toolkit (this branch)..."
cd "$ROOT/packages/yats-toolkit"
npm pack --silent >/dev/null
TGZ="$(ls -t yats-toolkit-*.tgz | head -1)"
mv "$TGZ" "$DIR/"

echo "▶ Building image yats-agent-lab:latest..."
cd "$DIR"
docker build -t yats-agent-lab:latest "$DIR"

rm -f "$DIR"/yats-toolkit-*.tgz
echo "✅ yats-agent-lab:latest ready"
