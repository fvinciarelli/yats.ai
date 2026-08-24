# Cursor — YATS Setup

Install from your repo root:

```bash
yats connect --install cursor
```

This creates/updates:

| File | Purpose |
|------|---------|
| `.cursor/rules/rules.mdc` | Teaches Cursor to use YATS tools before reading files |
| `.cursor/mcp.json` | Connects Cursor to the YATS MCP server (your existing entries are preserved) |

Existing files are never overwritten: `rules.mdc` gets an appended YATS block
after confirmation, and `.cursor/mcp.json` entries are merged.

See the full docs at https://github.com/fvinciarelli/yats.ai/tree/main/connect/cursor
