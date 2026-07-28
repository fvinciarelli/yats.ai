# Claude CLI MCP Configuration

# Claude CLI usa `claude mcp add` en vez de archivo de configuración.

# Agregar YATS:
claude mcp add --transport sse yats http://localhost:5555/mcp/sse

# Verificar:
claude mcp list

# Remover si hace falta:
claude mcp remove yats
