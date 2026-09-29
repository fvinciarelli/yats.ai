# GitHub Copilot — YATS Setup

Install from your repo root:

```bash
yats connect --install copilot
```

This creates/updates:

| File | Purpose |
|------|---------|
| `.github/copilot-instructions.md` | Teaches Copilot to use YATS tools before reading files |
| `.mcp.json` | Portable MCP config (Copilot Agent Host format, `mcpServers`) connecting Copilot to the YATS stdio bridge |

Existing files are never overwritten: `instructions.md` gets an appended YATS
block after confirmation, and `.mcp.json` entries are merged (your existing
servers are preserved).

> **Note for VS Code:** `.mcp.json` at the repo root is the portable format
> that Copilot Agent Host reads directly. VS Code's own native format is
> `.vscode/mcp.json` — use `yats connect --install vscode` for that.

See the full docs at https://github.com/fvinciarelli/yats.ai/tree/main/connect/copilot
