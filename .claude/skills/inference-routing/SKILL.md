---
name: inference-routing
description: MIRA dual-backend inference — Claude API vs local Open WebUI/Ollama, PII sanitization, Langfuse telemetry, prompt loading
---

# Inference Routing

## Source Files

- `mira-bots/shared/inference/router.py` — InferenceRouter class (Claude API path)
- `mira-bots/shared/workers/rag_worker.py` — RAGWorker, calls router or Open WebUI
- `mira-bots/prompts/diagnose/active.yaml` — system prompt loaded per-call
- `mira-bots/shared/langfuse_setup.py` — Langfuse tracing setup
- `mira-bots/shared/telemetry.py` — trace/span wrappers

---

## Dual-Backend Architecture

```
INFERENCE_BACKEND=claude  AND  ANTHROPIC_API_KEY set
    → InferenceRouter.complete()
    → POST https://api.anthropic.com/v1/messages
    → Returns (content_str, usage_dict)

INFERENCE_BACKEND=local  OR  ANTHROPIC_API_KEY missing
    → Open WebUI at OPENWEBUI_BASE_URL
    → Ollama backend → qwen2.5vl:7b

Vision (VisionWorker + GLM-OCR) ALWAYS stays local regardless of INFERENCE_BACKEND.
```

### Switching Backends

Set `INFERENCE_BACKEND` in Doppler `factorylm/prd`:
- `"claude"` — routes LLM reasoning to Claude API
- `"local"` — routes to Open WebUI / Ollama

No restart needed if using hot-reload. Otherwise `docker compose restart mira-bot-telegram`.

---

## InferenceRouter (`router.py`)

### Enabled check

```python
self.enabled = self.backend == "claude" and bool(self.api_key)
```

If not enabled, `complete()` returns `("", {})` immediately — caller falls through to Open WebUI.

### complete() method signature

```python
async def complete(
    messages: list[dict],
    max_tokens: int = 1024,
    session_id: str = "unknown_unknown_unknown",
) -> tuple[str, dict]:
    # Returns (content_str, usage_dict)
    # usage_dict = {"input_tokens": N, "output_tokens": N}
    # Returns ("", {}) on any error — caller handles fallback
```

`session_id` format: `{tenant_id}_{platform}_{user_id}` — used for usage logging in `api_usage` SQLite table.

### Message format conversion

The router accepts OpenAI-style messages (including `image_url` blocks) and converts them to Claude's API format:

```python
# OpenAI format:
{"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,..."}}

# Converted to Claude format:
{"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": "..."}}
```

The system message is split out as Claude's top-level `system` parameter.

### HTTP call

Direct `httpx.AsyncClient` POST — no Anthropic SDK:
```python
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
headers = {
    "x-api-key": self.api_key,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
}
```

Timeout: 60 seconds.

---

## PII Sanitization

`InferenceRouter.sanitize_context(messages)` strips sensitive data before sending to Claude:

| Pattern | Replacement |
|---------|-------------|
| IPv4 addresses (regex) | `[IP]` |
| MAC addresses (regex) | `[MAC]` |
| Serial numbers (S/N, SER#, SERIAL NO...) | `[SN]` |

Applied to both `str` content and `text` blocks inside multipart content lists.

**Note:** Sanitization is a static method — callers in `rag_worker.py` must call it explicitly.

---

## Prompt Loading

`get_system_prompt()` in `router.py` loads `active.yaml` on every call:

```python
_PROMPT_PATH = Path(__file__).parent.parent.parent / "prompts" / "diagnose" / "active.yaml"

def get_system_prompt() -> str:
    data = yaml.safe_load(open(_PROMPT_PATH))
    return data.get("system_prompt", "")
```

This enables zero-downtime prompt rollouts: edit `active.yaml` and the next inference call picks up the new prompt. If the file is missing or malformed, returns `""` (logged as warning).

**Rule:** Always use `yaml.safe_load()` — never `yaml.load()`.

---

## Usage Logging

`InferenceRouter.write_api_usage()` persists a row to the `api_usage` table in `mira.db` after every Claude call:

```sql
CREATE TABLE IF NOT EXISTS api_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    session_id TEXT NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    model TEXT,
    has_image BOOLEAN,
    response_time_ms INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

Cost estimate formula: `(input * $0.000003) + (output * $0.000015)` (logged by `log_usage()`).

---

## Langfuse Telemetry

`mira-bots/shared/langfuse_setup.py` initializes Langfuse. `mira-bots/shared/telemetry.py` provides:

```python
from shared.telemetry import trace as tl_trace, span as tl_span, flush as tl_flush

t = tl_trace("supervisor.process", user_id=chat_id)
with tl_span(t, "rag_worker"):
    raw = await rag.process(...)
tl_flush()
```

Required env vars:
```
LANGFUSE_SECRET_KEY
LANGFUSE_PUBLIC_KEY
LANGFUSE_HOST     # optional, defaults to cloud.langfuse.com
```

If Langfuse keys are missing, `telemetry.py` degrades gracefully (no-ops).

---

## Model Configuration

| Env Var          | Default                  | Purpose                    |
|------------------|--------------------------|----------------------------|
| `CLAUDE_MODEL`   | `claude-sonnet-4-6`      | Claude inference model     |
| `VISION_MODEL`   | `qwen2.5vl:7b`           | Local vision/OCR model     |
| `DESCRIBE_MODEL` | `qwen2.5vl:7b`           | Photo description in ingest|
| `EMBED_TEXT_MODEL` | `nomic-embed-text-v1.5` | Text embeddings (ingest)   |
| `EMBED_VISION_MODEL` | `nomic-embed-vision-v1.5` | Vision embeddings (ingest) |

---

## Error Handling

`InferenceRouter.complete()` catches all exceptions and returns `("", {})`:
- `httpx.HTTPStatusError` — logs status code and truncated response body
- Any other exception — logs error message

The caller (`rag_worker.py`) checks for empty string return and falls through to the Open WebUI path. This means the system degrades gracefully if Claude API is unreachable.
