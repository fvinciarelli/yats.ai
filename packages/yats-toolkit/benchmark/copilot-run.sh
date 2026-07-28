#!/bin/bash
# Wrapper script to run Copilot CLI with MCP auto-approval

# Create settings with auto-approval
mkdir -p ~/.copilot
cat > ~/.copilot/settings.json << 'EOF'
{
  "mcp": {
    "autoApprove": true,
    "trustedServers": ["yats"]
  },
  "permissions": {
    "allowAllTools": true,
    "mcp": {
      "yats": {
        "allowed": true,
        "autoApprove": true
      }
    }
  }
}
EOF

# Run copilot with the provided arguments
timeout 45 copilot --allow-all "$@"
