#!/usr/bin/env python3
"""Aggregate benchmark metrics from Claude stream-json output."""
import json, sys

logfile = sys.argv[1]
tag = sys.argv[2] if len(sys.argv) > 2 else "?"

with open(logfile) as f:
    events = [json.loads(line.strip()) for line in f if line.strip()]

results = [e for e in events if e.get("type") == "result"]
if not results:
    print("NO RESULTS"); sys.exit(1)

# ── Tokens from modelUsage (session-aggregated, includes sub-agents) ──
usage_keys = ["input_tokens", "output_tokens",
              "cache_creation_input_tokens", "cache_read_input_tokens"]
totals = {k: 0 for k in usage_keys}
models_seen = set()
total_cost = 0.0
turns = sum(r.get("num_turns", 0) for r in results)
errors = []
all_denials = sum(len(r.get("permission_denials", [])) for r in results)
for r in results:
    for e in (r.get("errors") or []):
        errors.append(e)

# modelUsage is the canonical source — same across all results (session total)
last = results[-1]
total_cost = last.get("total_cost_usd", 0)
for m, mu in last.get("modelUsage", {}).items():
    models_seen.add(m)
    totals["input_tokens"] += mu.get("inputTokens", 0)
    totals["output_tokens"] += mu.get("outputTokens", 0)
    totals["cache_creation_input_tokens"] += mu.get("cacheCreationInputTokens", 0)
    totals["cache_read_input_tokens"] += mu.get("cacheReadInputTokens", 0)

# ── Tool calls ──
tool_calls = {}
for e in events:
    if e.get("type") == "assistant":
        for c in e.get("message", {}).get("content", []):
            if c.get("type") == "tool_use":
                name = c.get("name", "?")
                tool_calls[name] = tool_calls.get(name, 0) + 1

yats = sum(v for k, v in tool_calls.items() if "yats" in k or "mcp__" in k)
reads = tool_calls.get("Read", 0)
bash = tool_calls.get("Bash", 0)
agents = tool_calls.get("Agent", 0) + tool_calls.get("Task", 0)
other = sum(tool_calls.values()) - yats - reads - bash - agents

# ── Content fetched ──
content_chars = 0
for e in events:
    if e.get("type") == "user":
        for c in e.get("message", {}).get("content", []):
            if c.get("type") == "tool_result":
                text = c.get("content", "")
                if isinstance(text, list):
                    text = "".join(str(x.get("text", "")) for x in text)
                content_chars += len(text)

# ── Report ──
total_tokens = sum(totals.values())
pcts = {k: (totals[k] / total_tokens * 100) if total_tokens else 0 for k in usage_keys}

lines = [
    "",
    f"  {'='*50}",
    f"  {tag:^50}",
    f"  {'='*50}",
    "",
    f"  TOKENS",
    f"    Input:      {totals['input_tokens']:>12,}  ({pcts['input_tokens']:5.1f}%)",
    f"    Output:     {totals['output_tokens']:>12,}  ({pcts['output_tokens']:5.1f}%)",
    f"    Cache read: {totals['cache_read_input_tokens']:>12,}  ({pcts['cache_read_input_tokens']:5.1f}%)  ← barato (0.1x)",
    f"    Cache write:{totals['cache_creation_input_tokens']:>12,}  ({pcts['cache_creation_input_tokens']:5.1f}%)  ← caro (1.25x)",
    f"    ─────────────────────────────",
    f"    TOTAL:      {total_tokens:>12,}",
    "",
    f"  COST: ${total_cost:.4f}",
    "",
    f"  STRATEGY",
    f"    Turns:           {turns:>8}",
    f"    Agent spawns:    {agents:>8}",
    f"    YATS queries:    {yats:>8}  ← barato, dirigido",
    f"    File reads:      {reads:>8}  ← caro, contenido crudo",
    f"    Bash commands:   {bash:>8}  ← exploracion a ciegas" if bash > 0 else f"    Bash commands:   {bash:>8}",
    f"    Other:           {other:>8}",
    f"    Content fetched: {content_chars:>8,} chars",
    "",
    f"  Models: {', '.join(sorted(models_seen))}",
    f"  Errors: {len(errors)},  Denials: {all_denials}",
    "",
]

for line in lines:
    print(line)

# ── JSON summary ──
summary = {
    "tag": tag,
    "tokens": totals,
    "total_tokens": total_tokens,
    "cost_usd": round(total_cost, 6),
    "turns": turns,
    "strategy": {
        "agent_spawns": agents,
        "yats_queries": yats,
        "file_reads": reads,
        "bash_commands": bash,
        "other": other,
        "tool_breakdown": dict(sorted(tool_calls.items(), key=lambda x: -x[1])),
    },
    "content_chars": content_chars,
    "models": sorted(models_seen),
    "errors": len(errors),
    "permission_denials": all_denials,
}
json_path = logfile.replace(".jsonl", ".summary.json")
with open(json_path, "w") as f:
    json.dump(summary, f, indent=2)
