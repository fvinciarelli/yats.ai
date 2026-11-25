#!/usr/bin/env python3
"""Scorecard for test-connect transcripts.

Reads one or two transcript files (with-yats / without-yats) and scores
instruction compliance per criterion. Exit code 1 if any criterion fails.

Formats supported: codex (JSON lines), claude (stream-json).
"""
import json
import sys
from pathlib import Path

YATS_TOOLS = {
    "search_code", "search_documentation", "search_similar", "find_symbol",
    "find_references", "find_callers", "find_callees", "find_implementations",
    "find_inheritors", "find_routes", "find_configuration", "find_tests",
    "expand_graph", "related_symbols", "list_symbols", "list_repositories",
    "delete_repository", "repository_summary", "architecture_summary",
    "rebuild_vectors",
}


def parse_codex(path: Path):
    calls, reads, answer, usage = [], 0, "", None
    for line in path.read_text().splitlines():
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if r.get("type") == "item.completed":
            item = r.get("item", {})
            it = item.get("type")
            if it == "mcp_tool_call" and item.get("server") == "yats":
                calls.append({"tool": item.get("tool", "?"), "args": item.get("arguments", {})})
            elif it == "command_execution":
                reads += 1
            elif it == "web_search":
                reads += 1
            elif it == "agent_message":
                answer = item.get("text", "")
        elif r.get("type") == "turn.completed":
            usage = r.get("usage", {})
    return calls, reads, answer, usage


