---
name: inference-routing
description: MIRA dual-backend inference — Groq/Cerebras/Together cloud cascade vs local Open WebUI/Ollama, PII sanitization, Langfuse telemetry, prompt loading
---

# Inference Routing

## Source Files

- `mira-bots/shared/inference/router.py` — InferenceRouter cloud cascade
- `mira-bots/shared/workers/rag_worker.py` — RAGWorker, calls router or Open WebUI
- `mira-bots/prompts/diagnose/active.yaml` — system prompt loaded per call
- `mira-bots/shared/langfuse_setup.py` — Langfuse tracing setup
- `mira-bots/shared/telemetry.py` — trace/span wrappers

## Dual-Backend Architecture

```text
INFERENCE_BACKEND=cloud and at least one provider key set
    -> InferenceRouter.complete()
    -> Groq -> Cerebras -> Together
    -> Returns (content_str, usage_dict)

INFERENCE_BACKEND=local or no cloud providers configured
    -> Open WebUI at OPENWEBUI_BASE_URL
    -> Ollama backend -> qwen2.5vl:7b
```

The diagnostic cascade does not use Anthropic. The only current
owner-approved carve-out is the gated PrintSense print-vision interpreter.

## Provider Enablement

Providers are enabled by environment variables:

| Provider | Key |
|---|---|
| Groq | `GROQ_API_KEY` |
| Cerebras | `CEREBRAS_API_KEY` |
| Together | `TOGETHERAI_API_KEY` |

The cascade order is fixed in `_build_providers()`: Groq first, Cerebras
second, Together third. All three use OpenAI-compatible chat-completions APIs.

## InferenceRouter

### Enabled check

```python
self.enabled = self.backend == "cloud" and len(self.providers) > 0
```

If not enabled, `complete()` returns `("", {})`; callers fall through to the
local Open WebUI/Ollama path.

### Method signature

```python
async def complete(
    messages: list[dict],
    max_tokens: int = 1024,
    session_id: str = "unknown_unknown_unknown",
    sanitize: bool = True,
) -> tuple[str, dict]:
    # Returns (content_str, usage_dict); returns ("", {}) when all providers fail.
```

`session_id` format: `{tenant_id}_{platform}_{user_id}`. Usage data is written
to SQLite `api_usage`.

### Message format

The router accepts OpenAI-style chat messages. Image requests skip providers
that do not have a configured vision model. Groq currently defaults to no
vision model; Together carries the free vision path when configured.

### HTTP call

Direct `httpx.AsyncClient` POST to each provider's OpenAI-compatible endpoint.
No Anthropic SDK is used in the diagnostic cascade.

## PII Sanitization

`InferenceRouter.sanitize_context(messages)` strips sensitive data before cloud
dispatch:

| Pattern | Replacement |
|---|---|
| IPv4 addresses | `[IP]` |
| MAC addresses | `[MAC]` |
| Serial numbers | `[SN]` |

Sanitization defaults on inside `complete()`. Use `sanitize=False` only for
offline tests that verify sanitizer behavior.

## Prompt Loading

`get_system_prompt()` loads `mira-bots/prompts/diagnose/active.yaml` on every
call, enabling zero-downtime prompt rollouts. Always use `yaml.safe_load()`.

## Langfuse Telemetry

`mira-bots/shared/langfuse_setup.py` initializes Langfuse. `telemetry.py`
degrades gracefully when keys are missing.

Required env vars when enabled:

```text
LANGFUSE_SECRET_KEY
LANGFUSE_PUBLIC_KEY
LANGFUSE_HOST
```

## Error Handling

`InferenceRouter.complete()` catches provider errors, tries the next configured
provider, and returns `("", {})` only after all providers fail. The caller then
falls through to the local Open WebUI path or a structured exhausted-provider
fallback, depending on the call site.
