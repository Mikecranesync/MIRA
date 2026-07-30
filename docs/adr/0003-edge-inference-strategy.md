# ADR-0003: Edge Inference Strategy

## Status
Accepted

## Context

MIRA's diagnostic quality depends on LLM reasoning. The system must operate in two modes:
(1) cloud-quality inference when internet and API budget are available, and (2) degraded
but functional inference when the factory network is isolated or the API key is not set.
Vision processing (nameplate OCR, fault screen analysis) must always remain local because
sending raw equipment photos to a cloud API raises data privacy concerns on the factory floor.

## Considered Options

1. Anthropic Python SDK — official client, adds dependency, abstracts httpx
2. LangChain abstraction — framework layer over Claude + Ollama
3. Direct httpx calls — no SDK, single `InferenceRouter` class handles both paths

## Decision

**`INFERENCE_BACKEND` switches at runtime between `"cloud"` and `"local"`
(Open WebUI / Ollama).** Implementation uses `httpx` directly with no SDK or
framework. `InferenceRouter.complete()` in `mira-bots/shared/inference/router.py`
handles the Groq -> Cerebras -> Together cloud path. Policy revision 2.0 permits
LangChain generally, but this edge inference path still uses direct provider
calls because they are simpler and easier to test than an orchestration wrapper.

## Consequences

### Positive
- No Anthropic SDK version pinning — httpx is already in requirements
- Zero-downtime prompt rollouts: `get_system_prompt()` re-reads `prompts/diagnose/active.yaml`
  on every call
- PII sanitization (`sanitize_context()`) built into the router — strips IPv4, MACs,
  serial numbers before any cloud call
- Graceful fallback: `InferenceRouter.complete()` returns `("", {})` on any error;
  `RAGWorker` falls through to Open WebUI path automatically
- `write_api_usage()` writes token counts to `api_usage` table for cost tracking

### Negative
- Manual HTTP error handling instead of SDK-provided retry logic
- Provider image payloads can differ from OpenAI `image_url` format — conversion
  in `InferenceRouter.complete()` adds code to maintain
