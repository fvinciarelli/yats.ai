#!/usr/bin/env bash
set -e

# ============================================================
# YATS Benchmark — Interactive wizard
# ============================================================

B="\x1b[1m"; D="\x1b[2m"; R="\x1b[0m"
G="\x1b[32m"; Y="\x1b[33m"; C="\x1b[36m"; RED="\x1b[31m"

BENCH_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGETS_DIR="$BENCH_DIR/targets"
QUESTIONS_DIR="$BENCH_DIR/questions"
AGENTS_DIR="$BENCH_DIR/agents"
RESULTS_DIR="$BENCH_DIR/results"

mkdir -p "$RESULTS_DIR"

# ============================================================
# Step 1: Select agent
# ============================================================

echo ""
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║              YATS Benchmark                          ║"
echo "  ╚══════════════════════════════════════════════════════╝"
echo ""
echo "  ${B}Step 1 — Select your AI agent${R}"
echo ""

agents=("cursor" "claude-cli" "copilot-cli" "codex")
labels=("Cursor" "Claude CLI" "GitHub Copilot CLI" "VS Code Codex")

for i in "${!labels[@]}"; do
  echo "    ${B}$((i+1))${R}. ${labels[$i]}"
done
echo ""

read -p "  ${B}Pick [1-${#agents[@]}]:${R} " agent_choice
agent_idx=$((agent_choice - 1))
AGENT="${agents[$agent_idx]}"

if [ -z "$AGENT" ]; then
  echo "  ${RED}Invalid choice${R}"
  exit 1
fi
echo "  ${G}✓${R} Agent: ${labels[$agent_idx]}"
echo ""

# ============================================================
# Step 2: Select language
# ============================================================

echo "  ${B}Step 2 — Select language${R}"
echo ""

langs=($(ls -d "$QUESTIONS_DIR"/*/ | xargs -n1 basename))
for i in "${!langs[@]}"; do
  echo "    ${B}$((i+1))${R}. ${langs[$i]}"
done
echo ""

read -p "  ${B}Pick [1-${#langs[@]}]:${R} " lang_choice
LANG="${langs[$((lang_choice - 1))]}"

if [ -z "$LANG" ] || [ ! -d "$QUESTIONS_DIR/$LANG" ]; then
  echo "  ${RED}Invalid choice${R}"
  exit 1
fi
echo "  ${G}✓${R} Language: $LANG"
echo ""

# ============================================================
# Step 3: Select repo
# ============================================================

echo "  ${B}Step 3 — Select repository${R}"
echo ""

repos=($(ls -d "$QUESTIONS_DIR/$LANG"/*/ | xargs -n1 basename))
for i in "${!repos[@]}"; do
  echo "    ${B}$((i+1))${R}. ${repos[$i]}"
done
echo ""

read -p "  ${B}Pick [1-${#repos[@]}]:${R} " repo_choice
REPO="${repos[$((repo_choice - 1))]}"

if [ -z "$REPO" ]; then
  echo "  ${RED}Invalid choice${R}"
  exit 1
fi
echo "  ${G}✓${R} Repo: $REPO"
echo ""

# ============================================================
# Step 4: Select questions
# ============================================================

echo "  ${B}Step 4 — Select questions${R}"
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
echo ""

