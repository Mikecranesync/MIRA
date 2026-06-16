# Chat API

Asset-scoped conversational AI. Factory AI's version is a GET-only retrieval endpoint over manuals that must be hand-indexed by their support team. MIRA's is streaming, multi-LLM, and self-serve.

**Mirrors f7i.ai endpoint:** `/asset-resources-chat` — ours is POST-and-stream, theirs is GET-only reference. Fundamentally different category of feature.

---

## Endpoints

### Asset-scoped chat (streaming)

```http
POST /api/v1/assets/{assetId}/chat
Content-Type: application/json
Accept: text/event-stream
```

Body:

```json
{
  "messages": [
    { "role": "user", "content": "Why is the drive motor vibrating at 120 Hz?" }
  ],
  "stream": true,
  "model": "claude-opus-4-7",
  "includeManuals": true,
  "includeSensors": true,
  "includeHistory": true
}
```

Returns Server-Sent Events:

```
event: content_block_delta
data: {"delta":{"type":"text_delta","text":"The 120 Hz peak "}}

event: content_block_delta
data: {"delta":{"type":"text_delta","text":"corresponds to 2X running speed..."}}

event: citation
data: {"source":"manual","title":"Baldor CM3558T maintenance guide","page":14,"score":0.87}

event: message_stop
data: {"usage":{"inputTokens":1832,"outputTokens":164}}
```

`stream: false` returns a single JSON response (useful for non-streaming clients).

### Global chat

```http
POST /api/v1/chat
```

Same body shape, no asset scope. Model can still invoke tool-use to fetch assets by tag, query work orders, etc.

### List asset resources

Factory-AI-compatible retrieval endpoint — return the indexed manuals/troubleshooting docs attached to an asset, without the chat:

```http
GET /api/v1/assets/{assetId}/resources
```

Query params:
- `assetName` — fallback when asset id unknown
- `resourceType` — one of `manual | troubleshooting | maintenance | specification | safety | training | faq | best_practice`
- `limit` — default 100

Response:

```json
{
  "items": [
    {
      "id": "res_01HY...",
      "assetId": "asset_01HR...",
      "resourceType": "manual",
      "title": "Baldor CM3558T maintenance guide",
      "content": "## Bearing replacement\n\nTo replace...",
      "tags": ["bearing", "pm"],
      "metadata": { "manufacturer": "Baldor", "model": "CM3558T", "documentVersion": "3.2" },
      "createdAt": "2026-01-15T10:00:00Z"
    }
  ]
}
```

### Upload a manual (self-serve)

**This is a category win over Factory AI** — they require emailing `tim@f7i.ai`. We ingest from the browser.

```http
POST /api/v1/assets/{assetId}/resources
Content-Type: multipart/form-data
```

Form fields:
- `file` — PDF, DOCX, HTML, or MD (max 100 MB)
- `resourceType` — one of the types above (default `manual`)
- `title` — optional; filename used otherwise

Server kicks off an async ingest: PDF → Docling/OCR → chunk → embed → Qdrant. Response returns a `jobId`:

```json
{ "jobId": "ingest_01HZ...", "status": "queued" }
```

Poll status with:

```http
GET /api/v1/ingest/{jobId}
```

Typical turnaround for a 200-page manual: 2–5 minutes. Chat picks up the new content automatically once indexed.

---

## Supported models (BYO-LLM)

Tenant chooses which model answers. Configure default at `/hub/admin/ai-settings`; override per call with the `model` field.

| Model id | Provider | Notes |
|---|---|---|
| `claude-opus-4-7` | Anthropic | Default. Deepest reasoning. |
| `claude-sonnet-4-6` | Anthropic | Faster, cheaper. |
| `claude-haiku-4-5` | Anthropic | Cheapest Claude, fastest. |
| `gpt-5` | OpenAI | If customer has OpenAI key wired. |
| `gemini-2.5-pro` | Google | Via Google API or Vertex. |
| `groq:llama-3.3-70b` | Groq | Very low-latency. |
| `cerebras:llama-3.3-70b` | Cerebras | Higher throughput. |
| `ollama:qwen2.5:32b` | On-prem Ollama | Air-gapped deployments. |
| `ollama:llama3.1:70b` | On-prem Ollama | Air-gapped deployments. |

Factory AI does not disclose their model and does not support BYO.

---

## Safety gate

Every chat request is pre-screened by `mira_safety_guard`:

- 21 phrase-level safety keywords (arc flash, LOTO, confined space, hot work, ...) → **STOP escalation**: the model is instructed to refuse the direct action and emit a pointer to the proper procedure and safety contact.
- PII sanitizer: IPv4, MAC addresses, serial numbers redacted from prompts before they hit third-party LLMs.

This is hard-wired in code, not disclaimed in T&Cs. See [mira-safety-guard](https://github.com/Mikecranesync/mira-safety-guard) (MIT).

---

## Context the model gets

Per-asset chat automatically includes:

1. **Asset metadata:** tag, name, manufacturer, model, criticality, specifications, parent chain.
2. **Manuals + SOPs** (top-N retrieved via vector search over your uploaded resources).
3. **Recent work orders** (last 10 closed on this asset, title + failure code + resolution).
4. **Recent sensor data** (if `includeSensors: true`): last 24h summary + any active alerts.
5. **Site context:** sister assets of the same type for pattern-matching.

Control with the `include*` flags. Keep retrieval scoped for privacy / cost.

---

## Usage accounting

Every chat response includes `usage`:

```json
{
  "inputTokens": 1832,
  "outputTokens": 164,
  "totalTokens": 1996,
  "model": "claude-opus-4-7",
  "costUsd": 0.0287
}
```

Tenant-level usage rollups at `/hub/admin/usage`.

---

## Differences from Factory AI's Factory Chat

| Capability | Factory AI | MIRA |
|---|---|---|
| Streaming response | ✗ | ✓ SSE |
| BYO-LLM | ✗ (hidden) | ✓ 9+ models |
| Self-serve manual ingest | ✗ (email tim@) | ✓ drag-drop |
| PII sanitization | not documented | ✓ hard-wired |
| Safety keyword gate | T&Cs only | ✓ hard stop in code |
| Citations with sources | not documented | ✓ SSE `citation` events |
| Tool-use (invoke API from chat) | not documented | ✓ (global chat) |
| Sensor data in context | not documented | ✓ when `includeSensors` |
| Multi-turn + memory | not documented | ✓ |
