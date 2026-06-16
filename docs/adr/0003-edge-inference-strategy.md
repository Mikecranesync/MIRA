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

**`INFERENCE_BACKEND` environment variable switches at runtime between `"claude"` and
`"local"` (Open WebUI / Ollama).** Implementation uses `httpx` directly with no SDK or
framework. `InferenceRouter.complete()` in `mira-bots/shared/inference/router.py` handles
the Claude API path. Vision workers (`VisionWorker`, GLM-OCR) always call Ollama on
the local host regardless of `INFERENCE_BACKEND`. LangChain is explicitly banned per
project hard constraints.

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
- Claude image block format differs from OpenAI `image_url` format — conversion handled
  in `InferenceRouter.complete()` but adds code to maintain
