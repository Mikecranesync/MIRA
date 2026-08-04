# FactoryLM Context Codex Plugin

Private/internal plugin package for FactoryLM external AI development.

This plugin currently bundles the `factorylm-context-bridge` skill. It does not
yet bundle MCP server configuration because the dedicated read-only MCP server
has not been implemented.

Current contents:

- `.codex-plugin/plugin.json`
- `skills/factorylm-context-bridge/SKILL.md`
- `skills/factorylm-context-bridge/references/tool-selection.md`

Next packaging step:

1. Build local MCP server wrapping `POST /api/factorylm/context`.
2. Add plugin `.mcp.json`.
3. Add `mcpServers` to `.codex-plugin/plugin.json`.
4. Validate local install through a private marketplace.
