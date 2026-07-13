# ChatGPT Conveyor Connector Setup

Updated: 2026-06-25

## Local Server

Install `mira-mcp` dependencies in the environment you use for MCP work:

```powershell
cd C:\Users\hharp\Documents\GitHub\MIRA\mira-mcp
python -m pip install -r requirements.txt
```

Run the external AI conveyor server:

```powershell
cd C:\Users\hharp\Documents\GitHub\MIRA\mira-mcp
$env:FACTORYLM_EXTERNAL_AI_PORT = "8012"
python -m factorylm_external_ai.mcp_server
```

Local MCP endpoint:

```text
http://localhost:8012/mcp
```

## Optional Live Values For Demo

For a static local demo without the relay online, inject safe read-only values:

```powershell
$env:FACTORYLM_LIVE_VALUES_JSON = '{"default_conveyor_motor_running":{"value":false,"quality":"good","freshness_status":"fresh","last_seen_at":"2026-06-25T12:00:00Z"},"default_conveyor_fault_alarm":{"value":true,"quality":"good","freshness_status":"fresh","last_seen_at":"2026-06-25T12:00:00Z"},"default_mira_iocheck_vfd_vfd_frequency":{"value":0.0,"quality":"good","freshness_status":"fresh","last_seen_at":"2026-06-25T12:00:00Z"}}'
```

This is only a local simulation of the SDK boundary. The real path must read from the approved live-value store.

## Test With MCP Inspector

```powershell
npx @modelcontextprotocol/inspector@latest --server-url http://localhost:8012/mcp --transport http
```

Verify the advertised tools are only `factorylm_*` read-only tools.

## Expose For ChatGPT Development

Use one of:

- Secure MCP Tunnel from OpenAI docs.
- ngrok.
- Cloudflare Tunnel.

Example with ngrok:

```powershell
ngrok http 8012
```

Use the HTTPS URL with `/mcp`, for example:

```text
https://abc123.ngrok.app/mcp
```

Do not put tunnel tokens or connector secrets in the repo.

## Create The ChatGPT Connector

1. Open ChatGPT web.
2. Enable developer mode under Settings -> Apps & Connectors -> Advanced settings.
3. Go to Settings -> Connectors -> Create.
4. Name: `FactoryLM Garage Conveyor`.
5. Description: `Read-only FactoryLM connector for approved garage conveyor context, evidence, diagnostics, and live values. No controls or writes.`
6. Connector URL: the HTTPS tunnel URL ending in `/mcp`.
7. Create the connector and confirm ChatGPT lists the `factorylm_*` tools.
8. Open a new chat, enable the connector from the tool picker, then ask: `What is my conveyor doing right now?`

Expected result: ChatGPT calls `factorylm_get_conveyor_status` or a combination of asset/tag/live-value tools and answers from structured FactoryLM data.

## Customer Version Differences

Before exposing customer data:

- Add OAuth 2.1 or scoped API-key auth.
- Enforce tenant/site/asset permissions in the SDK.
- Read live values only through approved tags and current-state cache.
- Add audit logging for every MCP request and tool call.
- Add rate limiting.
- Add admin UI for which assets/tags/documents are available to external AI clients.
