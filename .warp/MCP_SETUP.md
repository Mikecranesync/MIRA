# Warp MCP Setup — mira-mcp

Add mira-mcp as a local MCP server so Warp's Oz agent has access to MIRA's
equipment diagnostic tools and CMMS integration.

## Prerequisites

- mira-mcp container running (`bash install/up.sh`)
- Doppler secret `MCP_REST_API_KEY` value handy: `doppler secrets get MCP_REST_API_KEY --project factorylm --config prd --plain`

## Warp Oz Agent (streamable-http) — recommended

1. Open Warp → **Settings** → **AI** → **MCP Servers** → **+ Add**
2. Paste JSON:
   ```json
   {
     "mcpServers": {
       "mira-mcp": {
         "url": "http://localhost:8010/mcp",
         "headers": {
           "Authorization": "Bearer <MCP_REST_API_KEY>"
         }
       }
     }
   }
   ```
3. Save. Ask Oz: *"What MCP tools are available?"*

## Legacy / Claude Desktop (SSE)

1. Open Warp → **Settings** → **AI** → **MCP Servers** → **Add Server**
2. Choose **SSE** connection type
3. Fill in:
   - **Name:** `mira-mcp`
   - **URL:** `http://localhost:8009/sse`
   - **Headers:** `Authorization: Bearer <MCP_REST_API_KEY>`
4. Save. Restart Warp agent if prompted.

## Verify

```bash
# streamable-http (Warp Oz)
curl -s -o /dev/null -w "%{http_code}" http://localhost:8010/mcp \
  -H "Authorization: Bearer $(doppler secrets get MCP_REST_API_KEY --project factorylm --config prd --plain)"
# expect: 406 (correct — needs MCP Accept headers from client)

# SSE (legacy)
curl -s --max-time 3 http://localhost:8009/sse \
  -H "Authorization: Bearer $(doppler secrets get MCP_REST_API_KEY --project factorylm --config prd --plain)"
# expect: streaming connection opens
```

## Port Reference

| Host port | Container port | What |
|-----------|---------------|------|
| 8009 (`$MCP_SSE_PORT`, default) | 8000 | FastMCP SSE — legacy / Claude Desktop |
| 8010 (`$MCP_HTTP_PORT`, default) | 8002 | FastMCP streamable-http — Warp Oz agent |
| 8001 | 8001 | REST health + API |
