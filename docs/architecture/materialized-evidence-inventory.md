# Materialized Evidence — Expensive-Compute & Existing-Systems Inventory

**Purpose (PRD §19, PR B):** before building the Materialized Evidence layer, inventory (a) every
expensive processing path, (b) every existing materialization-like system to REUSE, (c) duplicate
risks, (d) gaps, (e) a migration plan. **Rule: reuse existing systems; mark unknowns; do not guess.**

**Verification depth:** the systems below were located by a read-only sweep of `origin/main`
(`5fa32cb8`) 2026-07-20. Items marked **⚠ unverified** were not opened in this pass and need
confirmation before design relies on them.

## A. Expensive processing paths (what they cost, what they materialize today)

| Path | Where | Expensive stage | Materializes today? |
|---|---|---|---|
| **PrintSense interpret** | `printsense/interpret.py` (theory + verify) | vision model (paid) | per-turn reply + `conversation_eval` (autoeval); **CAS** for graphs |
| **PrintSense CAS** | `printsense/cas.py` | — (the cache itself) | ✅ **content-addressed derivation cache, keyed `(source_sha, stage, algo/prompt version)`** — the SEED |
| **Vision/OCR** | `mira-bots/shared/workers/vision_worker.py` | Tesseract floor + model-OCR lane | `ocr_items` w/ `ocr_source` provenance (per-turn); model-OCR-lane **cost discarded** (`:592`) |
| **Nameplate extract** | `mira-bots/shared/workers/nameplate_worker.py` | vision model | nameplate dict → `asset_identity` (per-turn) |
| **Drive Pack extraction** | `tools/drive-pack-extract/extractor.py` (+ grader, registry) | pdfplumber (deterministic) | ✅ candidate JSON + grading report + promoted `packs/` |
| **Document ingestion** | `mira-crawler/ingest/` (chunker, `dedup.py`, store) | chunking + embeddings | ✅ `knowledge_entries` chunks + embeddings (NeonDB) |
| **PLC parsing/analysis** | `mira-plc-parser/` (analyze/detect/pipeline/parsers) | parse → MIRA IR | ⚠ unverified whether IR is durably content-keyed |
| **Wiring extraction** | `mira-bots/shared/wiring_profile/`, wiring-print reader | vision/graph | `wiring_connections` + KG (approval-gated) |
| **Machine memory / historian** | `mira-relay/tag_diff_logger.py`, `mira-crawler/tasks/tag_diff_historizer.py`, run-diff (mig 060) | diff/feature compute | ✅ `tag_events`, run-diffs (materialized) |
| **Embeddings** | ingest + retrieval | embedding model | ✅ in `knowledge_entries` |
| **Provider calls** | `mira-bots/shared/inference/router.py` | any model call | usage logged (partial — some lanes discard) |
| **Video tools** | — | — | ⚠ **not found this pass** — likely absent/nascent (mark ABSENT until confirmed) |
| **ZTA model lab** | `factorylm_ai/` | training/eval | flywheel records, artifact registry (isolated package) |

## B. Existing materialization-like systems to REUSE (do not duplicate)

| System | Path | Role in the target architecture |
|---|---|---|
| **Content-addressed derivation cache** | `printsense/cas.py` | **generalize into the platform Evidence Payload Store** — it already does `(source_sha, stage, version)` keying + hash-only logging + atomic writes |
| **Run ledger** | `WorkflowRun` (`mira-hub/db/migrations/044_workflow_runs.sql`), `mira-bots/shared/workflow.py`, `mira-hub/src/lib/workflow.ts` | the `workflow_run_ref` in every manifest; Temporal bridge links to it (ADR A5) |
| **Dedup** | `mira-crawler/ingest/dedup.py` | source-identity dedup for intake |
| **Materialized model-output eval** | `mira-bots/shared/conversation_logger.py` → `conversation_eval`, `print_autoeval` | per-turn evidence today; a source of `HumanReviewEvidence`/quality signals |
| **Approved context + approval systems** | `kg_entities`/`kg_relationships`, `ai_suggestions`, `relationship_proposals` (ADR-0017) | Layer 3; **the only approval path** — never a new queue |
| **Capability Packs** | `mira-bots/shared/drive_packs/` (schema/loader/`packs/`) | Layer 4; `PackBuildEvidence` references exact evidence versions |
| **Ingested tag evidence** | `tag_events`/`approved_tags` (`mira-relay`) | telemetry-domain evidence; one-pipeline law (`ingest_contract.py`) |
| **Machine-run diffs** | `tag_diff_historizer`/`logger`, run-diff (mig 060) | `MachineEventEvidence`/`TelemetryFeatureEvidence` precedent |
| **Document chunk store** | `knowledge_entries` | retrieval evidence (hybrid tenant-scoping rules apply) |
| **Distillation (propose, human-gated)** | `tools/harvest_golden_cases.py`, `tools/relational_distill.py` | the "propose, never auto-write" pattern evidence promotion mirrors |

