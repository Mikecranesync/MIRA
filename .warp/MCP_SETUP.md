# Warp MCP Setup — mira-mcp

Add mira-mcp as a local MCP server so Warp's Oz agent has access to MIRA's
equipment diagnostic tools and CMMS integration.

## Prerequisites

- mira-mcp container running (`bash install/up.sh`)
- Doppler secret `MCP_REST_API_KEY` value handy: `doppler secrets get MCP_REST_API_KEY --project factorylm --config prd --plain`

## Steps

1. Open Warp → **Settings** → **AI** → **MCP Servers** → **Add Server**
2. Choose **SSE** connection type
3. Fill in:
   - **Name:** `mira-mcp`
   - **URL:** `http://localhost:8009/sse`
   - **Headers:** `Authorization: Bearer <value of MCP_REST_API_KEY>`
4. Save. Restart Warp agent if prompted.

## Verify

In Warp agent mode, ask: *"What MCP tools are available?"*
Should list MIRA's diagnostic + CMMS tools.

Or test the SSE endpoint directly:
```bash
curl -s http://localhost:8009/sse -H "Authorization: Bearer $(doppler secrets get MCP_REST_API_KEY --project factorylm --config prd --plain)"
```

## Port Reference

| Host port | Container port | What |
|-----------|---------------|------|
| 8009 (default, or $MCP_SSE_PORT) | 8000 | FastMCP SSE — used by Warp |
| 8001 | 8001 | REST health + API |
