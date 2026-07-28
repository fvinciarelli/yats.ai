#!/usr/bin/env bash
set -e
# YATS Benchmark — Interactive wizard

B='\033[1m'; D='\033[2m'; R='\033[0m'
G='\033[32m'; Y='\033[33m'; C='\033[36m'; RED='\033[31m'

BENCH_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENTS_DIR="$BENCH_DIR/agents"
QUESTIONS_DIR="$BENCH_DIR/questions"
RESULTS_DIR="$BENCH_DIR/results"
mkdir -p "$RESULTS_DIR"

echo -e ""
echo -e "  ╔══════════════════════════════════════════════════════╗"
echo -e "  ║              YATS Benchmark                          ║"
echo -e "  ╚══════════════════════════════════════════════════════╝"
echo -e ""

# Step 1: Agent
echo -e "  ${B}Step 1 — AI Agent${R}"
echo -e ""
agents=("cursor" "claude-cli" "copilot-cli" "codex")
labels=("Cursor" "Claude CLI" "GitHub Copilot CLI" "VS Code Codex")
for i in "${!labels[@]}"; do
  echo -e "    ${B}$((i+1))${R}. ${labels[$i]}"
done
echo -e ""
read -p "  Pick [1-${#agents[@]}]: " c
AGENT="${agents[$((c-1))]}"
[ -z "$AGENT" ] && echo -e "  ${RED}Invalid${R}" && exit 1
echo -e "  ${G}✓${R} ${labels[$((c-1))]}"
echo -e ""

# Step 2: Language
echo -e "  ${B}Step 2 — Language${R}"
echo -e ""
langs=($(ls -d "$QUESTIONS_DIR"/*/ | xargs -n1 basename))
for i in "${!langs[@]}"; do
  echo -e "    ${B}$((i+1))${R}. ${langs[$i]}"
done
echo -e ""
read -p "  Pick [1-${#langs[@]}]: " c
LANG="${langs[$((c-1))]}"
[ -z "$LANG" ] && echo -e "  ${RED}Invalid${R}" && exit 1
echo -e "  ${G}✓${R} $LANG"
echo -e ""

# Step 3: Repo
echo -e "  ${B}Step 3 — Repository${R}"
echo -e ""
repos=($(ls -d "$QUESTIONS_DIR/$LANG"/*/ | xargs -n1 basename))
for i in "${!repos[@]}"; do
  echo -e "    ${B}$((i+1))${R}. ${repos[$i]}"
done
echo -e ""
read -p "  Pick [1-${#repos[@]}]: " c
REPO="${repos[$((c-1))]}"
[ -z "$REPO" ] && echo -e "  ${RED}Invalid${R}" && exit 1
echo -e "  ${G}✓${R} $REPO"
echo -e ""

