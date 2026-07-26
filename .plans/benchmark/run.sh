#!/usr/bin/env bash
set -e

# ============================================================
# YATS Benchmark — Interactive wizard with real token measurement
# ============================================================

B="\x1b[1m"; D="\x1b[2m"; R="\x1b[0m"
G="\x1b[32m"; Y="\x1b[33m"; C="\x1b[36m"; RED="\x1b[31m"

BENCH_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENTS_DIR="$BENCH_DIR/agents"
QUESTIONS_DIR="$BENCH_DIR/questions"
RESULTS_DIR="$BENCH_DIR/results"

mkdir -p "$RESULTS_DIR"

echo ""
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║              YATS Benchmark                          ║"
echo "  ╚══════════════════════════════════════════════════════╝"
echo ""

# ============================================================
# Step 1: Agent
# ============================================================
echo "  ${B}Step 1 — AI Agent${R}"
echo ""
agents=("cursor" "claude-cli" "copilot-cli" "codex")
labels=("Cursor" "Claude CLI" "GitHub Copilot CLI" "VS Code Codex")
for i in "${!labels[@]}"; do
  echo "    ${B}$((i+1))${R}. ${labels[$i]}"
done
echo ""
read -p "  ${B}Pick [1-${#agents[@]}]:${R} " c
AGENT="${agents[$((c-1))]}"
[ -z "$AGENT" ] && echo "  ${RED}Invalid${R}" && exit 1
echo "  ${G}✓${R} ${labels[$((c-1))]}"
echo ""

# ============================================================
# Step 2: Language
# ============================================================
echo "  ${B}Step 2 — Language${R}"
echo ""
langs=($(ls -d "$QUESTIONS_DIR"/*/ | xargs -n1 basename))
for i in "${!langs[@]}"; do
  echo "    ${B}$((i+1))${R}. ${langs[$i]}"
done
echo ""
read -p "  ${B}Pick [1-${#langs[@]}]:${R} " c
LANG="${langs[$((c-1))]}"
[ -z "$LANG" ] && echo "  ${RED}Invalid${R}" && exit 1
echo "  ${G}✓${R} $LANG"
echo ""

# ============================================================
# Step 3: Repo
# ============================================================
echo "  ${B}Step 3 — Repository${R}"
echo ""
repos=($(ls -d "$QUESTIONS_DIR/$LANG"/*/ | xargs -n1 basename))
for i in "${!repos[@]}"; do
  echo "    ${B}$((i+1))${R}. ${repos[$i]}"
done
echo ""
read -p "  ${B}Pick [1-${#repos[@]}]:${R} " c
REPO="${repos[$((c-1))]}"
[ -z "$REPO" ] && echo "  ${RED}Invalid${R}" && exit 1
echo "  ${G}✓${R} $REPO"
echo ""

