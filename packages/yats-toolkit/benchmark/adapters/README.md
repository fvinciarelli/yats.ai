# MCP → OpenAI Bridge

For agents that don't have native MCP support (Aider, Codex when MCP is broken),
the benchmark uses an adapter that translates MCP tools into OpenAI function calling format.

## How it works

```
Agent (Aider/Codex)
    ↓  OpenAI-compatible API calls
Bridge (mcpm-aider)
    ↓  MCP JSON-RPC
YATS MCP Server (localhost:5555)
    ↓
Neo4j + Qdrant
```

1. **Bridge starts** — connects to YATS MCP server, fetches tool definitions
2. **Agent connects** — uses bridge as OpenAI-compatible API endpoint
3. **Tool discovery** — bridge translates MCP tools to OpenAI function definitions
4. **Tool execution** — when the LLM calls a tool, bridge routes it to YATS MCP
5. **Transparent** — the agent thinks it's calling native OpenAI functions

## Setup

```bash
# Install the bridge (one-time)
pip install mcpm-aider

# The benchmark handles starting/stopping the bridge automatically.
# No manual configuration needed if YATS MCP is running on localhost:5555.
```

## Port

Default bridge port is 8000. Override with:

```bash
export YATS_BRIDGE_PORT=9000
```

## Agents that use the bridge

| Agent | Native MCP? | Uses bridge? |
|-------|------------|-------------|
| Claude CLI | ✅ Yes | No |
| Cursor | ✅ Yes | No |
| Copilot CLI | ✅ Yes | No |
| Codex | ⚠️ Broken | Yes (codex-bridge) |
| Aider | ❌ No | Yes (aider) |

## Troubleshooting

### "mcpm-aider not found"
```bash
pip install mcpm-aider
```

### "Bridge process died"
Check the bridge log:
```bash
cat /tmp/yats-bench-bridge.log
```

Common causes:
- YATS MCP server not running (`curl http://localhost:5555/health`)
- Port 8000 already in use (`export YATS_BRIDGE_PORT=9000`)
- Missing API keys (ANTHROPIC_API_KEY or OPENAI_API_KEY not set)
