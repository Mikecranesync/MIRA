# Customer Connector Backlog

Updated: 2026-06-25

This backlog turns the private garage conveyor connector into a customer-facing FactoryLM external AI connector.

## P0 Before Customer Data

- OAuth 2.1 support for ChatGPT connectors, including protected resource metadata, OAuth/OIDC discovery, PKCE, and bearer token validation.
- Scoped API keys as a private-beta fallback only if OAuth is not ready.
- Tenant, site, asset, document, tag, and evidence permissions enforced before every tool handler.
- Audit log for every MCP request: tenant, user/connector, tool name, args hash, asset scope, document refs returned, status, latency, and request id.
- Rate limiting by tenant and connector.
- Admin-approved connector configuration: assets, tags, documents, diagnostics, and live values allowed for external AI clients.
- Live-value provider wired to `approved_tags` plus `live_signal_cache`; fail closed when approval/freshness cannot be verified.
- No raw SQL, no file paths, no direct PLC/Ignition credentials, and no control/write tools.
- Deterministic not-found/missing/stale responses with no guessing fallback.

## P1 Customer Private Beta

- Cloud-hosted MCP server, e.g. `https://mcp.factorylm.com/mcp`.
- Per-site connector config and connector display metadata.
- Tool schema/version compatibility tests.
- Per-tool output schemas that exactly match returned `structuredContent`.
- Customer-facing setup doc for ChatGPT web and mobile.
- Support playbook for failed connector creation, metadata refresh, OAuth failure, and stale live values.
- Connector-level observability dashboard: calls, failures, latency, stale data, denied tools, denied assets.
- Security review of prompt/tool descriptions to prevent accidental control semantics.

## P2 Enterprise Readiness

- Published ChatGPT app/connector submission and version snapshots.
- Admin approval workflow for connector publication and app updates.
- Enterprise SSO/IdP mapping.
- Per-customer data residency and retention controls.
- Configurable audit-log retention.
- SOC 2 evidence collection for connector access, key rotation, and least privilege.
- Tenant export of connector audit events.
- Optional UI widgets for status cards, evidence tables, and live-value chips inside ChatGPT.
- Multi-client MCP validation for ChatGPT, Claude, Codex, and future MCP hosts.

## Defer

- PLC writes.
- Conveyor start/stop/reset.
- Tag writes.
- Generic dashboards unrelated to maintenance intelligence.
- Broad data exports through MCP.
- Public unauthenticated customer connectors.
