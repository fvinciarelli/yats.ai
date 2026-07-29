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
agents=("cursor" "claude-cli" "copilot-cli" "codex" "gemini")
labels=("Cursor" "Claude CLI" "GitHub Copilot CLI" "VS Code Codex" "Gemini CLI")
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

# Step 3.5: Working directory for repo clone
echo -e "  ${B}Step 3.5 — Working directory${R}"
echo -e "  ${D}Directory where repos will be cloned for the agent to work on${R}"
echo -e ""
default_workdir="${YATS_BENCH_WORKDIR:-$HOME/yats-bench-repos}"
read -p "  Path [${default_workdir}]: " workdir_input
WORKDIR="${workdir_input:-$default_workdir}"
mkdir -p "$WORKDIR"
echo -e "  ${G}✓${R} $WORKDIR"
echo -e ""

# Clone repo if needed
REPO_DIR="$WORKDIR/$REPO"
REPO_URL=$(python3 -c "
import json
with open('$BENCH_DIR/targets/repos.json') as f:
    data = json.load(f)
for r in data.get('$LANG', []):
    if r['name'] == '$REPO':
        print(r['url'])
        break
" 2>/dev/null)

if [ ! -d "$REPO_DIR/.git" ]; then
  if [ -n "$REPO_URL" ]; then
    echo -e "  ${D}Cloning $REPO from $REPO_URL...${R}"
    git clone --depth 1 "$REPO_URL" "$REPO_DIR" 2>&1 | tail -1
    echo -e "  ${G}✓${R} Cloned to $REPO_DIR"
  else
    echo -e "  ${Y}⚠ No URL in targets/repos.json — using existing $REPO_DIR if any${R}"
  fi
else
  echo -e "  ${G}✓${R} Repo already exists at $REPO_DIR"
fi
echo -e ""

# Index repo in YATS if needed
YATS_HEALTH=$(curl -s -m 3 http://localhost:5555/health 2>/dev/null || echo '')
if [ -n "$YATS_HEALTH" ]; then
  echo -e "  ${D}Checking if $REPO is indexed...${R}"
  if yats list 2>/dev/null | grep -q "^  $REPO "; then
    echo -e "  ${G}✓${R} Already indexed"
  else
    echo -e "  ${D}Indexing $REPO (this may take a while)...${R}"
    yats index "$REPO_DIR" 2>&1 | tail -3
    echo -e "  ${G}✓${R} Indexed as '$REPO'"
  fi
else
  echo -e "  ${Y}⚠ YATS not running — skip indexing. Start with: yats start${R}"
fi
echo -e ""

# Export for run-agent.sh
export YATS_BENCH_REPO_DIR="$REPO_DIR"
export YATS_BENCH_REPO_NAME="$REPO"

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
extract_tokens_and_model() {
  python3 -c "
import json
total = 0
nanoaiu = 0
model = ''
cost = 0
try:
  with open('$1') as f:
    for line in f:
      line = line.strip()
      if not line: continue
      try: evt = json.loads(line)
      except: continue
      t = evt.get('type','')
      # Capture model from first init/system event
      if not model:
        if t == 'init':
          model = evt.get('model','')
        elif t == 'system' and evt.get('subtype') == 'init':
          model = evt.get('model','')
        elif t == 'session.tools_updated':
          model = evt.get('data',{}).get('model','')
        elif t == 'tool.execution_start':
          model = evt.get('data',{}).get('model','')
      # Cursor/Claude: result events
      if t in ('result','message'):
        u = evt.get('usage',{})
        total += u.get('input_tokens',0) + u.get('output_tokens',0) + u.get('cache_read_input_tokens',0) + u.get('cache_read_tokens',0)
      # Codex: turn.completed events
      if t == 'turn.completed':
        u = evt.get('usage',{})
        total += u.get('input_tokens',0) + u.get('cached_input_tokens',0) + u.get('output_tokens',0) + u.get('reasoning_output_tokens',0)
      # Copilot: assistant.usage events OR nanoAiu from usage_checkpoint
      if t == 'assistant.usage':
        total += evt.get('inputTokens',0) + evt.get('outputTokens',0) + evt.get('cacheReadTokens',0)
      if t == 'session.usage_checkpoint':
        nanoaiu = evt.get('data',{}).get('totalNanoAiu', 0)
      # Claude: total_cost_usd in wrapper events
      if 'total_cost_usd' in evt:
        cost = max(cost, evt.get('total_cost_usd', 0))
      # Gemini: result events with stats
      if t == 'result':
        s = evt.get('stats',{})
        total += s.get('input_tokens',0) + s.get('output_tokens',0)
        if not model:
          models = s.get('models',{})
          if models:
            model = list(models.keys())[0]
except: pass
# If Copilot, use nanoAiu as the metric (no token events)
if nanoaiu > 0 and total == 0:
  total = nanoaiu
print(json.dumps({'tokens': total, 'model': model, 'cost': cost}))
" 2>/dev/null || echo '{"tokens":0,"model":""}'
}

TIMESTAMP=$(date +%Y-%m-%dT%H:%M:%S)
results_json="[]"

YATS_MCP="$AGENTS_DIR/yats-mcp.json"
# Gemini, Copilot, and Codex use stdio bridge; Cursor and Claude use HTTP
if [ "$AGENT" = "gemini" ] || [ "$AGENT" = "copilot-cli" ] || [ "$AGENT" = "codex" ]; then
  cat > "$YATS_MCP" << 'MCPEOF'
{
  "mcpServers": {
    "yats": {
      "command": "node",
      "args": ["/home/franco/cosas/code_indexer/packages/yats-toolkit/benchmark/adapters/mcp-bridge-stdio.cjs", "--stdio"],
      "trust": true
    }
  }
}
MCPEOF
else
  cat > "$YATS_MCP" << 'MCPEOF'
{ "mcpServers": { "yats": { "url": "http://localhost:5555/mcp" } } }
MCPEOF
fi

for qfile in "${selected[@]}"; do
  qname=$(basename "$qfile" .md)
  echo -e "  ${B}${qname}${R}"

  # Without YATS
  echo -ne "  ${D}without YATS...${R} "
  bash "$AGENTS_DIR/run-agent.sh" "$AGENT" "$qfile" "" > /tmp/yats-bench-without.jsonl 2>/dev/null || true
  without_result=$(extract_tokens_and_model /tmp/yats-bench-without.jsonl)
  without_total=$(echo "$without_result" | python3 -c "import json,sys; print(json.load(sys.stdin)['tokens'])" 2>/dev/null || echo 0)
  without_model=$(echo "$without_result" | python3 -c "import json,sys; print(json.load(sys.stdin).get('model',''))" 2>/dev/null || echo "")

  # With YATS
  echo -ne "${D}with YATS...${R} "
  bash "$AGENTS_DIR/run-agent.sh" "$AGENT" "$qfile" "$YATS_MCP" > /tmp/yats-bench-with.jsonl 2>/dev/null || true
  with_result=$(extract_tokens_and_model /tmp/yats-bench-with.jsonl)
  with_total=$(echo "$with_result" | python3 -c "import json,sys; print(json.load(sys.stdin)['tokens'])" 2>/dev/null || echo 0)
  with_model=$(echo "$with_result" | python3 -c "import json,sys; print(json.load(sys.stdin).get('model',''))" 2>/dev/null || echo "")
  without_cost=$(echo "$without_result" | python3 -c "import json,sys; print(json.load(sys.stdin).get('cost',0))" 2>/dev/null || echo 0)
  with_cost=$(echo "$with_result" | python3 -c "import json,sys; print(json.load(sys.stdin).get('cost',0))" 2>/dev/null || echo 0)

  if [ "$without_total" -gt 0 ]; then
    savings=$((100 - (with_total * 100 / without_total)))
  else
    savings=0
  fi

  echo -e "${G}${savings}% saved${R} (${without_total} → ${with_total} tokens)"

  result=$(python3 -c "
import json
r = {'question':'$qname','without_tokens':$without_total,'with_tokens':$with_total,'savings_pct':$savings,'model':'$with_model' if '$with_model' else '$without_model','without_cost':$without_cost,'with_cost':$with_cost}
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
print('  ┌────────────────────────┬──────────┬──────────┬──────────┬──────────────────────┐')
print('  │ Question               │ W/o YATS │ With YATS│ Savings  │ Model                │')
print('  ├────────────────────────┼──────────┼──────────┼──────────┼──────────────────────┤')
for q in data:
    print(f\"  │ {q['question'][:22]:<22} │ {q['without_tokens']:>5}t   │ {q['with_tokens']:>5}t   │ {q['savings_pct']:>3}%      │\")
print('  └────────────────────────┴──────────┴──────────┴──────────┴──────────────────────┘')
print(f\"\\n  Saved to $output\")
" 2>/dev/null
echo -e ""
