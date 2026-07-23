# Ingest API

The Ingest API is MIRA's public data substrate — the "Twilio for maintenance data" entry point. Every fact you push in (PDF manuals, equipment photos, CMMS records, SCADA/historian readings) is chunked, UNS-tagged, deduplicated, and made immediately citable by MIRA's chat and diagnostics surfaces. Internally the API reuses `hub_uploads`, `knowledge_entries`, `cmms_equipment`, `work_orders`, and `uns_tag_values` — there is no parallel schema.

**MCP parity:** every endpoint below has a corresponding tool on the MCP server. See [MCP Tools](./mcp.md) for the tool list and connection instructions.

---

## Data model

```ts
type IngestJob = {
  id: string;               // uuid
  kind: "document" | "photo" | "cmms" | "timeseries";
  status: "queued" | "processing" | "indexed" | "failed";
  sourceUrl?: string;       // set when ingested by URL, not file upload
  unsPath?: string;         // resolved UNS path, e.g. "enterprise.acme.bay7.pump_0042"
  chunkCount?: number;      // populated once status = "indexed"
  accepted?: number;        // timeseries only: points accepted in this batch
  rejected?: number;        // timeseries only: points rejected (bad path / schema)
  errorMessage?: string;    // populated when status = "failed"
  externalId?: string;      // customer-supplied dedup key
  assetId?: string;         // linked asset uuid, if provided at ingest time
  createdAt: string;        // RFC 3339 UTC
  updatedAt: string;
};
```

---

## Endpoints

### Upload a document

```http
POST /api/v1/ingest/documents
Content-Type: multipart/form-data
```

