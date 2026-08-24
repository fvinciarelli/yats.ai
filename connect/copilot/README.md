# GitHub Copilot — YATS Setup

Install from your repo root:

```bash
yats connect --install copilot
```

This creates/updates:

| File | Purpose |
|------|---------|
| `.github/copilot-instructions.md` | Teaches Copilot to use YATS tools before reading files |
| `.copilot/mcp.json` | Connects Copilot to the YATS MCP server (your existing entries are preserved) |

Existing files are never overwritten: `instructions.md` gets an appended YATS
block after confirmation, and `.copilot/mcp.json` entries are merged.

See the full docs at https://github.com/fvinciarelli/yats.ai/tree/main/connect/copilot
