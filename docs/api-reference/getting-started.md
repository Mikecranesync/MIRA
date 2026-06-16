# Getting started

Make your first authenticated MIRA API call in about five minutes.

---

## 1. Get an API key

API keys are issued per tenant at `/hub/admin/api-keys`. Create a key, choose a
scope (read-only or read/write), and copy it — you only see the full value once.

| Prefix | Environment |
|---|---|
| `mira_live_…` | production (`https://{tenant}.factorylm.com/api/v1`) |
| `mira_test_…` | sandbox (`https://sandbox.factorylm.com/api/v1`, data reset nightly) |
| `mira_dev_…` | local development only — never accepted by production |

Keep keys server-side. Never ship one in a browser bundle or mobile app.

```bash
export MIRA_KEY="mira_live_xxxxxxxxxxxxxxxxxxxxxxxx"
export MIRA_TENANT="acme"
```

---

## 2. Your first request

List the first page of assets:

```bash
curl "https://$MIRA_TENANT.factorylm.com/api/v1/assets?limit=5" \
  -H "Authorization: Bearer $MIRA_KEY"
```

```json
{
  "items": [
    { "id": "asset_01HQ...", "tag": "MOTOR-001", "name": "Drive Motor", "criticality": "high" }
  ],
  "nextCursor": null
}
```

A `401` means the key is missing or wrong; a `403` means the key is valid but
lacks the scope for this call. See [Errors](./errors.md).

---

## 3. Use an official SDK

**TypeScript** (`npm i @factorylm/mira-sdk`):

```ts
import { MiraClient } from "@factorylm/mira-sdk";
const mira = new MiraClient({ tenant: "acme", apiKey: process.env.MIRA_KEY! });

const assets = await mira.assets.list({ criticality: ["high", "critical"] });
console.log(assets.items.map((a) => a.tag));
```

**Python** (`pip install mira`):

```python
from mira import Mira
mira = Mira(tenant="acme", api_key=os.environ["MIRA_KEY"])

for asset in mira.assets.list(criticality=["high", "critical"]):
    print(asset.tag)
```

See [SDKs & client libraries](./sdks.md) for streaming, pagination, retries, and webhook verification.

---

## 4. The 5-minute "grounded answer" loop

The fastest way to feel what MIRA does: ingest a manual, then ask about it.

```bash
# (a) Ingest an equipment manual — returns an async job.
curl -X POST "https://$MIRA_TENANT.factorylm.com/api/v1/ingest/documents" \
  -H "Authorization: Bearer $MIRA_KEY" \
  -F "file=@powerflex-525-manual.pdf" \
  -F "assetTag=VFD-001"
# → { "id": "job_01J...", "kind": "document", "status": "queued" }

# (b) Poll until indexed (see Ingest API).
curl "https://$MIRA_TENANT.factorylm.com/api/v1/ingest/jobs/job_01J..." \
  -H "Authorization: Bearer $MIRA_KEY"

# (c) Ask a grounded question — the answer cites the manual you just ingested.
curl -X POST "https://$MIRA_TENANT.factorylm.com/api/v1/chat" \
  -H "Authorization: Bearer $MIRA_KEY" -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"PowerFlex 525 shows F004. What does it mean?"}],"stream":false}'
```

The reply carries `[Source: …]` citations pointing back to the ingested manual —
MIRA never answers maintenance questions without grounding. See [Chat](./chat.md)
and [Ingest](./ingest.md).

---

## Conventions in 30 seconds

- **Base URL:** `https://{tenant}.factorylm.com/api/v1` (`{tenant}` = your subdomain).
- **Auth:** `Authorization: Bearer mira_live_…` on every request.
- **Versioning:** path-based `/api/v1`; breaking changes ship at `/api/v2` with ≥12 months overlap. See the [README](./README.md#versioning).
- **Pagination:** cursor-based — `?limit=&cursor=`, follow `nextCursor` until null.
- **Rate limits:** `429` returns a `Retry-After` header. See the [README](./README.md#rate-limits).
- **Errors:** consistent JSON envelope with a stable `code`. See [Errors](./errors.md).
- **Idempotency:** send an `Idempotency-Key` header on writes/ingest to make retries safe.

Next: pick a resource from the [reference index](./README.md#resource-reference), or wire up [Webhooks](./webhooks.md) to get pushed events.