# ============================================================
# Step 4: Questions
# ============================================================
echo "  ${B}Step 4 — Questions${R}"
echo ""
questions=($(ls "$QUESTIONS_DIR/$LANG/$REPO"/*.md | sort))
selected=()
for i in "${!questions[@]}"; do
  qname=$(basename "${questions[$i]}" .md)
  read -p "  Run ${B}${qname}${R}? [Y/n] " yn
  if [ "$yn" != "n" ]; then
    selected+=("${questions[$i]}")
    echo "  ${G}✓${R} $qname"
  else
    echo "  ${D}✗${R} $qname"
  fi
done
[ ${#selected[@]} -eq 0 ] && echo "  ${RED}None selected${R}" && exit 1
echo ""

# ============================================================
# Step 5: Confirm
# ============================================================
echo "  ${B}${#selected[@]} question(s) with ${labels[$((c-1))]} on $REPO${R}"
read -p "  ${B}Proceed? [Y/n]${R} " yn
[ "$yn" = "n" ] && echo "  Cancelled." && exit 0

echo ""
echo "  ${D}───────────────────────────────────────────────────────${R}"
echo ""

# ============================================================
# Extract tokens from stream-json output
# ============================================================
extract_tokens() {
  local file="$1"
  python3 -c "
import json, sys
input_tokens = 0
output_tokens = 0
cache_read = 0
with open('$file') as f:
  for line in f:
    line = line.strip()
    if not line: continue
    try:
      evt = json.loads(line)
    except: continue
    t = evt.get('type','')
    # Cursor stream-json: result events have usage
    if t == 'result':
      u = evt.get('usage', {})
      input_tokens += u.get('input_tokens', 0)
      output_tokens += u.get('output_tokens', 0)
      cache_read += u.get('cache_read_tokens', 0)
    # Claude stream-json: message events with usage
    if t == 'message' and 'usage' in evt:
      u = evt['usage']
      input_tokens += u.get('input_tokens', 0)
      output_tokens += u.get('output_tokens', 0)
      cache_read += u.get('cache_read_input_tokens', 0)
print(json.dumps({'input': input_tokens, 'output': output_tokens, 'cache': cache_read, 'total': input_tokens + output_tokens + cache_read}))
" 2>/dev/null || echo '{"input":0,"output":0,"cache":0,"total":0}'
}

# ============================================================
# Run all questions
# ============================================================
TIMESTAMP=$(date +%Y-%m-%dT%H:%M:%S)
results_json="[]"

# MCP config for YATS
YATS_MCP="$AGENTS_DIR/yats-mcp.json"
cat > "$YATS_MCP" << EOF
{ "mcpServers": { "yats": { "url": "http://localhost:5555/mcp" } } }
EOF

for qfile in "${selected[@]}"; do
  qname=$(basename "$qfile" .md)
  echo "  ${B}${qname}${R}"

  # ---- WITHOUT YATS ----
  echo -n "  ${D}without YATS...${R} "
  bash "$AGENTS_DIR/run-agent.sh" "$AGENT" "$qfile" "" > /tmp/yats-bench-without.jsonl 2>/dev/null || true
  sleep 2
  without=$(extract_tokens /tmp/yats-bench-without.jsonl)
  without_in=$(echo "$without" | python3 -c "import json,sys; print(json.load(sys.stdin)['input'])")
  without_out=$(echo "$without" | python3 -c "import json,sys; print(json.load(sys.stdin)['output'])")
  without_total=$(echo "$without" | python3 -c "import json,sys; print(json.load(sys.stdin)['total'])")

  # ---- WITH YATS ----
  echo -n "${D}with YATS...${R} "
  bash "$AGENTS_DIR/run-agent.sh" "$AGENT" "$qfile" "$YATS_MCP" > /tmp/yats-bench-with.jsonl 2>/dev/null || true
  sleep 2
  with=$(extract_tokens /tmp/yats-bench-with.jsonl)
  with_in=$(echo "$with" | python3 -c "import json,sys; print(json.load(sys.stdin)['input'])")
  with_out=$(echo "$with" | python3 -c "import json,sys; print(json.load(sys.stdin)['output'])")
  with_total=$(echo "$with" | python3 -c "import json,sys; print(json.load(sys.stdin)['total'])")

  if [ "$without_total" -gt 0 ]; then
    savings=$((100 - (with_total * 100 / without_total)))
  else
    savings=0
  fi

  echo "${G}${savings}% saved${R} (${without_total} → ${with_total} tokens)"

  result=$(python3 -c "
import json
r = {
  'question': '$qname',
  'without_yats': {'input_tokens': $without_in, 'output_tokens': $without_out, 'total': $without_total},
  'with_yats':    {'input_tokens': $with_in,    'output_tokens': $with_out,    'total': $with_total},
  'savings_pct': $savings
}
print(json.dumps(r))
")
  results_json=$(python3 -c "import json; r=json.loads('$results_json'); r.append($result); print(json.dumps(r))")
  echo ""
done

# ============================================================
# Save & display
# ============================================================
output="$RESULTS_DIR/${LANG}_${REPO}_${AGENT}_${TIMESTAMP}.json"
python3 -c "
import json
data = {'agent':'$AGENT','repo':'$REPO','language':'$LANG','timestamp':'$TIMESTAMP','questions':json.loads('$results_json')}
with open('$output','w') as f: json.dump(data, f, indent=2)
"

echo "  ${D}───────────────────────────────────────────────────────${R}"
echo ""
echo "  ${B}Results${R}"
echo ""
python3 -c "
import json
data = json.loads('$results_json')
print('  ┌────────────────────────┬──────────┬──────────┬──────────┐')
print('  │ Question               │ W/o YATS │ With YATS│ Savings  │')
print('  ├────────────────────────┼──────────┼──────────┼──────────┤')
for q in data:
    print(f\"  │ {q['question'][:22]:<22} │ {q['without_yats']['total']:>5}t   │ {q['with_yats']['total']:>5}t   │ {q['savings_pct']:>3}%      │\")
print('  └────────────────────────┴──────────┴──────────┴──────────┘')
print(f\"\\n  Saved to $output\")
"
echo ""
