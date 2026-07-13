# ChatGPT Conveyor Connector Research

Updated: 2026-06-25

Goal: make "Chat with my conveyor from ChatGPT on my phone" work through a governed FactoryLM MCP connector. ChatGPT must call only approved, read-only FactoryLM tools. It must not connect directly to the PLC, NeonDB, raw files, Ignition internals, or any write/control path.

## Sources Reviewed

- OpenAI Apps SDK quickstart: https://developers.openai.com/apps-sdk/quickstart
- OpenAI Apps SDK MCP server guide: https://developers.openai.com/apps-sdk/build/mcp-server
- OpenAI Connect from ChatGPT guide: https://developers.openai.com/apps-sdk/deploy/connect-chatgpt
- OpenAI Apps SDK auth guide: https://developers.openai.com/apps-sdk/build/auth
- OpenAI MCP server guide: https://developers.openai.com/api/docs/mcp
- OpenAI Apps SDK reference: https://developers.openai.com/apps-sdk/reference

## 1. What ChatGPT Requires

ChatGPT connects to a custom app/connector through a reachable MCP server. OpenAI's quickstart says Apps SDK apps use MCP to connect to ChatGPT and require an MCP server that defines tools and exposes them to ChatGPT. A UI iframe is optional.

For this conveyor demo, the minimum is:

- A remote MCP endpoint, conventionally `/mcp`.
- MCP tool descriptors with clear names, descriptions, input schemas, annotations, and output schemas.
- Tool handlers that return structured results. If a tool returns `structuredContent`, the Apps SDK reference says to declare `outputSchema`.
- Read-only annotations. The Apps SDK reference lists `readOnlyHint`, `destructiveHint`, and `openWorldHint`; these matter because ChatGPT uses app tool annotations and user permissions when deciding how to call tools.
- Developer mode enabled in ChatGPT, then a connector created under Settings -> Connectors -> Create.

## 2. Does This Need HTTPS?

Yes for ChatGPT development and use. OpenAI's Connect from ChatGPT guide says the MCP server must be reachable over HTTPS. For local work, it recommends Secure MCP Tunnel or public tunnels such as ngrok or Cloudflare Tunnel. The connector URL should be the public HTTPS `/mcp` endpoint.

Local-only HTTP is useful for MCP Inspector, but ChatGPT itself needs a public HTTPS URL unless using the Secure MCP Tunnel flow.

## 3. Supported Transports

OpenAI's current quickstart server example exposes `/mcp` over Streamable HTTP using the MCP SDK. The OpenAI MCP server guide also includes an SSE FastMCP example for remote MCP server work. Existing MIRA `mira-mcp/server.py` already runs both:

- SSE on `FASTMCP_PORT` for legacy clients.
- Streamable HTTP on `FASTMCP_HTTP_PORT` for modern clients.

For this demo, use Streamable HTTP at `/mcp` as the primary ChatGPT path. Keep SSE as compatibility only if needed by non-ChatGPT clients.

## 4. Auth Options

OpenAI's Apps SDK auth guide describes OAuth 2.1 for authenticated MCP servers. ChatGPT supports:

- OAuth authorization-code flow with PKCE.
- Protected resource metadata on the MCP server.
- OAuth/OIDC authorization server discovery.
- Client ID Metadata Documents (CIMD).
- Dynamic client registration (DCR).
- Predefined OAuth clients.
- Bearer access tokens on subsequent MCP requests.

The OpenAI MCP guide also recommends OAuth with CIMD for custom remote MCP servers where supported.

For the first private conveyor demo, the simplest safe path is one of:

- No auth, but only on an ephemeral private tunnel to a demo-only server that exposes non-sensitive seed data.
- A simple bearer-token or tunnel-level access control during local testing, recognizing that full ChatGPT connector auth should move to OAuth before customer use.

Do not hardcode tokens in the repo. Use Doppler or local environment variables.

## 5. Simplest Local/Private Development Path

1. Run the FactoryLM external AI MCP server locally on a non-conflicting port.
2. Verify it with MCP Inspector against `http://localhost:<port>/mcp`.
3. Expose it with Secure MCP Tunnel, ngrok, or Cloudflare Tunnel.
4. In ChatGPT web, enable developer mode under Settings -> Apps & Connectors -> Advanced settings.
5. Create a connector under Settings -> Connectors -> Create.
6. Paste the HTTPS tunnel URL ending in `/mcp`.
7. Create a new ChatGPT conversation, enable the connector in the tool picker, then ask: "What is my conveyor doing right now?"
8. Confirm ChatGPT calls `factorylm_get_conveyor_status` or `factorylm_get_live_value` and answers from structured FactoryLM data.

OpenAI notes that once the connector is linked on ChatGPT web, it is available on ChatGPT mobile apps.

## 6. Customer/Enterprise Changes Later

The customer version needs more than a tunnel:

- Cloud-hosted MCP endpoint, likely `https://mcp.factorylm.com/mcp` or tenant-scoped equivalent.
- OAuth 2.1 with PKCE and scoped access tokens.
- Tenant/site/asset permissions enforced before each tool call.
- Audit logs for every tool call, asset lookup, evidence read, and live-value read.
- Rate limiting and quotas.
- Admin approval for which assets, documents, tags, and live values are exposed.
- Per-site connector configuration.
- Connector publishing/versioning and app review.
- Stable output schemas and backward-compatible tool evolution.

## 7. Safety Restrictions For Factory Data

FactoryLM's external AI connector must be read-only and governed:

- No PLC writes.
- No conveyor start/stop/reset commands.
- No tag writes.
- No control actions.
- No raw SQL exposed to ChatGPT.
- No broad database dumps.
- No unapproved document leakage.
- No cross-tenant leakage.
- No hallucinated fields.
- Missing values must be explicit.
- Live values must include quality/freshness when available.
- Evidence and diagnostics must include approval status and citations.
- Troubleshooting output must avoid instructions that imply live work; safety-sensitive work must route through normal site procedures and LOTO language.

The first demo is therefore a "data-only app" in OpenAI's terminology: it exposes approved context and safe live reads, not controls.
