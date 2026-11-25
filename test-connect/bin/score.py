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


def parse_claude(path: Path):
    calls, reads, answer, usage = [], 0, "", None
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
                    elif name in ("Read", "Bash", "Grep", "Glob"):
                        reads += 1
        elif t == "result":
            usage = r.get("usage", {})
            answer = r.get("result", "")
            if r.get("total_cost_usd") is not None:
                usage["total_cost_usd"] = r["total_cost_usd"]
    return calls, reads, answer, usage


def parse(path: Path):
    if not path.exists():
        return None
    name = str(path)
    if "claude" in name:
        return parse_claude(path)
    if "copilot" in name:
        return parse_copilot(path)
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


def main():
    files = sys.argv[1:]
    expects_file = None
    if files and files[0].endswith(".expects"):
        expects_file, files = files[0], files[1:]
    with_yats = next((f for f in files if "with-yats" in f), None)
    without_yats = next((f for f in files if "without-yats" in f), None)

    results = {}
    for label, f in (("with-yats", with_yats), ("without-yats", without_yats)):
        if not f:
            continue
        calls, reads, answer, usage = parse(Path(f))
        n = len(calls)
        first_is_search = n > 0 and calls[0]["tool"] in ("search_code", "search_documentation")
        all_have_path = n > 0 and all(path_ok(c) for c in calls)
        within_budget = n <= 5
        inp = total_input(usage)
        out = usage.get("output_tokens", 0) if usage else 0
        cost = None
        if usage:
            if usage.get("total_cost_usd") is not None:
                cost = f"${usage['total_cost_usd']:.4f} (agent-reported)"
            elif usage.get("totalNanoAiu") is not None or usage.get("totalPremiumRequests") is not None:
                cost = (f"AIU={usage.get('totalNanoAiu', 0)}, "
                        f"premiumRequests={usage.get('totalPremiumRequests', 0)}")
        results[label] = dict(
            calls=calls, reads=reads, answer=answer,
            n_yats=n, first_is_search=first_is_search,
            all_have_path=all_have_path, within_budget=within_budget,
            input_tokens=inp, output_tokens=out, cost=cost,
        )

    w = results.get("with-yats")
    failures = []

    print("=" * 62)
    print("TEST-CONNECT SCORECARD")
    print("=" * 62)

    if w:
        print(f"\n[with-yats] {Path(with_yats).name}")
        print(f"  YATS tool calls: {w['n_yats']}")
        for c in w["calls"]:
            p = "path✓" if path_ok(c) else "path✗"
            print(f"    - {c['tool']} ({p})")
        print(f"  Fallback (shell/web/read): {w['reads']}")
        print(f"  Tokens: in={w['input_tokens']:,} out={w['output_tokens']:,}")
        cost = w.get("cost")
        if cost:
            print(f"  Cost reported by agent: {cost}")
        else:
            print("  Cost: not reported (derive from provider pricing)")

        checks = [
            ("uses YATS tools", w["n_yats"] >= 1),
            ("starts with search_code / search_documentation", w["first_is_search"]),
            ("passes path= on every call", w["all_have_path"]),
            ("respects 3-5 call budget", w["within_budget"]),
            ("does not fall back to shell/web", w["reads"] == 0),
        ]
        for name, ok in checks:
            print(f"  {'✅' if ok else '❌'} {name}")
            if not ok:
                failures.append(name)

    if w and results.get("without-yats"):
        b = results["without-yats"]
        print(f"\n[without-yats] {Path(without_yats).name}")
        print(f"  Fallback (shell/web/read): {b['reads']}")
        print(f"  Tokens: in={b['input_tokens']:,} out={b['output_tokens']:,}")
        if b["input_tokens"]:
            sav = (b["input_tokens"] - w["input_tokens"]) / b["input_tokens"] * 100
            print(f"\n  💰 input-token savings: {sav:.1f}%")

    if expects_file and w and Path(expects_file).exists():
        expected = [k.strip() for k in Path(expects_file).read_text().split(",")]
        missing = [k for k in expected if k.lower() not in (w["answer"] or "").lower()]
        print(f"\n[answer] expects: {', '.join(expected)}")
        print(f"  {'✅' if not missing else '❌ missing: ' + ', '.join(missing)}")
        if missing:
            failures.append(f"answer missing {missing}")

    print("\n" + ("❌ FAIL" if failures else "✅ PASS"))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