def parse_copilot(path: Path):
    """Copilot CLI JSON events: tool.execution_start (toolName 'yats-<tool>' = MCP),
    bash = fallback. BYOK runs report no token usage."""
    calls, reads, answer, usage = [], 0, "", {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        t = r.get("type")
        if t == "tool.execution_start":
            d = r.get("data", {})
            name = d.get("toolName", "")
            if name.startswith("yats-"):
                calls.append({"tool": name.removeprefix("yats-"), "args": d.get("arguments", {})})
            elif name == "bash":
                if is_startup_check(name, d.get("arguments", {})):
                    continue
                reads += 1
        elif t == "assistant.message":
            content = r.get("data", {}).get("content")
            if isinstance(content, str):
                answer = content
            elif isinstance(content, list):
                for b in content:
                    if isinstance(b, dict) and b.get("type") == "text":
                        answer = b.get("text", "")
        elif t == "session.usage_checkpoint":
            d = r.get("data", {})
            if d.get("inputTokens") or d.get("input_tokens"):
                usage = d
            if d.get("totalNanoAiu") is not None or d.get("totalPremiumRequests") is not None:
                usage = {**usage, **d}
    return calls, reads, answer, usage


def is_startup_check(name, args):
    """The instructed startup check (`yats list` / `yats index`) is not a fallback."""
    cmd = (args or {}).get("command", "")
    return cmd.strip().startswith(("yats list", "yats index"))


def parse_pi(path: Path):
    """Pi `--mode json` NDJSON: message_update (usage + text deltas),
    tool_execution_start (toolName/args), agent_end (final messages)."""
    calls, reads, file_reads, answer, usage = [], 0, 0, "", {}
    deltas = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        t = r.get("type")
        if t == "message_update":
            u = r.get("usage") or {}
            if u.get("input") or u.get("totalTokens"):
                usage = {
                    "input_tokens": u.get("input", 0),
                    "output_tokens": u.get("output", 0),
                    "cache_read_input_tokens": u.get("cacheRead", 0),
                }
                cost = (u.get("cost") or {}).get("total")
                if cost:
                    usage["total_cost_usd"] = cost
            ev = r.get("assistantMessageEvent") or {}
            if ev.get("type") == "text_delta":
                deltas.append(ev.get("delta", ""))
        elif t == "tool_execution_start":
            name = r.get("toolName", "")
            if name.startswith("mcp__yats__"):
                calls.append({"tool": name.removeprefix("mcp__yats__"), "args": r.get("args", {})})
            elif name in ("read", "read_file"):
                file_reads += 1
            elif name in ("bash", "grep", "find", "ls", "web_search", "web_fetch"):
                if name == "bash" and is_startup_check(name, r.get("args", {})):
                    continue
                reads += 1
        elif t == "agent_end":
            for m in r.get("messages") or []:
                if m.get("role") == "assistant":
                    c = m.get("content")
                    if isinstance(c, str):
                        answer = c
                    elif isinstance(c, list):
                        for b in c:
                            if isinstance(b, dict) and b.get("type") == "text":
                                answer = b.get("text", "")
    if not answer:
        answer = "".join(deltas)
    usage["_file_reads"] = file_reads
    return calls, reads, answer, usage


def parse_claude(path: Path):
    calls, reads, file_reads, answer, usage = [], 0, 0, "", {}
    for line in path.read_text().splitlines():
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        t = r.get("type")
        if t == "assistant":
            for block in r.get("message", {}).get("content", []):
                if block.get("type") == "tool_use":
                    name = block.get("name", "")
                    if name.startswith("mcp__yats__"):
                        calls.append({"tool": name.removeprefix("mcp__yats__"), "args": block.get("input", {})})
                    elif name == "Read":
                        file_reads += 1  # targeted read at YATS-returned lines — by design
                    elif name in ("Bash", "Grep", "Glob", "WebSearch", "WebFetch"):
                        if name == "Bash" and is_startup_check(name, block.get("input", {})):
                            continue
                        reads += 1
        elif t == "result":
            usage = r.get("usage", {})
            answer = r.get("result", "")
            if r.get("total_cost_usd") is not None:
                usage["total_cost_usd"] = r["total_cost_usd"]
    usage["_file_reads"] = file_reads
    return calls, reads, answer, usage


def parse(path: Path):
    if not path.exists():
        return None
    name = str(path)
    if "claude" in name:
        return parse_claude(path)
    if "copilot" in name:
        return parse_copilot(path)
    if "/pi/" in name:
        return parse_pi(path)
    return parse_codex(path)


NO_ARG_TOOLS = {"list_repositories", "rebuild_vectors"}


def has_path_arg(args) -> bool:
    p = args.get("path") or args.get("repository") or ""
    return str(p).startswith("/")


def path_ok(call) -> bool:
    if call["tool"] in NO_ARG_TOOLS:
        return True
    return has_path_arg(call["args"])


def total_input(usage):
    if not usage:
        return 0
    return (usage.get("input_tokens", 0)
            + usage.get("cache_read_input_tokens", 0)
            + usage.get("cache_creation_input_tokens", 0)
            + usage.get("inputTokens", 0))


def mean(values):
    return sum(values) / len(values) if values else 0


def aggregate(files):
    """Parse every run of a condition and aggregate: means for counts/tokens,
    pass-rates for binary criteria (multi-run averages out single-run noise)."""
    runs = []
    for f in files:
        parsed = parse(Path(f))
        if parsed is None:
            continue
        calls, reads, answer, usage = parsed
        runs.append(dict(
            file=Path(f).name,
            calls=calls, reads=reads, answer=answer, usage=usage,
            n=len(calls),
            # startup checks (list_repositories / yats list) don't count:
            # first SUBSTANTIVE call must be a search tool
            first_is_search=next((c["tool"] in ("search_code", "search_documentation")
                                  for c in calls if c["tool"] != "list_repositories"), False),
            all_have_path=len(calls) > 0 and all(path_ok(c) for c in calls),
            within_budget=len([c for c in calls if c["tool"] != "list_repositories"]) <= 4,
            inp=total_input(usage),
            out=usage.get("output_tokens", 0) if usage else 0,
            file_reads=(usage or {}).get("_file_reads", 0),
        ))
    if not runs:
        return None
    rate = lambda pred: sum(1 for r in runs if pred(r)) / len(runs)
    cost = None
    for r in runs:
        u = r["usage"]
        if not u:
            continue
        if u.get("total_cost_usd") is not None:
            cost = f"${u['total_cost_usd']:.4f} (agent-reported)"
            break
        if u.get("totalNanoAiu") is not None or u.get("totalPremiumRequests") is not None:
            cost = f"AIU={u.get('totalNanoAiu', 0)}, premiumRequests={u.get('totalPremiumRequests', 0)}"
            break
    return dict(
        runs=len(runs),
        sample_calls=runs[0]["calls"],
        mean_calls=mean([r["n"] for r in runs]),
        first_rate=rate(lambda r: r["first_is_search"]),
        path_rate=rate(lambda r: r["all_have_path"]),
        budget_rate=rate(lambda r: r["within_budget"]),
        zero_fallback_rate=rate(lambda r: r["reads"] == 0),
        mean_reads=mean([r["reads"] for r in runs]),
        mean_file_reads=mean([r["file_reads"] for r in runs]),
        mean_in=mean([r["inp"] for r in runs]),
        mean_out=mean([r["out"] for r in runs]),
        answers=[r["answer"] for r in runs],
        cost=cost,
    )


def main():
    files = sys.argv[1:]
    expects_file = None
    if files and files[0].endswith(".expects"):
        expects_file, files = files[0], files[1:]
    with_yats = sorted(f for f in files if "with-yats" in f)
    without_yats = sorted(f for f in files if "without-yats" in f)

    w = aggregate(with_yats) if with_yats else None
    b = aggregate(without_yats) if without_yats else None
    failures = []

    print("=" * 62)
    print("TEST-CONNECT SCORECARD")
    print("=" * 62)

    if w:
        print(f"\n[with-yats] {w['runs']} run(s)")
        print(f"  YATS tool calls: mean {w['mean_calls']:.1f}")
        for c in w["sample_calls"]:
            p = "path✓" if path_ok(c) else "path✗"
            print(f"    - {c['tool']} ({p})")
        print(f"  Fallback (shell/web/read): mean {w['mean_reads']:.1f}")
        if w.get("mean_file_reads"):
            print(f"  Targeted file reads (Read at YATS lines — by design): mean {w['mean_file_reads']:.1f}")
        print(f"  Tokens: in≈{w['mean_in']:,.0f} out≈{w['mean_out']:,.0f}")
        if w["cost"]:
            print(f"  Cost reported by agent: {w['cost']}")
        else:
            print("  Cost: not reported (derive from provider pricing)")

        checks = [
            ("uses YATS tools", w["mean_calls"] >= 1),
            (f"starts with search_code/search_documentation ({w['first_rate']:.0%} of runs)", w["first_rate"] == 1),
            (f"passes path= on every call ({w['path_rate']:.0%} of runs)", w["path_rate"] == 1),
            (f"respects ≤4-call budget ({w['budget_rate']:.0%} of runs)", w["budget_rate"] == 1),
            (f"no fallback to shell/web ({w['zero_fallback_rate']:.0%} of runs)", w["zero_fallback_rate"] == 1),
        ]
        for name, ok in checks:
            print(f"  {'✅' if ok else '❌'} {name}")
            if not ok:
                failures.append(name)

    if w and b:
        print(f"\n[without-yats] {b['runs']} run(s)")
        print(f"  Fallback (shell/web/read): mean {b['mean_reads']:.1f}")
        print(f"  Tokens: in≈{b['mean_in']:,.0f} out≈{b['mean_out']:,.0f}")
        if b["mean_in"]:
            sav = (b["mean_in"] - w["mean_in"]) / b["mean_in"] * 100
            print(f"\n  💰 input-token savings: {sav:.1f}%")

    if expects_file and w and Path(expects_file).exists():
        expected = [k.strip() for k in Path(expects_file).read_text().split(",")]
        ok_runs = sum(1 for ans in w["answers"] if all(k.lower() in (ans or "").lower() for k in expected))
        print(f"\n[answer] expects: {', '.join(expected)} — correct in {ok_runs}/{len(w['answers'])} runs")
        print(f"  {'✅' if ok_runs == len(w['answers']) else '❌'}")
        if ok_runs < len(w["answers"]):
            failures.append("answer missing keywords in some runs")

    print("\n" + ("❌ FAIL" if failures else "✅ PASS"))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
