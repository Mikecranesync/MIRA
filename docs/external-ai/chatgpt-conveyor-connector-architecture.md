# ChatGPT Conveyor Connector Architecture

Updated: 2026-06-25

## Target

ChatGPT on phone
-> FactoryLM custom connector / MCP app
-> Remote FactoryLM MCP server
-> FactoryLM Context SDK
-> approved conveyor namespace/context/evidence
-> optional safe live read-only service
-> structured answer back to ChatGPT

ChatGPT never talks directly to the PLC, database, or raw files. It only calls governed FactoryLM MCP tools.

## First Demo Implementation

Code added:

- `mira-mcp/factorylm_external_ai/conveyor_context.py`
- `mira-mcp/factorylm_external_ai/mcp_server.py`
- `mira-mcp/tests/test_factorylm_external_ai.py`

The first slice is intentionally narrow. It uses approved garage-conveyor context already represented by the repo's garage conveyor seed/golden-path work and wraps it as read-only structured tool responses.

## Tool Surface

Required demo tools:

- `factorylm_find_asset`
- `factorylm_get_asset_context`
- `factorylm_list_asset_tags`
- `factorylm_get_tag_context`
- `factorylm_search_evidence`
- `factorylm_list_related_assets`
- `factorylm_get_diagnostic_context`
- `factorylm_get_live_value`
- `factorylm_get_conveyor_status`

Every tool descriptor is marked:

- `readOnlyHint: true`
- `destructiveHint: false`
- `openWorldHint: false`
- `idempotentHint: true`

## Response Contract

Every response should include, where applicable:

- `status`
- `asset_id`
- `asset_name`
- `uns_path`
- `asset`
- `tags`
- `live_value`
- `quality`
- `freshness_status`
- `related_documents`
- `evidence`
- `citations`
- `confidence`
- `approval_status`
- `warnings`

Missing values are explicit. Draft/unapproved evidence is hidden by default.

## Live Values

The current implementation supports injected safe read-only live values through `FACTORYLM_LIVE_VALUES_JSON` or direct SDK construction in tests. This is a placeholder boundary for the real safe path:

- Ignition or approved source posts HMAC-signed values to `mira-relay`.
- `mira-relay` enforces `approved_tags` fail-closed.
- Relay writes `tag_events` and `live_signal_cache`.
- The FactoryLM Context SDK reads only approved current-state values and returns value/quality/freshness.

The SDK layer must not accept arbitrary tag paths from ChatGPT unless they map to an approved tag in FactoryLM.

## Safety Boundary

This connector is data-only:

- It exposes no write tools.
- It exposes no start/stop/reset tools.
- It exposes no raw query tools.
- It does not expose the PLC network, Neon connection strings, files, or broad exports.
- Diagnostics are context and next-check oriented, not control/action execution.

## Phase Gaps

Done in this slice:

- Local SDK-backed conveyor context tools.
- MCP tool metadata for the ChatGPT connector surface.
- Tests for read-only tool exposure, asset lookup, tag lookup, evidence gating, diagnostics, live-value behavior, missing values, and status summary.

Still needed for true Definition of Done:

- Wire live-value provider to the existing approved `live_signal_cache` read path.
- Run a real FastMCP server in the `mira-mcp` container or local venv where `fastmcp` is installed.
- Expose HTTPS with Secure MCP Tunnel, ngrok, or Cloudflare Tunnel.
- Create the ChatGPT developer connector and verify an actual tool call from ChatGPT.
- Add auth before any customer data is exposed outside a private demo tunnel.
