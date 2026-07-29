# Zero-Token Audit — inference seam inventory + promote-to-artifact backlog

**Date:** 2026-07-17 · **Governing rule:** `.claude/rules/zero-token-architecture.md`
(Hard Rule 1: paid inference = budget-declared validation of the artifact under
development, never a dev tool; Claude fixes developmental issues.)
**Evidence base:** `docs/research/2026-07-17-printsense-inference-burn-study.md`.

**Coverage honesty:** PrintSense is fully verified (every module partitioned). The
mira-bots seams below are enumerated with file:line evidence from a targeted sweep of the
real entry points (`router.complete`, `interpret_print`, embeddings). Deeper MIRA surfaces
(mira-hub agents, crawler enrichment, KG inference worker internals) get the same
treatment in a follow-up pass — rows marked *(unaudited)* are named, not scored.

## Table 1 — PrintSense partition (verified 2026-07-17)

52 of 57 modules are deterministic; inference concentrates in ONE seam.

| Layer | Modules | Tokens |
|---|---|---|
| Deterministic spine | `designations/` (9), `xref_extractor` + `xrefnorm`, `preprocess` (Pillow/Tesseract), `cas`, `identity_graph`/`systemgraph`/`pageset`/`package_scope`/`package_pipeline`, `gates`/`modes`/`providers/registry`, `render`/`reports`/`packets`/`customer_report`, all graders + 16 transforms + frozen cases | **0** |
| Inference seam | `interpret.py` (the paid call) + consumers `tiling.py`, `verify.py`, `cli.py`; `variance_study.py` (build-time bench) | paid |

## Table 2 — Runtime inference seams (5-question scoring)

| # | Seam (evidence) | Varies / Stable | Verdict |
|---|---|---|---|
| 1 | **Paid interpreter** — `printsense/interpret.py` via `engine.py:925–1001`, `telegram/bot.py:1282` | New photo varies; interpretation of the SAME image set is 100% stable | **Keep inference for new images; CACHE by content hash (ZTA-3)** |
| 2 | Interpreter prompt — 97% is the static 11.5k-char JSON schema, resent uncached (images precede text) | Schema stable per version | **Promote to cached prefix (ZTA-5)** |
| 3 | Effort/config — was floating per-run judgment | Calibration stable until model/prompt changes | ✅ **Already exported** (`PRINT_VISION_EFFORT=medium`, #2764); invalidation = model/prompt/schema bump |
| 4 | Photo classification — `vision_worker.py:345` (free cascade) | Each photo genuinely novel perception | **Keep inference**; deterministic cheap-rejects (caption signal logic #2760) already in front |
| 5 | Engine diagnosis turns — `engine.py:935/1107/1828/1903/3640/5541/5586`, `conversation_router.py:134` (free cascade) | Novel technician synthesis | **Keep inference** — it's the product; grounding stays deterministic (BM25/citations) |
| 6 | Narrow workers — `pm_extractor.py:346`, `nameplate_worker.py:159`, `query_triage.py:56`, `quality_gate.py:280`, `print_translator.py:301`, `rag_worker.py:1239/1249` | Mixed; triage/extraction have stable cores | **Audit individually in follow-up pass** — triage-shaped calls are decision-table candidates |
| 7 | Eval rubric — `eval_score_rubric.py:13/70` | Judge explains, never clears (already subordinated) | **Keep**; hermetic-first bounds it |
| 8 | Embeddings — `rag_worker.py`, `mira-crawler/ingest/embedder.py` | Embed-on-write = infer once per chunk, reuse forever | ✅ **Already ZTA-shaped**; watch the known embed-failure drop (~30% on large manuals) |
| 9 | Bench/live lanes — testkit paid runs | Validation of the artifact under development | **Governed by Hard Rule 1**: budget-declared, minimal, invalidation-triggered only |

## The backlog (priority order — nothing builds without Mike's go)

| ID | Item | Effect | Invalidation trigger | Size |
|---|---|---|---|---|
| **ZTA-1** | **Cost meter** — add `"openai": (5.0, 30.0)` to `_COST_PER_MTOK`; thread real `PRINT_OPENAI_USAGE` into envelopes; print running $ during paid lanes | Kills trap #8; burn visible live | pricing change | S |
| **ZTA-2** | **Budget guard** — `--budget-usd` hard-stop on every paid lane (default ~$2); `PRINT_VISION_MAX_TOKENS` default 32000→12000 (truncation grader-visible) | $0.96/call ceiling → ~$0.36; runaway sweeps impossible | effort recalibration | S |
| **ZTA-3** | **CAS interpretation cache** — key (image-set sha256, model, effort, prompt/schema version) in `printsense/cas.py`; hit → $0 + instant | Re-verifies + repeat sheets free; the flagship export | any key component | M |
| **ZTA-4** | **Phase-5 free-cascade default** — scheduled regression on the calibrated free cascade (proven 8/8); gpt-5.5 only on invalidation events / a qualification slot | Steady-state ≈ $0/mo (vs ~$5/mo) | cascade quality regression | S (design decision inside Phase 5) |
| **ZTA-5** | **Cache-friendly prompt order** — static schema ahead of images (or into `instructions`) so the ~3.7k-token prefix hits $0.50/M cache | ~70% off input side at product scale | schema/prompt reorder | S |
| **ZTA-6** | **Session evidence store** — persist interpretation packages per chat so text follow-ups consume the artifact instead of re-inferring (the measured Phase-3 product gap) | Follow-ups $0 + fast | new photos in session | M/L (product change — needs its own design) |
| **ZTA-7** | **Bench-gated cheaper tier** — gpt-5.4 ($2.50/$15) and 5.4-mini ($0.75/$4.50) through `provider_qualification.py`; adopt only if the frozen bar holds | Up to ~85% cheaper IF quality holds | model qualification run | M |
| **ZTA-8** | **Follow-up audit pass** — score the six narrow workers (row 6) + mira-hub/crawler surfaces with the 5 questions | Completes coverage | — | M |

**Mike-side (human-only, not a PR):** OpenAI dashboard hard monthly budget limit + alerts.

## Decision protocol

Each item ships as its own small PR under the normal gate (no merge/deploy without Mike).
ZTA-1 + ZTA-2 are the safety floor and should land before ANY further paid lane runs —
including the pending Phase-4 Lane A matrix when credits return.
