# MIRA API Reference

**Status:** Draft — scaffolded as competitive-parity response to Factory AI (f7i.ai) on 2026-04-24.
**Renders to:** `docs.factorylm.com` (pending — see issue "docs(api): public API reference site").
**Source of truth:** `openapi.yaml` in this directory. Markdown pages are generated from it.

---

## Why this exists

Factory AI publishes 20 REST endpoints at [docs.f7i.ai](https://docs.f7i.ai) via Docusaurus. Their docs are their #1 credibility signal. This directory is MIRA's answer: a single source of truth (`openapi.yaml`) that renders both the public docs site and generates TypeScript/Python client types.

See `docs/competitors/factory-ai.md` for the full competitor analysis.

---

## Base URL

```
https://{tenant}.factorylm.com/api
```

`{tenant}` is the customer subdomain. Reserved subdomains: `app`, `api`, `docs`, `admin`, `www`, `hub`.

Example: `https://acme.factorylm.com/api/assets`

---

## Authentication

All API calls require a Bearer token:

```http
Authorization: Bearer mira_live_xxxxxxxxxxxxxxxxxxxxxxxx
```

Keys are generated per-tenant at `/hub/admin/api-keys`. Each key has:
- **Scope:** read-only or read/write
- **Expiry:** optional (never-expire, 24h, 7d, 30d, 90d, custom)
- **IP allowlist:** optional (CIDR blocks)
- **Audit log:** every call is logged with actor, IP, endpoint, response code

Keys are prefixed:
- `mira_live_` — production
- `mira_test_` — sandbox tenant
- `mira_dev_` — local development only (never accepted by production)

### Token rotation

Compromised key? Rotate at `/hub/admin/api-keys/{id}/rotate` — the old token is revoked immediately and a new one is issued. Webhooks fire on `security.api_key_rotated` so you can cycle clients.

---

## Rate limits

| Tier | Requests per minute | Requests per day |
|------|--------------------|-----------------|
| Free | 60 | 10,000 |
| Pro | 600 | 500,000 |
| Enterprise | Custom | Custom |

Exceeding returns `429 Too Many Requests` with a `Retry-After` header.

---

## Versioning

URL-path versioned: `/api/v1/...` is the current stable version. Breaking changes ship at `/api/v2/...`; old versions are supported for at least 12 months after a new major release.

The version is also returned in the `X-Mira-Api-Version` response header.

---

## Pagination

Endpoints that return collections use cursor pagination:

```
GET /api/assets?limit=50&cursor=eyJpZCI6...
```

Response:
```json
{
  "items": [...],
  "count": 50,
  "nextCursor": "eyJpZCI6..."
}
```

`nextCursor` is null when there are no more items.

---

## Error format

All errors share a stable shape:

```json
{
  "error": {
    "code": "asset_not_found",
    "message": "Asset with id=abc-123 was not found",
    "requestId": "req_7H3fK9..."
  }
}
```

Common codes:
- `400 bad_request` — malformed payload
- `401 unauthorized` — missing or invalid token
- `403 forbidden` — valid token, insufficient scope
- `404 not_found` — resource doesn't exist in this tenant
- `409 conflict` — state-machine violation (e.g., illegal WO transition)
- `422 unprocessable_entity` — validation failed
- `429 too_many_requests` — rate limit
- `500 internal_error` — our fault; include `requestId` in support ticket

---

## The four surfaces

The public API spans four surfaces, all tenant-scoped and behind the same API key:

| Surface | What it is | Where |
|---|---|---|
| **REST** | The resource API below — assets, work orders, PMs, parts, the knowledge graph. | `https://{tenant}.factorylm.com/api/v1` |
| **Chat** | Grounded maintenance chat, incl. an **OpenAI-compatible** `/chat/completions`. | [Chat](./chat.md) |
| **Ingest** | Push documents, photos, CMMS records, and SCADA time-series in. | [Ingest](./ingest.md) |
| **MCP** | The same API exposed as Model Context Protocol tools for AI agents. | [MCP Tools](./mcp.md) |

`openapi.yaml` in this directory is the **single source of truth**; every page below is generated from / kept in sync with it.

## Guides

- [Getting started](./getting-started.md) — your first authenticated request in 5 minutes
- [Authentication](#authentication) · [Errors](./errors.md) · [Pagination](#pagination) · [Rate limits](#rate-limits) · [Versioning](#versioning)
- [SDKs & client libraries](./sdks.md) — TypeScript (`@factorylm/mira-sdk`) + Python (`mira`)
- [Webhooks](./webhooks.md) — outbound events + signature verification
- [Changelog](./changelog.md)

## Resource reference

| Resource | Notes | Page |
|---|---|---|
| Assets & components | Unbounded `Site → Area → Asset → Component` hierarchy | [assets.md](./assets.md) ✅ |
| Work Orders | 7-state lifecycle + safety gate | [work-orders.md](./work-orders.md) ✅ |
| PM Procedures | Calendar / meter / condition triggers, safety-first | [pm-procedures.md](./pm-procedures.md) ✅ |
| Parts, Inventory & POs | ABC/XYZ, multi-vendor, threshold approvals | [parts-inventory.md](./parts-inventory.md) ✅ |
| Failure Codes | ISO 14224-aligned taxonomy | [failure-codes.md](./failure-codes.md) ✅ |
| Sensors & FFT | Telemetry + vibration peak classification | [sensors.md](./sensors.md) ✅ |
| Knowledge Graph & UNS | Namespace, entities, evidence-backed AI proposals, readiness | [knowledge-graph.md](./knowledge-graph.md) ✅ |
| Chat | Streaming + BYO-LLM + OpenAI-compatible | [chat.md](./chat.md) ✅ |
| Ingest | Documents / photos / CMMS / time-series | [ingest.md](./ingest.md) ✅ |
| MCP tools | Agent-native access to the surface above | [mcp.md](./mcp.md) ✅ |
| Maintenance Strategies · External Events · Notifications · Documents · Templates · Customer Settings · Auth (SAML/OIDC/SCIM) · Feedback | Long-tail resources | Specified in [`openapi.yaml`](./openapi.yaml) |

---

## Differentiators at a glance

What you will *not* find at `docs.f7i.ai` but will find here:

1. **Chat streaming with BYO-LLM** — Claude, GPT, Gemini, Groq, Cerebras, on-prem Ollama. Their chat is a GET-only retrieval endpoint.
2. **Outbound webhooks** — Slack, Teams, PagerDuty, Jira recipes. Their `/notifications` is GET-only.
3. **ISO 14224 failure taxonomy** — standards-compliant out of the box. Theirs is proprietary.
4. **SAML + OIDC SSO + SCIM** — enterprise-ready. They use temp-password emails.
5. **No-training-by-default** — your data is yours. Their T&Cs clause 15 is opt-out.
6. **Self-serve manual ingest** — drag-drop → in-chat in minutes. Theirs: email tim@f7i.ai.
7. **On-prem / air-gap deployment** — they are cloud-only.