# Step 4: Questions
echo -e "  ${B}Step 4 — Questions${R}"
echo -e ""
questions=($(ls "$QUESTIONS_DIR/$LANG/$REPO"/*.md | sort))
selected=()
for i in "${!questions[@]}"; do
  qname=$(basename "${questions[$i]}" .md)
  read -p "  Run ${qname}? [Y/n] " yn
  if [ "$yn" != "n" ]; then
    selected+=("${questions[$i]}")
    echo -e "  ${G}✓${R} $qname"
  else
    echo -e "  ${D}✗${R} $qname"
  fi
done
[ ${#selected[@]} -eq 0 ] && echo -e "  ${RED}None selected${R}" && exit 1
echo -e ""

# Step 5: Confirm
echo -e "  ${B}${#selected[@]} question(s) on $REPO${R}"
read -p "  Proceed? [Y/n] " yn
[ "$yn" = "n" ] && echo -e "  Cancelled." && exit 0

echo -e ""
echo -e "  ${D}───────────────────────────────────────────────────────${R}"
echo -e ""

# Extract tokens from stream-json
extract_tokens() {
  python3 -c "
import json
total = 0
try:
  with open('$1') as f:
    for line in f:
      line = line.strip()
      if not line: continue
      try: evt = json.loads(line)
      except: continue
      t = evt.get('type','')
      # Cursor/Claude: result events
      if t in ('result','message'):
        u = evt.get('usage',{})
        total += u.get('input_tokens',0) + u.get('output_tokens',0) + u.get('cache_read_input_tokens',0) + u.get('cache_read_tokens',0)
      # Codex: turn.completed events
      if t == 'turn.completed':
        u = evt.get('usage',{})
        total += u.get('input_tokens',0) + u.get('cached_input_tokens',0) + u.get('output_tokens',0) + u.get('reasoning_output_tokens',0)
      # Copilot: assistant.usage events
      if t == 'assistant.usage':
        total += evt.get('inputTokens',0) + evt.get('outputTokens',0) + evt.get('cacheReadTokens',0)
except: pass
print(total)
" 2>/dev/null || echo 0
}

TIMESTAMP=$(date +%Y-%m-%dT%H:%M:%S)
results_json="[]"

YATS_MCP="$AGENTS_DIR/yats-mcp.json"
cat > "$YATS_MCP" << 'MCPEOF'
{ "mcpServers": { "yats": { "url": "http://localhost:5555/mcp" } } }
MCPEOF

for qfile in "${selected[@]}"; do
  qname=$(basename "$qfile" .md)
  echo -e "  ${B}${qname}${R}"

  # Without YATS
  echo -ne "  ${D}without YATS...${R} "
  bash "$AGENTS_DIR/run-agent.sh" "$AGENT" "$qfile" "" > /tmp/yats-bench-without.jsonl 2>/dev/null || true
  without_total=$(extract_tokens /tmp/yats-bench-without.jsonl)

  # With YATS
  echo -ne "${D}with YATS...${R} "
  bash "$AGENTS_DIR/run-agent.sh" "$AGENT" "$qfile" "$YATS_MCP" > /tmp/yats-bench-with.jsonl 2>/dev/null || true
  with_total=$(extract_tokens /tmp/yats-bench-with.jsonl)

  if [ "$without_total" -gt 0 ]; then
    savings=$((100 - (with_total * 100 / without_total)))
  else
    savings=0
  fi

  echo -e "${G}${savings}% saved${R} (${without_total} → ${with_total} tokens)"

  result=$(python3 -c "
import json
r = {'question':'$qname','without_tokens':$without_total,'with_tokens':$with_total,'savings_pct':$savings}
print(json.dumps(r))
" 2>/dev/null)
  results_json=$(python3 -c "import json; r=json.loads('$results_json'); r.append($result); print(json.dumps(r))" 2>/dev/null)
  echo -e ""
done

# Save
output="$RESULTS_DIR/${LANG}_${REPO}_${AGENT}_${TIMESTAMP}.json"
python3 -c "
import json
data = {'agent':'$AGENT','repo':'$REPO','language':'$LANG','timestamp':'$TIMESTAMP','questions':json.loads('$results_json')}
with open('$output','w') as f: json.dump(data, f, indent=2)
" 2>/dev/null

# Table
echo -e "  ${D}───────────────────────────────────────────────────────${R}"
echo -e ""
echo -e "  ${B}Results${R}"
echo -e ""
python3 -c "
import json
data = json.loads('$results_json')
print('  ┌────────────────────────┬──────────┬──────────┬──────────┐')
print('  │ Question               │ W/o YATS │ With YATS│ Savings  │')
print('  ├────────────────────────┼──────────┼──────────┼──────────┤')
for q in data:
    print(f\"  │ {q['question'][:22]:<22} │ {q['without_tokens']:>5}t   │ {q['with_tokens']:>5}t   │ {q['savings_pct']:>3}%      │\")
print('  └────────────────────────┴──────────┴──────────┴──────────┘')
print(f\"\\n  Saved to $output\")
" 2>/dev/null
echo -e ""
