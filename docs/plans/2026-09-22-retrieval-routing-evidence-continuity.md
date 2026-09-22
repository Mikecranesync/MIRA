# Retrieval routing, evidence continuity, and evidence enforcement (notebook chat)

**Date:** 2026-09-22 · **Branch:** `fix/retrieval-routing-evidence-continuity` · **Base:** `f0be2ff20` · **Follows:** #3940/#3941 (flight recorder), #3942
**Trigger:** staging traces `952036aa…`, `8906786b…`, `ae30230b…` (Mike's Pixel session 04:46–05:15Z) — retrieval never executed, prior photo evidence lost on a text follow-up, an unsupported exact rating answered.

## Root causes (file:function)

| # | Symptom in traces | Cause | Location |
|---|---|---|---|
| 1 | `retrieval.strategy=skipped_general_mode`, `executed=false`, `oem_corpus_searched=false` on every turn | The route's ONLY retrieval call is scoped to notebook sources, and is skipped outright when `mode==="general"`. There is no OEM/shared-corpus path in this route at all, so a notebook with no attached documents can never search anything, whatever the identity state. | `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts` — `const chunks = general \|\| nodeId === null ? [] : retrieveNodeChunks(...)` (~L1465); the OEM helper `retrieveManualChunks` (`mira-hub/src/lib/manual-rag.ts:276`) is used by the asset-chat route but never here. |
| 2 | Text follow-up: `history_turns=2` but `visual_evidence_count=0`, `prior_visual_observations_considered=0` | Prior photo observations are only loaded for the CURRENT request's `visualEvidence.fileId` (`loadVisualEvidenceForPhoto`). The route never looks at earlier turns of the same notebook/thread, and the client history is text-only by construction (`sanitizeHistory`), so the count is honestly hard-coded 0. The durable ids exist server-side: every photo turn persists a `visual_observation{fileId}` entry in `equipment_notebook_turns.evidence`, and the LOOK observation text is in `observation`/`evidence_item` keyed by that `file_id`. | route.ts ~L1105 (`lookRow` for the current file only), ~L1508 (`prior_visual_observations_considered: 0`); `equipment-notebooks.ts:listTurns`; `visual-evidence-context.ts:loadVisualEvidenceForPhoto`. |
| 3 | `evidence_sufficient=false` yet `decision=answered`; `GENERIC_ANSWER_UNGROUNDED_CLAIM` on photo turns | `evidenceSufficient` and `ungroundedUnitClaim` are computed AFTER the stream closed, as observability only; `answerStatus` never reads them. The pre-display gate (`validateAnswer`, default ON) does exist and DOES reject general-lane specificity — but only the imperative shape ("set/torque … to N units", `EXACT_SETTING_RE`). A **declarative** exact rating ("operating range is –20 °C to +60 °C", "width 2.5 in") passes. | route.ts ~L2392 (`evidenceSufficient` unused by the decision); `mira-hub/src/capabilities/answer-validation.ts:validateAnswer` (B lane), `EXACT_SETTING_RE` L383. |
| 4 | `gen_ai.usage.input_tokens=[REDACTED]` | `redactAttributeValue` redacts by key regex `/…\|token\|…/i`, which matches `…_tokens`. | `mira-hub/src/capabilities/observability/tracing.ts:redactAttributeValue`. |
| 5 | Empty arrays render as `{"arrayValue":{}}` | Langfuse's OTLP mapping of an empty `arrayValue`; setting an empty array attribute is the trigger. | `tracing.ts:clampValue` — drop empty arrays instead of emitting them. |

## Policy (design A)

Retrieval is chosen by evidence context, in this order, first match wins:

1. `notebook_sources_bm25` — validated notebook doc ids exist (grounded mode). Unchanged.
2. `oem_corpus_bm25` — no notebook docs, but the turn has an **equipment context**: a resolved/bound asset, or the notebook row carries `manufacturer` or `model`, or a current/prior visual observation on this thread names a manufacturer/model (the LOOK text). Query = the technician message; scope = `retrieveManualChunks(rawPool, tenantId, query, { manufacturer, allowTenantFallback: false })` (hybrid law: `is_private=false OR tenant_id=$caller`, approval gate honoured, raw pool — the same call the asset-chat route makes). `allowTenantFallback:false` so an unrelated question never sweeps the whole tenant corpus.
3. `skipped_general_mode` — no docs and no equipment context. Unchanged.

Equipment context never comes from the client's free text alone (UNS gate doctrine): it comes from the bound asset, the notebook identity fields, or server-stored visual observations. The manufacturer passed to the OEM query is the notebook's `manufacturer` when set, else the first manufacturer token the LOOK observation text contains from the corpus's known manufacturer list — resolved server-side, once, and recorded on the span as `mira.retrieval.oem_manufacturer_source`.

OEM chunks feed the SAME prompt/citation path as notebook chunks (`buildManualUserContent`, `citationsUsedInAnswer`), so the answer is cited or abstains. Gate G semantics: with equipment context but zero OEM hits, the turn stays general (the technician still gets help) but `evidence_sufficient=false` and the specificity rule below applies.

## Evidence continuity (design B)

Before context assembly, for a chat turn with no current photo: `listTurns(tenantId, notebookId, 6, { threadId, viewerUserId })` → collect `visual_observation.fileId` entries from the newest turns → `loadVisualEvidenceForPhoto` for up to 2 distinct files (newest first) → render with `renderLookObservationSection` under a "Earlier photos in this conversation" header → append to the same evidence block the current photo uses. Records: `prior_visual_observations_considered = N`, `visual_evidence_count += N`, span/packet ids list `mira.visual.prior_file_ids`. Server-owned; the client sends nothing new. Bounded (2 photos, existing text caps in the renderer) so prompt size stays predictable.

## Enforcement (design C)

`validateAnswer` gains `evidenceSufficient: boolean` and a new general-lane rule, `unsupported-specificity:exact-rating`, applied only when `!evidenceSufficient`: a declarative equipment claim asserting an exact unit-bearing value — `(rated|rating|range|maximum|minimum|max|min|nominal|operating|supply|input|output|limit|spec|specification|tolerance|clearance|torque|pressure|voltage|current|speed|temperature)…(is|are|of|=|:)…N unit` or `N unit … (rated|rating|nominal|maximum|minimum)`. Units: V, A, Hz, RPM, bar, psi, kPa, MPa, N·m, ft-lb, °C/°F, mm, in. Ranges (`0…+50 °C`, `–20 to 60 °C`) count. Hedged, non-assertive sentences ("typically", "often", "many manuals", "for example") are NOT matched — the rule targets assertions presented as this machine's fact. Replacement = `specificityFallback(null)` (existing). The existing `unsupported_specificity` plumbing (rejection, replacement, `blocked` decision, zero citations, no persistence of the draft) is reused unchanged.

`evidenceSufficient` is computed BEFORE validation (chunks, machine entry, current or prior look context) and passed in; the post-stream observability copy uses the same value.

## Telemetry (design D)

- `redactAttributeValue`: key-based redaction matches `token` only as a whole word or `_token`/`-token` suffix (`session_token`, `access-token`, `x-auth-token`), never `_tokens` plural, and never under the `gen_ai.usage.` prefix. Value-based redaction unchanged.
- `clampValue`: an empty array is dropped (attribute not set) — the packet still records `[]`.
- Regression tests for both.

## Files

`route.ts` (routing, prior evidence, evidenceSufficient into validator), `answer-validation.ts` (+rule, +param), `tracing.ts` (redaction, empty arrays), `turn-evidence-packet.ts` (+`retrieval.oem_manufacturer_source`, +`visual_evidence.prior_file_ids`), tests: `answer-validation.test.ts`, `tracing.test.ts`, `chat-flight-recorder.test.ts` (+3 cases), new `chat-retrieval-routing.test.ts`.
