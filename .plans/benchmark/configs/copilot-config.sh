# GitHub Copilot MCP en VS Code

# Copilot (versión 0.44+) busca MCP servers en dos lugares:

# Opción A: .vscode/mcp.json en la raíz del proyecto
# Copiá copilot-mcp.json a .vscode/mcp.json en tu proyecto:
mkdir -p .vscode
cp configs/copilot-mcp.json .vscode/mcp.json

# Opción B: VS Code settings.json
# Agregá esto a tu settings.json (Ctrl+, → "settings.json"):
# {
#   "github.copilot.chat.mcpServers": {
#     "yats": {
#       "url": "http://localhost:5555/mcp/sse"
#     }
#   }
# }

# Verificar que funciona:
# 1. Abrí VS Code en el proyecto FastAPI
# 2. Abrí Copilot Chat (Ctrl+Shift+I)
# 3. Escribí "list_repositories" — debería listar "fastapi"
# 4. Si no funciona, revisá que YATS esté corriendo: curl http://localhost:5555/health
