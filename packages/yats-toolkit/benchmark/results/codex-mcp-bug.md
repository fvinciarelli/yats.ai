# Codex MCP Bug — RunningService dropped prematurely

## Symptom
Codex CLI 0.145.0 connects to YATS MCP server, completes initialize/tools/list successfully, 
but drops the MCP transport ~5 seconds later without ever calling tools/call.

## Log evidence (identical across all attempts)
```
23:17:03  INFO Service initialized as client (protocol 2025-03-26, 20 tools)
23:17:04  POST tools/list → OK
23:17:08  DEBUG RunningService dropped without explicit close()
23:17:08  INFO  task cancelled
23:17:08  DEBUG streamable_http_client: cancelled
23:17:08  INFO  delete session success
23:17:08  DEBUG worker quit with reason: Cancelled
```

## Root cause
The `RunningService` in `rmcp` (Rust MCP SDK) has a `Drop` implementation that cancels the 
transport asynchronously when the client struct is dropped without calling `.close()`:

```rust
// crates/rmcp/src/service.rs – modelcontextprotocol/rust-sdk
impl Drop for RunningService {
    fn drop(&mut self) {
        if self.handle.is_some() && !self.cancellation_token.is_cancelled() {
            tracing::debug!(
                "RunningService dropped without explicit close(). \
                 The connection will be closed asynchronously. \
                 For guaranteed cleanup, call close() or cancel() before dropping."
            );
        }
    }
}
```

Codex drops the RmcpClient after list_tools() completes, but the LLM hasn't decided which 
tool to call yet. The async Drop closes the SSE → sends DELETE → tools/call never arrives.

The drain timeout in serve_inner explains the exact 5-second delay:
```rust
let drain_timeout = match &quit_reason {
    QuitReason::Closed => Some(Duration::from_secs(5)),
    QuitReason::Cancelled => Some(Duration::from_secs(2)),
    _ => None,
};
```

## References

### rmcp SDK PR that added the Drop behavior
https://github.com/modelcontextprotocol/rust-sdk/pull/136
("fix: fix resource leak when RunningService is dropped")

### RunningService Drop implementation
https://github.com/modelcontextprotocol/rust-sdk/blob/80a74795/crates/rmcp/src/service.rs

### Known issue: gh-aw-firewall Smoke Codex failed (identical logs)
https://github.com/github/gh-aw-firewall/issues/3808

### Lucid MCP community report (same Transport channel closed error)
https://community.lucid.co/developer-community-6/codex-with-lucid-mco-13025

### Codex rmcp_client.rs (how RmcpClient initializes and uses RunningService)
https://github.com/openai/codex/blob/main/codex-rs/rmcp-client/src/rmcp_client.rs

### MCP Streamable HTTP transport discussion
https://github.com/modelcontextprotocol/rust-sdk/issues/177

## Status
- YATS MCP server: COMPLIANT — initialize, tools/list, SSE, Mcp-Session-Id, keepalive all correct
- Codex 0.145.0: BROKEN — drops MCP client before LLM decides on tool call
- No fix available in 0.145.0
- Workaround: none for HTTP transport. stdio transport also broken in config management.
