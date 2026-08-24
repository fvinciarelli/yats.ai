# Claude Code — YATS Setup

Install from your repo root:

```bash
yats connect --install claude
```

This creates/updates:

| File | Purpose |
|------|---------|
| `.claude/skills/yats/SKILL.md` | Teaches Claude the YATS golden rule and efficient workflow (search_code → expand_graph → read) |
| `.mcp.json` | Connects Claude to the YATS MCP server (your existing entries are preserved) |

Existing files are never overwritten: the skill is appended without its
frontmatter (after confirmation), and `.mcp.json` entries are merged.

See the full docs at https://github.com/fvinciarelli/yats.ai/tree/main/connect/claude
