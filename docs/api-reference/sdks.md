# SDKs & Client Libraries

MIRA ships two official client libraries generated directly from `openapi.yaml`. They handle authentication, cursor pagination, streaming, retries, and typed errors so you can focus on your integration rather than HTTP plumbing.

| Language | Package | Source | Install |
|---|---|---|---|
| TypeScript / JS | `@factorylm/mira-sdk` | npm | `npm install @factorylm/mira-sdk` |
| Python | `mira` | pip | `pip install mira` |

Both SDKs are generated from the same `openapi.yaml` that renders this reference site — the types, field names, and endpoint paths are always in sync with the API.

> **Community SDKs:** Unofficial community libraries may exist for Go, Ruby, and other languages. They are not maintained by FactoryLM. See the [Community Integrations](https://github.com/factorylm) page for links and caveats.

---

## Install & initialize

### TypeScript

```bash
npm install @factorylm/mira-sdk
```

```ts
import { MiraClient } from "@factorylm/mira-sdk";

const mira = new MiraClient({
  tenant: "acme",                        // your subdomain — acme.factorylm.com
  apiKey: process.env.MIRA_KEY!,         // mira_live_... or mira_test_...
});
```

### Python

```bash
pip install mira
```

```python
import os
from mira import Mira

mira = Mira(
    tenant="acme",                       # your subdomain — acme.factorylm.com
    api_key=os.environ["MIRA_KEY"],      # mira_live_... or mira_test_...
)
```

The base URL resolves to `https://{tenant}.factorylm.com/api/v1`. Both SDKs attach `Authorization: Bearer {apiKey}` on every request automatically.

---

## Core usage patterns

### List assets

```ts
// TypeScript
const result = await mira.assets.list({ type: "motor", criticality: ["high", "critical"] });
for (const asset of result.items) {
  console.log(asset.tag, asset.name);
}
```

```python
# Python
result = mira.assets.list(type="motor", criticality=["high", "critical"])
for asset in result.items:
    print(asset.tag, asset.name)
```

### Create a work order

```ts
// TypeScript
const wo = await mira.workOrders.create({
  assetId: "asset_01HQ...",
  title: "Replace drive-end bearing",
  priority: "high",
  type: "corrective",
  assignedTo: "tech_01...",
  dueDate: "2026-07-01T08:00:00Z",
});
console.log(wo.id, wo.status);  // "wo_01HX...", "open"
```

```python
# Python
wo = mira.work_orders.create(
    asset_id="asset_01HQ...",
    title="Replace drive-end bearing",
    priority="high",
    type="corrective",
    assigned_to="tech_01...",
    due_date="2026-07-01T08:00:00Z",
)
print(wo.id, wo.status)  # "wo_01HX...", "open"
```

### Upload a document for ingest

```ts
// TypeScript
import { createReadStream } from "fs";

const doc = await mira.ingest.documents.upload({
  assetId: "asset_01HQ...",
  file: createReadStream("baldor-cm3558t-manual.pdf"),
  filename: "baldor-cm3558t-manual.pdf",
  mediaType: "application/pdf",
});
console.log(doc.id, doc.status);  // "doc_01HY...", "processing"
```

```python
# Python
with open("baldor-cm3558t-manual.pdf", "rb") as f:
    doc = mira.ingest.documents.upload(
        asset_id="asset_01HQ...",
        file=f,
        filename="baldor-cm3558t-manual.pdf",
        media_type="application/pdf",
    )
print(doc.id, doc.status)  # "doc_01HY...", "processing"
```

### List KG proposals

```ts
// TypeScript
const proposals = await mira.kg.proposals.list({ status: "proposed", limit: 25 });
for (const p of proposals.items) {
  console.log(p.suggestionType, p.confidence, p.summary);
}
```

```python
# Python
proposals = mira.kg.proposals.list(status="proposed", limit=25)
for p in proposals.items:
    print(p.suggestion_type, p.confidence, p.summary)
```

---

## Auto-pagination

Both SDKs expose an `autoPaginate` / `auto_paginate` helper that lazily iterates all pages using the cursor from each response. Use it whenever you need the full result set.

### TypeScript

```ts
// Iterate every motor asset across all pages — yields one item at a time
for await (const asset of mira.assets.autoPaginate({ type: "motor" })) {
  console.log(asset.tag);
}

// Or collect everything at once
const all = await mira.assets.autoPaginate({ type: "motor" }).toArray();
```

### Python

```python
# Iterate every motor asset across all pages
for asset in mira.assets.auto_paginate(type="motor"):
    print(asset.tag)

# Or collect everything at once
all_assets = list(mira.assets.auto_paginate(type="motor"))
```

The helper issues a new request only when the previous page's `nextCursor` is non-null, so it incurs no extra round-trips on single-page result sets.

---

## Streaming chat (SSE)

Asset-scoped chat supports server-sent events. The SDK wraps the SSE stream and yields delta chunks.

### TypeScript

```ts
import { MiraClient } from "@factorylm/mira-sdk";

const mira = new MiraClient({ tenant: "acme", apiKey: process.env.MIRA_KEY! });

const stream = await mira.assets.chat.stream("asset_01HQ...", {
  messages: [{ role: "user", content: "What are the top 3 failure modes for this motor?" }],
  model: "groq/llama-3.3-70b",  // BYO-LLM; omit to use tenant default
});

for await (const chunk of stream) {
  process.stdout.write(chunk.delta);
}

const final = await stream.finalMessage();
console.log("\nDone. Citations:", final.citations);
```

### Python

```python
import asyncio
from mira import Mira

mira = Mira(tenant="acme", api_key=os.environ["MIRA_KEY"])

async def main():
    async with mira.assets.chat.stream(
        "asset_01HQ...",
        messages=[{"role": "user", "content": "What are the top 3 failure modes?"}],
        model="groq/llama-3.3-70b",
    ) as stream:
        async for chunk in stream:
            print(chunk.delta, end="", flush=True)

        final = await stream.final_message()
        print(f"\nCitations: {final.citations}")

asyncio.run(main())
```

See [Chat API](./chat.md) for the full `messages` schema, `model` options, and the UNS context field.

---

## Error handling

The SDK raises typed exceptions that map to the API's [error codes](./errors.md). Catch them explicitly rather than inspecting raw HTTP status codes.

### TypeScript

```ts
import { MiraClient, MiraApiError, MiraRateLimitError, MiraNotFoundError } from "@factorylm/mira-sdk";

const mira = new MiraClient({ tenant: "acme", apiKey: process.env.MIRA_KEY! });

try {
  const asset = await mira.assets.get("asset_bad_id");
} catch (err) {
  if (err instanceof MiraNotFoundError) {
    console.error("Asset not found:", err.code, err.requestId);
  } else if (err instanceof MiraRateLimitError) {
    console.error("Rate limited. Retry after:", err.retryAfter, "s");
  } else if (err instanceof MiraApiError) {
    console.error("API error", err.status, err.code, err.message);
  } else {
    throw err;
  }
}
```

### Python

```python
from mira import Mira
from mira.errors import MiraApiError, MiraRateLimitError, MiraNotFoundError

mira = Mira(tenant="acme", api_key=os.environ["MIRA_KEY"])

try:
    asset = mira.assets.get("asset_bad_id")
except MiraNotFoundError as e:
    print("Asset not found:", e.code, e.request_id)
except MiraRateLimitError as e:
    print("Rate limited. Retry after:", e.retry_after, "s")
except MiraApiError as e:
    print("API error", e.status, e.code, e.message)
```

### Automatic retries with backoff

By default both SDKs retry `429` and `5xx` responses up to **3 times** with exponential backoff (base 1 s, jitter ±20 %). Override at the client level:

```ts
// TypeScript
const mira = new MiraClient({
  tenant: "acme",
  apiKey: process.env.MIRA_KEY!,
  maxRetries: 5,        // 0 to disable
  retryDelay: 2000,     // base delay ms
});
```

```python
# Python
mira = Mira(
    tenant="acme",
    api_key=os.environ["MIRA_KEY"],
    max_retries=5,       # 0 to disable
    retry_delay=2.0,     # base delay seconds
)
```

Streaming requests are never retried after the stream has begun emitting chunks.

---

## Webhook signature verification

Use the SDK helper to verify that incoming webhook payloads were signed by MIRA. Pass the raw request body (bytes) and the `X-Mira-Signature` header value.

```ts
// TypeScript
import { MiraWebhook } from "@factorylm/mira-sdk";

const secret = process.env.MIRA_WEBHOOK_SECRET!;

app.post("/webhooks/mira", express.raw({ type: "*/*" }), (req, res) => {
  try {
    const event = MiraWebhook.verify(req.body, req.headers["x-mira-signature"] as string, secret);
    console.log("Verified event:", event.type, event.data.id);
    res.sendStatus(200);
  } catch (err) {
    res.status(400).send("Signature verification failed");
  }
});
```

```python
# Python (Flask example)
from flask import Flask, request, abort
from mira.webhooks import MiraWebhook

app = Flask(__name__)
secret = os.environ["MIRA_WEBHOOK_SECRET"]

@app.post("/webhooks/mira")
def handle_webhook():
    try:
        event = MiraWebhook.verify(request.data, request.headers["X-Mira-Signature"], secret)
        print("Verified event:", event.type, event.data["id"])
        return "", 200
    except ValueError:
        abort(400, "Signature verification failed")
```

See [Webhooks](./webhooks.md) for event types, payload shapes, and retry behavior.

---

## Configuration reference

| Option | TypeScript key | Python key | Default | Description |
|---|---|---|---|---|
| Tenant subdomain | `tenant` | `tenant` | required | `acme` → `acme.factorylm.com` |
| API key | `apiKey` | `api_key` | required | `mira_live_...` or `mira_test_...` |
| Base URL override | `baseUrl` | `base_url` | derived from tenant | Set to `https://sandbox.factorylm.com/api/v1` for sandbox |
| Request timeout | `timeout` | `timeout` | `30000` ms / `30` s | Per-request timeout before raising `MiraTimeoutError` |
| Max retries | `maxRetries` | `max_retries` | `3` | Set to `0` to disable |
| Retry base delay | `retryDelay` | `retry_delay` | `1000` ms / `1` s | Exponential backoff base |
| HTTP agent | `httpAgent` | — | node default | Custom agent for proxy/mTLS in Node.js |
| Custom headers | `defaultHeaders` | `default_headers` | `{}` | Merged into every request |

### Sandbox / local dev example

```ts
// TypeScript — point at sandbox tenant for integration tests
const mira = new MiraClient({
  tenant: "sandbox",
  apiKey: process.env.MIRA_TEST_KEY!,   // mira_test_... key
  baseUrl: "https://sandbox.factorylm.com/api/v1",
  timeout: 10000,
  maxRetries: 0,                         // fail fast in tests
});
```

```python
# Python — point at sandbox tenant for integration tests
mira = Mira(
    tenant="sandbox",
    api_key=os.environ["MIRA_TEST_KEY"],   # mira_test_... key
    base_url="https://sandbox.factorylm.com/api/v1",
    timeout=10,
    max_retries=0,                          # fail fast in tests
)
```