## C. Duplicate risks (the anti-patterns to retire, PRD §19 + §24)

- **Results stored only in logs/chat.** Many model outputs (OCR reads, interpretations) are durable
  today *only* as a per-turn `conversation_eval` row or the chat reply — not as a queryable, reusable
  typed evidence dataset. This is the primary gap the amendment closes.
- **Per-domain caches with different keys.** `printsense/cas.py` (printsense-local) vs. drive-pack
  candidates (tools-local) vs. `knowledge_entries` (ingest) — no unified catalog. Risk of N caches.
- **Staged candidates outside a registry.** `tools/drive-pack-extract/candidates/` is real evidence
  invisible to any catalog.
- **Workflow state across Celery + DB + (future) Temporal.** `WorkflowRun` + Celery today; a Temporal
  bridge must LINK to `WorkflowRun`, not fork a second ledger (ADR A5).
- **Unversioned inference outputs / unregistered intermediate files.** Cost/lineage not attached.
- **OCR-model-lane cost discarded** (`vision_worker.py:592`) — economics blind spot.

## D. Gaps (what the target architecture adds on top of what exists)

1. **No shared evidence manifest/registry** across domains (each pipeline is islanded). → PR C/D.
2. **No cross-domain recall resolver** with reason codes (reuse logic is ad-hoc or absent). → PR E.
3. **No explicit lineage/invalidation engine** (CAS keys on version but has no descendant-
   invalidation graph). → PR F.
4. **No agent-readable evidence-summary index.** → PR G.
5. **No Temporal orchestration** (Celery + `WorkflowRun` today; migration is additive). → PR H.
6. **Model outputs materialized per-turn only**, not as reusable typed datasets (`OCREvidence`,
   `DeviceInventoryEvidence`, …). → PR C + PR I (PrintSense slice).
7. **Cost ledger incomplete** (discarded lanes). → PR K.

## E. Migration plan (additive, no big-bang — maps to the PR ladder)

1. **PR C** — a vendor-neutral typed manifest + record + recall-query contract + content-hash helper
   (Appendix C). No wiring.
2. **PR D** — a Materialization Registry that **references** (never copies) `WorkflowRun`, asset
   identity, KG approval, and the pack registry. Generalize `printsense/cas.py` as the payload store.
3. **PR E** — the recall resolver; wrap the FIRST expensive stage (PrintSense OCR) behind it,
   preserving current behavior when no compatible evidence exists.
4. **PR F–G** — lineage/invalidation + evidence summaries.
5. **PR H** — Temporal bridge, linking to `WorkflowRun`; large payloads stay in FactoryLM storage.
6. **PR I** — the PrintSense vertical slice as the proof (staged materialize, interrupt/resume,
   changed-page rebuild, recall-first follow-up, model-off query).
7. **PR J–K** — Capability Pack compiler linkage (drive_packs) + cost/promotion metrics.
8. **PR L–M** — DataChain bake-off ADR + enforcement/duplicate-retirement.

**No existing system is deleted before its replacement is proven** (PR M retires only what a landed
replacement supersedes). `printsense/cas.py` is generalized, not thrown away — it is the working proof
that the pattern is right.

## F. Unknowns to confirm before the design relies on them
- ⚠ PLC-parser IR durability/keying (`mira-plc-parser/`).
- ⚠ Video-analysis paths (none found this pass — confirm ABSENT vs. nascent).
- ⚠ Provider-capability/qualification records location (referenced in ZTA work; not opened here).
- ⚠ Exact `WorkflowRun` column set (mig 044 opened only enough to confirm it exists).
