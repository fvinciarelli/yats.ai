#!/usr/bin/env bash
# One-time: copy the fixture repo (abs) into test-connect/fixture/ and index
# it in the YATS server so the sandboxed agents can query it.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${1:-$HOME/cosas/abs}"
FIXTURE="$DIR/fixture/abs-bench"

[ -d "$SRC" ] || { echo "✗ source repo not found: $SRC" >&2; exit 1; }

echo "▶ Copying $SRC → $FIXTURE"
mkdir -p "$(dirname "$FIXTURE")"
rsync -a --delete \
  --exclude node_modules --exclude _next --exclude .git --exclude .next \
  --exclude dist --exclude build --exclude coverage \
  "$SRC/" "$FIXTURE/"

echo "▶ Indexing $FIXTURE"
yats index "$FIXTURE"

echo "✓ Fixture ready: $FIXTURE"
yats summary "$FIXTURE"
