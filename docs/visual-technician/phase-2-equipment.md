# MIRA Visual Technician — Phase 2 (equipment/nameplate intelligence) — architecture notes

Implements the equipment path of the PRD (`docs/prd/mira-visual-technician.md`) per ADR-0027's phased
plan. **Stacked on Phase 1** (`feat/vt-phase1`, PR #2645) — depends on the visual-session schema
(migration 063) + store + `EvidenceState` + `answer_composer`. PR-only; nothing merged/deployed.

## The thin deterministic path (built)

```
photo → quality gate → visual observation → equipment identity candidates
      → service-pack resolution → evidence-graded, cited session answer
```

## What now exists today (updates the ADR-0027 "exists today" state)

Before Phase 2, the ADR listed equipment interpretation as a *reuse target* (workers existed) but there
was **no session-integrated equipment path**. Phase 2 adds it:

- **`mira-bots/shared/visual/equipment.py`** (new):
  - `resolve_equipment(...)` — resolves each identity signal (nameplate, model, make+model) **independently**
    via the existing `resolve_service_pack`, then compares. This closes the resolver's **cross-signal
    conflict blind spot** (it short-circuits on the first single-match signal, so `drive_name=GS10` +
    `nameplate=PowerFlex525` would silently return GS10). Decision tree: >1 distinct resolved →
    `CONFLICTING`; exactly 1 with no contradicting ambiguity → `RESOLVED`; else `AMBIGUOUS`/`NONE`.
    `pack_id` is non-None **only** for `RESOLVED`. Deterministic (sorted throughout); no LLM.
  - `default_manual_retriever` (injectable) — lazy `neon_recall.recall_knowledge`, tenant-scoped by the
    **session's `tenant_id`** (the only guard — `neon_recall` has no RLS backstop), vendor-relevance
    filtered, graceful-empty on any failure.
  - `answer_equipment(...)` — deterministic pack-fact lookups (fault codes / parameters / envelope) +
    tenant manuals → persisted as `DOCUMENTED` observations with `{doc,page,excerpt}` citations →
    composed through the **unchanged** Phase 1 `answer_composer`.
- **`session_service.py`** (extended, additive) — a nameplate/equipment ingest route (`NameplateWorker` →
  `VISIBLE` observations with **raw OCR kept separate from normalized fields** → `resolve_equipment` →
  persisted identity/candidate/conflict observation) + `ask_equipment(...)`. The Phase 1 print route +
  `ask` are byte-identical.

## Reused, not recreated

`resolve_service_pack` + the Drive Commander pack registry (`durapulse_gs10`, `powerflex_40`,
`powerflex_525` — all shipped, cited `pack.json`), `NameplateWorker` + `build_asset_identity`,
`neon_recall` + vendor-relevance filtering, and the Phase 1 store / `EvidenceState` / `answer_composer`
(unmodified). **No new migration** — the `observation` ledger's JSONB `metadata` holds candidates/confidence.

## Behavior guarantees (Phase 2 rules → where enforced)

Raw-vs-normalized provenance (separate observations); 0/1/many candidates with evidence + confidence;
**never silently selects on conflict/incomplete** → `NEEDS_CONTEXT` with a specific requested photo/field;
cited answers from pack + tenant manuals; inference stays `LIKELY`; **never invents** (composer yields
`NEEDS_CONTEXT` when nothing grounded matches); Phase 1 **energization safety short-circuit preserved**
(fires even without a resolved identity); **cross-tenant isolation** (session `tenant_id` threaded into
retrieval + real-Postgres RLS on observations); graceful degrade on OCR/vision/resolution/retrieval failure.

## Test evidence

64 Phase 2 tests + 38 Phase 1 (102 total, **zero regressions**); real-Postgres tenant isolation as
`factorylm_app`; `ruff check` + `ruff format --check` clean. Areas: evidence-state transitions, append-only
history, raw-vs-normalized, deterministic ranking, conflict/ambiguity refusal, citation propagation,
no-invented-claims, tenant isolation, graceful failure, no-regression.

## Known limitation

`default_manual_retriever`'s live path (`neon_recall` + Ollama embed against staging Neon) is exercised
via injected fakes in tests but **not** verified against live infra (no staging access — env boundaries).
Deterministic pack-fact lookups are fully real (read from shipped `pack.json`).

## Phase 3 handoff

Phase 3 = multi-photo sessions + **contradiction engine** + reviewer workflow. Seams already present:
observations are **append-only with `superseded_by`** (a contradiction detector can mark, not delete);
`CONFLICTING` is a first-class `EvidenceState`; candidates/confidence live in `observation.metadata`.
Phase 3 should add cross-photo entity/terminal reconciliation + an active contradiction detector over the
ledger + a reviewer queue (reuse `ai_suggestions` per ADR-0027). Do **not** fold contradiction logic into
`answer_composer` (safety-critical, keep unmodified) — add a separate detector. Not built here (out of scope).