Accepts a PDF, DWG, plain-text, or Markdown file. The file is queued for parsing and chunking; the call returns immediately with `status: "queued"`. Poll [Get job status](#get-job-status) or subscribe to the `document.indexed` webhook.

Form fields:

| Name | Type | Required | Description |
|---|---|---|---|
| `file` | binary | yes | PDF, DWG, txt, md. Max 20 MB. |
| `kind` | string | no | `manual` \| `drawing` \| `nameplate` \| `other`. Default `manual`. |
| `assetId` | string | no | UUID of the asset this document belongs to. |
| `assetTag` | string | no | Alternative to `assetId` — resolved to an asset UUID server-side. |
| `unsPath` | string | no | Override the UNS path (`enterprise.<site>.<area>.<asset>`). Auto-resolved from `assetId` if omitted. |
| `title` | string | no | Human-readable title. Defaults to filename. |
| `externalId` | string | no | Idempotent dedup key from your system (e.g. SharePoint document ID). |

Response `202 Accepted` — an `IngestJob` with `status: "queued"`. Idempotent: repeat calls with the same `Idempotency-Key` header within 24 hours return the original job without re-queuing.

**Errors:** [./errors.md](./errors.md) — common codes: `422 unsupported_mime_type`, `413 file_too_large`, `404 asset_not_found`.

---

### Ingest a document by URL

```http
POST /api/v1/ingest/documents/url
Content-Type: application/json
```

For documents already hosted (SharePoint, Confluence, S3 presigned URLs). MIRA fetches and processes the file server-side.

Body:

```json
{
  "url": "https://sharepoint.example.com/manuals/grundfos_cr32.pdf",
  "kind": "manual",
  "assetTag": "PUMP-0042",
  "title": "Grundfos CR 32-3 Installation Manual",
  "externalId": "sharepoint-doc-8812"
}
```

Response `202 Accepted` — same `IngestJob` shape as file upload, with `sourceUrl` set.

---

### Upload equipment photos

```http
POST /api/v1/ingest/photos
Content-Type: multipart/form-data
```

Equipment photos are stored in `hub_uploads`, linked to the asset, and optionally passed through the vision model to extract nameplate data and fault indicators.

Form fields:

| Name | Type | Required | Description |
|---|---|---|---|
| `file` | binary | yes | jpeg, png, webp, heic. Max 10 MB. |
| `assetId` | string | no | Asset to attach the photo to. |
| `assetTag` | string | no | Alternative to `assetId`. |
| `unsPath` | string | no | UNS path override. |
| `caption` | string | no | Short description or fault context. |
| `extractNameplate` | bool | no | Default `true`. Run vision extraction on upload. |
| `externalId` | string | no | Dedup key. |

Response `202 Accepted` — an `IngestJob` with `status: "queued"`.

---

### Bulk CMMS push

```http
POST /api/v1/ingest/cmms
Content-Type: application/json
Idempotency-Key: <uuid>
```

Push work orders, asset records, or fault histories exported from your CMMS (Maximo, SAP PM, MaintainX, Fiix, etc.). Records are upserted — repeated pushes with the same `externalId` update rather than duplicate. Batch up to 200 records per call.

Body:

```json
{
  "records": [
    {
      "type": "work_order",
      "externalId": "maximo-WO-77241",
      "assetTag": "PUMP-0042",
      "title": "Pump cavitation on startup",
      "description": "Suction pressure drops below 2 psi within 5 s of start",
      "priority": "high",
      "woType": "corrective",
      "openedAt": "2026-04-10T08:00:00Z",
      "closedAt": "2026-04-10T14:30:00Z",
      "resolution": "Replaced mechanical seal"
    }
  ]
}
```

Valid `type` values: `work_order`, `asset`, `fault_event`. `priority`: `low | medium | high | critical`. `woType`: `corrective | preventive | inspection | safety`.

Response `202 Accepted` — an `IngestJob` with `status: "queued"`. Per-record errors surface in `errorMessage` once the job reaches `indexed` (partial success) or `failed`.

---

### Push SCADA / historian readings

```http
POST /api/v1/ingest/timeseries
Content-Type: application/json
Idempotency-Key: <uuid>
```

UNS-compatible VQT (Value / Quality / Timestamp) batch push. Backed by `uns_tag_values`. Batch up to 500 data points per call; for high-frequency streams use repeated calls with `Idempotency-Key` for safe retry.

Body:

```json
{
  "readings": [
    {
      "path": "enterprise.acme.north_plant.pump_0042.suction_psi",
      "value": 1.8,
      "quality": "good",
      "timestamp": "2026-05-11T14:30:00.142Z",
      "unit": "psi",
      "type": "float"
    }
  ]
}
```

`quality`: `good | bad | uncertain` (UNS/OPC-UA convention).
`type`: `float | int | bool | string`.

Response `202 Accepted`:

```json
{
  "id": "c9a42d11-...",
  "kind": "timeseries",
  "status": "queued",
  "chunkCount": null,
  "accepted": 2,
  "rejected": 0,
  "createdAt": "2026-05-11T14:30:00Z",
  "updatedAt": "2026-05-11T14:30:00Z"
}
```

High-frequency paths (Ignition, MQTT, Sparkplug B) should use the dedicated relay endpoint on the MIRA cloud relay rather than this REST surface. See [UNS / MQTT Bridge](./sensors.md).

---

### Get job status

```http
GET /api/v1/ingest/jobs/{id}
```

Poll until `status` is `indexed` or `failed`. Returns the full `IngestJob` object. Typical latency: documents 30–120 s (page count dependent); photos 5–15 s; CMMS 2–10 s; timeseries near-instant. When indexed, `chunkCount` and `unsPath` are populated.

---

### List jobs

```http
GET /api/v1/ingest/jobs
```

Query parameters:

| Name | Type | Description |
|---|---|---|
| `kind` | string | Filter by `document`, `photo`, `cmms`, or `timeseries`. |
| `status` | string | Filter by `queued`, `processing`, `indexed`, or `failed`. |
| `assetId` | string | Filter by linked asset. |
| `limit` | int | Default 50, max 200. |
| `cursor` | string | Cursor pagination. |

Response: `{ "items": IngestJob[], "count": 12, "nextCursor": string | null }`

---

## Examples

### curl — multipart document upload

```bash
curl https://acme.factorylm.com/api/v1/ingest/documents \
  -H "Authorization: Bearer mira_live_xxxxxxxxxxxx" \
  -H "Idempotency-Key: $(uuidgen)" \
  -F "file=@grundfos_cr32.pdf" \
  -F "kind=manual" \
  -F "assetTag=PUMP-0042" \
  -F "externalId=sharepoint-doc-8812"
```

### TypeScript — upload and poll

```ts
import { MiraClient } from "@factorylm/mira-sdk";
const mira = new MiraClient({ tenant: "acme", apiKey: process.env.MIRA_KEY! });

let job = await mira.ingest.uploadDocument({
  file: fs.createReadStream("grundfos_cr32.pdf"),
  kind: "manual",
  assetTag: "PUMP-0042",
  externalId: "sharepoint-doc-8812",
});

while (job.status === "queued" || job.status === "processing") {
  await new Promise(r => setTimeout(r, 3000));
  job = await mira.ingest.getJob(job.id);
}
console.log(`Indexed ${job.chunkCount} chunks at ${job.unsPath}`);
```

### Python — bulk CMMS push

```python
import os, time
from mira import Mira

mira = Mira(tenant="acme", api_key=os.environ["MIRA_KEY"])

job = mira.ingest.push_cmms(records=[{
    "type": "work_order",
    "external_id": "maximo-WO-77241",
    "asset_tag": "PUMP-0042",
    "title": "Pump cavitation on startup",
    "priority": "high",
    "wo_type": "corrective",
    "opened_at": "2026-04-10T08:00:00Z",
    "closed_at": "2026-04-10T14:30:00Z",
    "resolution": "Replaced mechanical seal",
}])

while job.status not in ("indexed", "failed"):
    time.sleep(2)
    job = mira.ingest.get_job(job.id)

if job.status == "failed":
    raise RuntimeError(f"Ingest failed: {job.error_message}")
print(f"CMMS records indexed — job {job.id}")
```

---

## Webhooks emitted

- `ingest.job_completed` — job reached `status: "indexed"` (any kind)
- `ingest.job_failed` — job reached `status: "failed"`; payload includes `errorMessage`
- `document.indexed` — document (PDF / manual) fully chunked and citable; payload includes `chunkCount` and `unsPath`

Subscribe at [Webhooks API](./webhooks.md).
