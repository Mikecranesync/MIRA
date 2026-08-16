# ADR-0036 — Hub nameplate vision (Together) + manual-discovery (Serper) egress: a narrow, documented exception

**Status:** Proposed (accepted for the PR #3245 arc pending Mike's sign-off)
**Date:** 2026-08-16
**Raised by:** Codex review of PR #3245 ("cloud-governance violation: the Hub calls
Together directly, bypassing the governed inference router/sanitizer; Serper lacks
a documented production exception").

## Context

The governed inference boundary in this repo is `mira-bots/shared/inference/router.py`
(Python): the Groq→Cerebras→Together cascade with `sanitize_context()` (IPv4→`[IP]`,
MAC→`[MAC]`, serial→`[SN]`) default-on. Two Hub (TypeScript) code paths ship external
calls outside that boundary:

1. **Nameplate vision** — `mira-hub/src/lib/nameplate/index.ts` calls Together's
   OpenAI-compatible endpoint directly (model: `NAMEPLATE_VISION_MODEL` ||
   `TOGETHERAI_VISION_MODEL` || `google/gemma-3n-E4B-it`).
2. **Manual discovery** — `mira-ask`'s `/manual-discovery/search`
   (`shared/manual_search/search.py`) sends `(manufacturer, model/catalog)` strings
   to Serper.dev.

## Decision

Both egresses are **approved as narrow, named exceptions** rather than routed
through the Python router, with the scope limits below. Routing them through the
governed boundary is actively wrong for (1): the Python sanitizer masks serial
numbers — and reading identity strings **including serials** off a photo the user
deliberately submitted for that purpose is the entire feature. A cross-language
hop (Hub → bots router → Together) would add a network seam to *destroy the
payload the user asked us to read*.

## Scope limits (what the exception covers — and only this)

- **Nameplate vision**: equipment nameplate photos the tenant's user explicitly
  submitted for recognition, sent to Together only, from the two recognize routes
  + the confirm flow. NOT a chat/diagnosis provider; NOT part of the diagnostic
  cascade (PRD §4 / PR #610 unchanged); NEVER Anthropic.
- **Serper**: manufacturer/model/catalog identity strings only — never chat text,
  never notebook content, never tenant PII. Downstream URL probing is SSRF-guarded
  (search.py guard, 2026-08-16) and downloads run through the hardened Hub
  downloader's allowlist.
- **Credentials**: Doppler-managed (`TOGETHERAI_API_KEY`, `SERPER_API_KEY`);
  provider error text is scrubbed of query-string credentials (PRD §20).
- **Data at the provider**: nameplate photos are transient inference inputs; no
  training opt-in; Together is already this repo's licensed inference provider.

## What would violate this ADR

- Any Hub-direct LLM call for chat, diagnosis, summarization, or notebook content.
- Sending chat/document text to Serper.
- A second Hub-side provider (this exception names Together + Serper, not a pattern).

## Consequences

- The Hub keeps a TS-native, latency-tight vision path (live-qualified 2026-08-15/16).
- Governance reviewers have ONE place that says why these two egresses exist; the
  `code-review.yml` cascade + ast-grep secret rules still apply to the call sites.
