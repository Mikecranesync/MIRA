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

## Resource index

| Resource | Mirrors f7i.ai endpoint? | Status | Page |
|---|---|---|---|
| [Assets](./assets.md) | yes — plus nested hierarchy | in progress | ✅ drafted |
| [Components](./components.md) | yes | planned | |
| [Work Orders](./work-orders.md) | yes — plus sub-resources | in progress | ✅ drafted |
| [PM Procedures](./pms.md) | yes — safety-first | planned | |
| [Maintenance Strategies](./maintenance-strategies.md) | yes — 7 types | planned | |
| [Failure Codes](./failure-codes.md) | **ISO 14224-aligned** (their edge → ours) | planned | |
| [Parts & Inventory](./inventory.md) | yes — ABC/XYZ | planned | |
| [Purchase Orders](./purchase-orders.md) | yes — threshold approvals | planned | |
| [External Events](./external-events.md) | yes — SCADA/ERP/MES/weather | planned | |
| [Notifications](./notifications.md) | yes | planned | |
| [Webhooks](./webhooks.md) | **NEW — they don't have this** | in progress | ✅ drafted |
| [Sensors & FFT](./sensors.md) | yes — vibration peak detection | planned | |
| [Documents](./documents.md) | yes | planned | |
| [Chat](./chat.md) | **streaming + BYO-LLM (their chat is GET-only)** | in progress | ✅ drafted |
| [Templates](./templates.md) | yes — open YAML catalog | planned | |
| [Customer Settings](./customer-settings.md) | yes | planned | |
| [Auth (SSO/SAML/OIDC)](./auth.md) | **NEW — they don't have SSO** | planned | |
| [Feedback](./feedback.md) | yes | planned | |

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
