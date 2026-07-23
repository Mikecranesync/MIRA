# Errors

Every `4xx` and `5xx` response uses one consistent JSON envelope, so a client can
handle errors generically.

---

## Error envelope

```json
{
  "error": {
    "code": "validation_error",
    "message": "field 'manufacturer' is required",
    "requestId": "req_01J8X...",
    "details": [
      { "field": "manufacturer", "issue": "required" }
    ]
  }
}
```

| Field | Always present | Description |
|---|---|---|
| `error.code` | yes | Stable, machine-readable. Branch on this, **not** on `message`. |
| `error.message` | yes | Human-readable; may change wording over time. |
| `error.requestId` | yes | Echoes the `X-Request-Id` response header. Quote it in support tickets. |
| `error.details` | no | Per-field validation issues (on `422`), or extra context. |

Always send a `Content-Type: application/json` header on requests with a body;
a missing/incorrect one is the most common cause of a surprising `400`.

---

## HTTP status codes

| Status | `error.code` | Meaning | Retry? |
|---|---|---|---|
| `400` | `bad_request` | Malformed JSON, wrong content type, bad query param | No — fix the request |
| `401` | `unauthorized` | Missing/invalid/expired API key | No — check the key |
| `403` | `forbidden` | Valid key, insufficient scope or role (e.g. read-only key on a write; non-admin on a proposal decision) | No |
| `404` | `not_found` | Resource doesn't exist **or isn't visible to this tenant** | No |
| `409` | `conflict` | State-machine violation (illegal work-order transition; delete an asset with children) | No — resolve the conflict first |
| `422` | `validation_error` | Body well-formed but failed validation; see `details` | No — fix the fields |
| `429` | `rate_limited` | Rate limit exceeded | **Yes** — after `Retry-After` |
| `500` | `internal_error` | Our fault | Yes — with backoff; include `requestId` |
| `503` | `service_unavailable` | Dependency down / maintenance | Yes — with backoff, honor `Retry-After` |

---

## Common `error.code` values

Stable string codes you can switch on:

| `code` | Typical status | When |
|---|---|---|
| `bad_request` | 400 | Unparseable body, missing content type |
| `unauthorized` | 401 | No/!bad bearer token |
| `invalid_api_key` | 401 | Token format valid but unknown/revoked |
| `key_expired` | 401 | Key past its expiry |
| `ip_not_allowed` | 403 | Caller IP outside the key's CIDR allowlist |
| `insufficient_scope` | 403 | Read-only key used on a write |
| `admin_required` | 403 | Non-admin on an admin action (e.g. `POST /kg/proposals/{id}/decide`) |
| `not_found` | 404 | Unknown id, or cross-tenant access |
| `conflict` | 409 | Illegal state transition / dependency exists |
| `validation_error` | 422 | One or more fields invalid (see `details`) |
| `rate_limited` | 429 | Quota exceeded |
| `idempotency_conflict` | 409 | Same `Idempotency-Key` reused with a different body |
| `internal_error` | 500 | Unhandled server error |

New codes may be added over time; treat an unrecognized `code` as a generic
failure of its HTTP status class.

---

## Rate limiting (`429`)

When you exceed your tier (see the [README](./README.md#rate-limits)) the API
returns `429` with a `Retry-After` header (seconds):

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 12
Content-Type: application/json

{ "error": { "code": "rate_limited", "message": "60 req/min exceeded", "requestId": "req_..." } }
```

Back off for `Retry-After` seconds, then retry. The official [SDKs](./sdks.md)
do this automatically with exponential backoff and jitter.

---

## Recommended retry policy

- **Retry** (with exponential backoff + jitter): `429`, `500`, `502`, `503`, `504`.
- **Do not retry**: `400`, `401`, `403`, `404`, `409`, `422` — the request itself
  needs to change.
- **Make retries safe**: send an [`Idempotency-Key`](./ingest.md) header on `POST`
  writes and ingest calls so a retried request can't double-apply.
- Cap at ~5 attempts; surface `requestId` in your logs for support correlation.

```python
# Python — minimal backoff loop
import time, httpx

def call_with_retry(client, method, url, **kw):
    for attempt in range(5):
        r = client.request(method, url, **kw)
        if r.status_code not in (429, 500, 502, 503, 504):
            return r
        wait = int(r.headers.get("Retry-After", 2 ** attempt))
        time.sleep(wait)
    r.raise_for_status()
    return r
```

---

## Webhook delivery errors

Outbound [webhook](./webhooks.md) deliveries that your endpoint rejects (non-`2xx`)
are retried with exponential backoff and recorded under
`GET /webhooks/{id}/deliveries`. Persistent failures eventually disable the
webhook and emit a `webhook.disabled` event.
