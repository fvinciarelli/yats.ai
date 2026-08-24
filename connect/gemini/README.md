# Gemini CLI — YATS Setup

Install from your repo root:

```bash
yats connect --install gemini
```

This creates/updates:

| File | Purpose |
|------|---------|
| `GEMINI.md` (repo root) | Teaches Gemini to use YATS tools before reading files |
| `.gemini/settings.json` | Connects Gemini to the YATS MCP server (your existing entries are preserved) |

Existing files are never overwritten: `GEMINI.md` gets an appended YATS block
after confirmation, and `.gemini/settings.json` entries are merged.

See the full docs at https://github.com/fvinciarelli/yats.ai/tree/main/connect/gemini
