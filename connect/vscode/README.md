# VS Code (native MCP) — YATS Setup

Install from your repo root:

```bash
yats connect --install vscode
```

This creates/updates:

| File | Purpose |
|------|---------|
| `.vscode/mcp.json` | Workspace-scoped MCP config for VS Code's native chat (Copilot Chat or any client of the VS Code MCP hub), using the `servers` format |

Existing files are never overwritten: the `servers` entries you already have
are preserved and only the `yats` entry is added or updated.

> **Note on PATH:** VS Code launched from the desktop may not inherit the
> shell PATH where `yats` is installed (`~/.yats/bin`). If the server fails
> to start, replace `"command": "yats"` with `"command": "npx"` and
> `"args": ["-y", "yats-toolkit", "bridge"]`.

See the full docs at https://github.com/fvinciarelli/yats.ai/tree/main/connect/vscode
