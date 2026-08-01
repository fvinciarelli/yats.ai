# YATS — Yet Another Token Saver

> **Cut your AI coding costs by more than 50%.** YATS indexes your codebase into a knowledge graph. Your agent queries the graph instead of reading files one by one — and gets answers in milliseconds.

---

## Your agent is slow. It's not its fault.

Every time your agent needs to understand your code, it does the same brute-force ritual: grep for keywords, read file after file, guess how things connect. That's not intelligence — that's a token bonfire. And you're paying for every spark.

```
100,000 tokens to answer "how does auth work here?"
15 files read
Zero understanding of relationships
```

---

## YATS gives your agent a map, not a pile of paper

We index your entire codebase into a **knowledge graph**: every function, class, interface, and relationship across TypeScript, C#, Python, PHP, and Go. When your agent needs answers, it queries the graph — not the raw files.

**The best part: you don't index manually.** When your agent connects to YATS and starts working in a directory, the first thing it does is check if that project is indexed. If not, it indexes it automatically. No extra step. No remembering to run a command.

```
Agent enters your project
  → "Is this indexed?" → No
  → Indexes it automatically (analyzers parse every file, build the graph)
  → Done. Now every query hits the graph.

3,000 tokens. Two tool calls. Exactly right.
```

You *can* index manually via `yats index ~/my-project` if you want. But your agent handles it.

---

## Don't trust us. Reproduce it yourself.

Every benchmark we publish comes with the full tooling to replicate it — same questions, same repos, same methodology. No cherry-picking. No black boxes.

**And it works on your own code too.** Unlike benchmarks that only test popular open-source repos (which LLMs might already know from training), YATS lets you measure savings on *your* private projects — the code your agent actually works with every day.

```bash
yats benchmark
```

Interactive wizard. In 5 steps:

1. Pick your agent — Cursor, Claude, Copilot, Codex, or Gemini
2. Pick a language and repo — or point it at your own project
3. The wizard indexes it automatically
4. Your agent answers the same questions twice — with and without YATS
5. You get a side-by-side comparison: tokens, credits, cost

[Full benchmark suite and raw data →](https://github.com/fvinciarelli/yats/tree/master/packages/yats-toolkit/benchmark)

---

## Our results (that you can verify)

Same questions. Same repos. Fresh sessions. Every token counted.

| Agent | Repo indexed | Language | Without YATS | With YATS | You save |
|-------|-------------|----------|-------------|-----------|----------|
| Codex | lab_hub (API backend) | Go | 100,000 tokens | 27,000 tokens | **73%** |
| Copilot | lab_hub (API backend) | Go | 1.19 credits | 0.40 credits | **66%** |
| Claude | lab_hub (API backend) | Go | 862k tokens · $0.21 | 541k tokens · $0.11 | **37%** tokens · **49%** cost |
| Gemini | Django (web framework) | Python | 115,122 tokens | 63,851 tokens | **45%** |

> Run `yats benchmark` and get your own row in this table.

---

## Your codebase, understood

Not grep. Not regex. Actual parsers that understand your code like an IDE does.

```
TypeScript → Compiler API (full AST)
C#         → Roslyn (.NET 8 bridge)
Python     → LibCST + Jedi
PHP        → nikic/php-parser
Go         → Native bridge
Everything → Tree-sitter fallback
```

---

## Your agent, supercharged

Instead of reading 15 files, your agent calls:

| What the agent needs | Tool it calls |
|---------------------|---------------|
| "How does auth work?" | `search_code("authentication flow")` |
| "Who calls this?" | `find_callers("PaymentService.process")` |
| "Show me the API" | `find_routes` |
| "Architecture overview?" | `architecture_summary` |
| "Where are the tests?" | `find_tests("UserService")` |
| "What's connected to this?" | `expand_graph(symbolId)` |

[All 22 tools →](https://github.com/fvinciarelli/yats#mcp-tools-20)

---

## The right instructions make the difference

YATS only saves tokens if your agent *knows* to use the graph instead of reading files. That's why we include ready-to-use instruction files for every agent — they teach it to call `search_code` before `grep`, to expand the graph instead of guessing relationships, to trust the index.

```bash
# 1. Start YATS (needs Docker)
npx yats-toolkit

# 2. Connect your agent — copy two files into your repo
```

| Your agent | Copy these | Into |
|-----------|------------|------|
| Claude Code | `SKILL.md` + `mcp.json` | `.claude/skills/yats/` + `.mcp.json` |
| Gemini CLI | `GEMINI.md` + `mcp.json` | repo root + `.gemini/settings.json` |
| Copilot CLI | `instructions.md` + `mcp.json` | `.github/` + `.copilot/` |
| Codex CLI | `AGENTS.md` + `config.toml` | repo root + `.codex/` |
| Cursor | `rules.mdc` + `mcp.json` | `.cursor/rules/` + `.cursor/` |

[Step-by-step for each agent →](https://github.com/fvinciarelli/yats/tree/master/connect)

That's it. Your agent now enters your project, auto-indexes it, and queries the graph instead of reading files.

---

## Free for teams under 25 developers

No catch. No trial. Just install it.

[GitHub](https://github.com/fvinciarelli/yats) · [npm](https://www.npmjs.com/package/yats-toolkit) · [License](https://github.com/fvinciarelli/yats/blob/master/LICENSE)
