# ADR-0031: PrintSense Provider & OCR Hardening

**Status:** Accepted (build phase; production activation separately gated)
**Date:** 2026-07-21
**Driver:** PRD "PrintSense Provider and OCR Hardening" (owner-supplied, P0 reliability)
**Relates to:** ADR-0028 (ZTA), ADR-0029 (materialized evidence), `printsense/providers/registry.py` (capability qualification), PR #2857 CLF approved-providers spec (unmerged)

## Context

PrintSense has three disjoint provider abstractions and no single answer to
"is PrintSense ready to interpret this print with Together/MiniMax and verify
it with Tesseract?":

1. `printsense/interpret.py` — paid typed interpreter; supports ONLY
   `openai`/`anthropic`; resolves `PRINT_VISION_PROVIDER` **at import time**
   (stale until process restart); an unknown provider value silently falls
   into the Anthropic code branch.
2. `mira-bots/shared/inference/router.py` — free cascade (Groq→Cerebras→
   Together) gated by `INFERENCE_BACKEND=cloud`; Together via legacy
   `api.together.xyz`; vision model `TOGETHERAI_VISION_MODEL`.
3. `factorylm_ai/providers/together.py` — lab provider gated by
   `FACTORYLM_AI_ALLOW_NETWORK`; Together via canonical `api.together.ai`.

Tesseract ships in both bot images, but compose healthchecks only assert
"bot.py is running"; Telegram boot-logs `ocr_lane_report()` while Slack never
calls it; `tools/provider_health_check.py` probes Together **text** only, so
"Together UP" says nothing about PrintSense vision readiness. Print of the
Day has zero trace on `main` (the surface PRD rides unmerged PR #2857).

## Decision

One canonical **provider configuration registry** + typed capability
contract, consumed by every PrintSense-adjacent runtime:

1. **`factorylm_ai/provider_registry.py`** (PR 2) owns provider names,
   key-env names, base URLs, text/vision models, timeouts, network gating,
   readiness and redacted diagnostics. `router.py`, `factorylm_ai/providers/
   together.py`, `printsense/interpret.py`, the judge, the canary, and Print
   of the Day consume it. Duplicate defaults are deleted by the end of the
   ladder. Bot images gain `COPY factorylm_ai/` (the package is import-safe:
   env read at call time, network hard-gated).
2. **Two Together hosts are preserved as data, not drift:** the registry
   carries `cascade_url` (`api.together.xyz` — the free cascade's proven
   endpoint) and `canonical_url` (`api.together.ai` — typed/lab calls)
   per provider. Unification is a Phase-E cleanup with its own soak, not a
   silent side effect of refactoring.
3. **Qualification stays separate from configuration.**
   `printsense/providers/registry.py` (evidence-signed capability
   qualification, fail-closed) is NOT merged into the config registry —
   authorization (`config/providers/approved.yml`), configuration
   (`provider_registry.py`), and qualification (`capabilities.json`) are
   three different questions with three owners. The PRD's "one registry"
   applies to configuration; this ADR records the boundary explicitly.
4. **Typed codes** (`factorylm_ai/capability_codes.py`, FR-10) and the
   **capability report** (`factorylm.runtime-capabilities.v1`,
   `factorylm_ai/schemas/runtime_capabilities.schema.json`, FR-1) are the
   contract every readiness/report surface keys on.
5. **Approved-provider policy** lives in Git at
   `config/providers/approved.yml` (FR-9): `printsense_interpreter` requires
   Together + `MiniMaxAI/MiniMax-M3` (OpenAI/Anthropic remain approved
   rollback/benchmark alternatives, never silent fallback);
   `printsense_judge` = approved free cascade with independence recorded;
   `print_of_the_day` = strict Together/MiniMax + OCR + clean worktree.
6. **Network gate:** one canonical `FACTORYLM_NETWORK_MODE=enabled|disabled`
   (PR 2). Migration mapping: `INFERENCE_BACKEND=cloud` ⇒ enabled;
   `FACTORYLM_AI_ALLOW_NETWORK` truthy ⇒ enabled; canonical var wins when
   set; explicitly contradictory legacy values raise
   `INVALID_CONFIGURATION` at startup; legacy use logs a deprecation
   pointer. Tests/CI default network-disabled (no env set).
7. **Together becomes a first-class typed interpreter provider** (PR 3):
   `printsense/interpret.py` gains an explicit `together` branch (OpenAI-
   compatible chat/completions at the canonical host, schema-reinforced
   strict-JSON request, defensive first-JSON-object extraction,
   `PrintSynthGraph.model_validate`, usage attribution) and provider
   resolution moves to **call time**. `PRINT_PROVIDER_POLICY=
   strict|allow_fallback` (strict = default for production/staging/POTD:
   stop with `REQUIRED_PROVIDER_UNAVAILABLE`, never switch providers;
   allow_fallback records every attempt and marks the output).
8. **Tesseract is a required operational capability** (PR 4):
   `OCR_REQUIRE_TESSERACT=1` (legacy `OCR_EXPECT_TESSERACT` honored during
   migration) makes readiness fail — not degrade — in operational profiles;
   Telegram and Slack share one readiness function; compose healthchecks
   verify the capability artifact, not just the process name.
9. **`python -m factorylm_ai.readiness --profile printsense`** (PR 4, FR-2)
   is the one readiness command; exit codes 0 ready / 1 capability missing /
   2 invalid config / 3 probe infra failure; writes the FR-1 report.
10. **Vision canary** (PR 5): `tools/provider_health_check.py` gains a
    Together vision probe (deterministic image fixture, known-token read) —
    a provider is not PrintSense-ready on a text probe alone.
11. **Containerized Print of the Day** (PR 6): pinned image, recorded git
    SHA + image revision labels, refuses dirty/mismatched/keyless/OCR-less
    starts, strict policy, full provenance in artifacts and mail.

## PR ladder

| PR | Content | Runtime change |
|----|---------|----------------|
| 1 | This ADR, `approved.yml`, typed codes, capability schema, contract tests (future behavior = xfail) | none |
| 2 | Provider registry + network gate; router/factorylm consume; Dockerfile COPY + packaging tests | behavior-preserving |
| 3 | Together/MiniMax in `interpret.py`; call-time resolution; strict/fallback policy; attribution | dark until env flip |
| 4 | Readiness command; OCR requirement; shared bot readiness; healthcheck + compose/packaging tests | staging-visible |
| 5 | Vision canary + incident reporting | monitoring only |
| 6 | Containerized POTD | new surface |
| 7 | Staging activation (strict Together/MiniMax) + live E2E | staging only |
| 8 | Production activation — **owner approval required** | production |

## Consequences

- Provider truth becomes testable: hermetic tests pin selection, startup
  failure, fallback policy, OCR enforcement, provenance.
- Controlled runs fail closed; customer chat keeps its clearly-labeled
  degraded path (typed interpretation unavailable ≠ general vision prose).
- Rollback is an env flip (`PRINT_VISION_PROVIDER=openai|anthropic` where
  funded/approved) that keeps the registry, readiness, OCR enforcement, and
  provenance in place.
- No CI network calls: all CI tests use fixtures/mocks; live probes are a
  separately permissioned staging workflow.