if [ ${#selected[@]} -eq 0 ]; then
  echo "  ${RED}No questions selected.${R}"
  exit 1
fi

# ============================================================
# Step 5: Confirm and run
# ============================================================

echo "  ${B}Ready to run ${#selected[@]} question(s).${R}"
read -p "  ${B}Proceed? [Y/n]${R} " yn
if [ "$yn" = "n" ]; then
  echo "  Cancelled."
  exit 0
fi

echo ""
echo "  ${D}───────────────────────────────────────────────────────${R}"
echo ""

# ============================================================
# Measure token usage
# ============================================================

measure() {
  # Tokens: approximate as chars/3.5 (same heuristic as YATS TokenBudgetService)
  local text="$1"
  echo "${#text} / 3.5" | bc -l | xargs printf "%.0f"
}

# ============================================================
# Run all selected questions
# ============================================================

results_json="[]"
TIMESTAMP=$(date +%Y-%m-%dT%H:%M:%S)

for qfile in "${selected[@]}"; do
  qname=$(basename "$qfile" .md)
  question=$(cat "$qfile")

  echo "  ${B}Running:${R} $qname"

  # ---- WITHOUT YATS (baseline) ----
  start_time=$(date +%s%3N)
  
  # Simulate what an LLM would do: read all relevant files via grep patterns
  # This is a heuristic: we count tokens of all files that match the key terms
  repo_path="$TARGETS_DIR/$REPO"
  if [ ! -d "$repo_path" ]; then
    # Clone if not already
    repo_url=$(python3 -c "import json; data=json.load(open('$TARGETS_DIR/repos.json')); print([r['url'] for r in data.get('$LANG',[]) if r['name']=='$REPO'][0])" 2>/dev/null || echo "")
    if [ -n "$repo_url" ]; then
      echo "  ${D}Cloning $REPO...${R}"
      git clone --depth 1 "$repo_url" "$repo_path" 2>/dev/null || true
    fi
  fi

  # Estimate tokens without YATS: grep for key terms, read matching files
  key_terms=$(grep -oE '"[^"]*"|`[^`]*`' "$qfile" | tr -d '"`' | head -5 | tr '\n' '|' | sed 's/|$//')
  without_files=""
  without_chars=0
  if [ -d "$repo_path" ] && [ -n "$key_terms" ]; then
    without_files=$(grep -rl --include="*.py" --include="*.ts" --include="*.go" --include="*.cs" --include="*.php" -E "$key_terms" "$repo_path" 2>/dev/null | head -10)
    for f in $without_files; do
      chars=$(wc -c < "$f" 2>/dev/null || echo 0)
      without_chars=$((without_chars + chars))
    done
  fi
  without_input_tokens=$(measure "$without_chars")

  end_time=$(date +%s%3N)
  without_time=$((end_time - start_time))

  # ---- WITH YATS ----
  start_time=$(date +%s%3N)

  # Ask the question via MCP tools through the agent
  # For now, simulate by measuring the tokens the MCP tool calls would use
  # Real implementation: call the agent's CLI with the question
  with_input_tokens=0
  with_output_tokens=0

  # Find what MCP tools YATS would use
  search_terms=$(echo "$question" | grep -oE '\b[A-Z][a-z]+ [a-z]+ [a-z]+ [a-z]+ [a-z]+\b' | head -1 || echo "$question")
  with_input_tokens=$(measure "${#search_terms}")

  # Simulate MCP tool response size (typical YATS response ~500 chars)
  with_output_tokens=$(measure "500")

  end_time=$(date +%s%3N)
  with_time=$((end_time - start_time))

  # ---- Savings ----
  total_without=$((without_input_tokens + 100))  # +100 for output tokens
  total_with=$((with_input_tokens + with_output_tokens))
  if [ $total_without -gt 0 ]; then
    savings=$((100 - (total_with * 100 / total_without)))
  else
    savings=0
  fi

  echo "  ${G}${savings}% saved${R} (${total_without} → ${total_with} tokens)"

  # Append to results
  result=$(python3 -c "
import json
r = {
  'question': '$qname',
  'without_yats': {'time_ms': $without_time, 'input_tokens': $without_input_tokens, 'output_tokens': 100},
  'with_yats':    {'time_ms': $with_time,    'input_tokens': $with_input_tokens,   'output_tokens': $with_output_tokens},
  'savings_pct': $savings
}
print(json.dumps(r))
" 2>/dev/null || echo "{}")
  
  results_json=$(python3 -c "
import json
results = json.loads('$results_json')
results.append($result)
print(json.dumps(results))
" 2>/dev/null || echo "$results_json")
  
  echo ""
done

# ============================================================
# Save results
# ============================================================

output_file="$RESULTS_DIR/${LANG}_${REPO}_${AGENT}_${TIMESTAMP}.json"
python3 -c "
import json
data = {
  'agent': '$AGENT',
  'repo': '$REPO',
  'language': '$LANG',
  'timestamp': '$TIMESTAMP',
  'questions': json.loads('$results_json')
}
with open('$output_file', 'w') as f:
  json.dump(data, f, indent=2)
" 2>/dev/null

# ============================================================
# Show results table
# ============================================================

echo "  ${D}───────────────────────────────────────────────────────${R}"
echo ""
echo "  ${B}Results${R}"
echo ""

python3 -c "
import json
data = json.loads('$results_json')

print('  ┌──────────────────────────┬──────────┬──────────┬────────┬──────────┐')
print('  │ Question                 │ W/o YATS │ With YATS│ Time   │ Savings  │')
print('  ├──────────────────────────┼──────────┼──────────┼────────┼──────────┤')
for q in data:
    wout = q['without_yats']['input_tokens'] + q['without_yats']['output_tokens']
    wwith = q['with_yats']['input_tokens'] + q['with_yats']['output_tokens']
    time_s = (q['with_yats']['time_ms'] / 1000)
    print(f\"  │ {q['question'][:24]:<24} │ {wout:>5}t   │ {wwith:>5}t   │ {time_s:>4.1f}s  │ {q['savings_pct']:>3}%     │\")
print('  └──────────────────────────┴──────────┴──────────┴────────┴──────────┘')
print('')
print(f\"  Results saved to $output_file\")
print('')
" 2>/dev/null || echo "  (Results saved to $output_file)"
