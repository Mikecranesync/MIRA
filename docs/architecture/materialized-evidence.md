# Materialized Evidence Architecture

**Status:** doctrine adopted (North Star amendment 2026-07-20); implementation on the PR ladder below.
This is the architecture the doctrine in `NORTH_STAR.md` § "Materialized Evidence and Recall-First
Architecture" describes. Engineering rules: `.claude/rules/materialized-evidence.md`. Decisions:
`docs/adr/0029-materialized-evidence.md`. What already exists to reuse:
`docs/architecture/materialized-evidence-inventory.md`.

> **The dataset — not the chat context — is the unit of machine memory.** Infer once, materialize
> every expensive discovery, validate/approve, compile into Capability Packs, recall unless the
> evidence changed.

## The five layers

```
Layer 1  Raw Source            immutable/revisioned source objects (PDFs, images, video, PLC
                               exports, manuals, work orders, logs, historian, sensor streams).
                               Authoritative. Tenant-scoped. Content-hashed.
   │
Layer 2  Materialized Evidence durable, typed, versioned discoveries from expensive stages —
                               accepted AND unresolved, with explicit status. (OCR tokens, page
                               classifications, device inventories, fault/param extractions,
                               cross-references, PLC findings, wiring, video detections, machine
                               event windows, telemetry features, contradictions, human corrections.)
   │                           MAY exist before it is trusted.
Layer 3  Approved Context      what a HUMAN validated (KG entities/relationships, tag mappings,
                               component profiles, document authority). The canonical approval
                               systems own this — NOT a new queue.
   │
Layer 4  Capability Packs      promoted, immutable, versioned runtime capability (lookup tables,
                               decoders, graphs, decision tables, deterministic handlers, bounded
                               inference instructions). References EXACT evidence dataset versions.
   │
Layer 5  MIRA Runtime          resolves packs → queries evidence → deterministic work first →
                               inference only through declared boundaries → technician explanation
                               with citations, confidence, limitations, trace.

Temporal coordinates the long-running movement between Layers 1–4. It is not a store.
```

## The recall-first runtime loop (Layer 5, §12)

Before MIRA performs expensive work: (1) resolve tenant + asset scope; (2) resolve the requested
capability; (3) resolve applicable Capability Packs; (4) determine the required evidence datasets;
(5) query the registry; (6) reuse exact compatible evidence; (7) identify gaps/conflicts/stale
dependencies; (8) recompute **only** missing/invalidated stages; (9) assemble approved evidence;
(10) call inference only when allowed; (11) materialize any new expensive discovery; (12) record cost,
lineage, and the reuse decision.

- **Follow-up rule:** a follow-up begins from previously materialized evidence; it must not
  automatically reprocess raw source.
- **Explanation rule:** a model may re-explain a recalled evidence chain (wording may change) without
  rerunning the perception layer, unless a dependency changed.

## Data contracts (full field lists in the PRD Appendix C; summary here)

- **Materialized Evidence Dataset (manifest)** — identity (`dataset_id`, `dataset_version_id`,
  `dataset_type`, `schema_name/version`, `content_hash`, `manifest_hash`, `tenant_id`, `environment`);
  source scope (`source_objects`, `source_hashes`, `source_revision`, `asset_refs`, `uns_paths`,
  `time_range`, `page_or_segment_scope`); producer lineage (`producer_name/version`,
  `repository_commit`, `model_provider/id/revision`, `prompt_contract_id/version`,
  `configuration_hash`, `parent_dataset_versions`); quality/trust (`stage_status`, `completeness`,
  `trust_status`, `approval_status`, `approval_refs`, `known_gaps`, `contradiction_count`,
  `unresolved_count`, `validation_results`); operations (`storage_ref`, `record_count`,
  `stale_state/reasons`, `supersedes`, `retention_policy`, `repair_doc_ref`, `workflow_run_ref`,
  `temporal_workflow_id/run_id`); economics (`wall/queue/compute_time_ms`, `model_input/output_units`,
  `provider_cost_usd`, `reused_parent_count`, `avoided_recompute_estimate`).
- **Evidence Record** — `record_id`, `dataset_id`, source locator, bounded excerpt/crop ref, typed
  payload, confidence, deterministic reasons, producer, status, `evidence_hash`, approval ref,
  contradiction refs, correction history, timestamps.
- **Recall Query → Result** — query carries tenant/scope/type/source-hashes/required-schema/allowed-
  producer-versions/allowed-trust/required-completeness/freshness; result is one of
  `exact | partial | stale | conflicting | none` with an explicit reason.
- **Recompute Decision** — `reused_exact | reused_partial | recomputed_{source,algorithm,schema,
  prompt}_changed | recomputed_{missing_output,corrupt,human_requested} | blocked_{conflict,approval,
  dependency}`. Every expensive stage logs one.

### Initial dataset types (one shared contract, typed payloads — NOT a registry per type)
`SourceInventoryEvidence`, `PageIdentityEvidence`, `OCREvidence`, `PageClassificationEvidence`,
`DeviceInventoryEvidence`, `FaultExtractionEvidence`, `ParameterExtractionEvidence`,
`CrossReferenceEvidence`, `WiringEvidence`, `PLCLogicEvidence`, `MachineEventEvidence`,
`VideoDetectionEvidence`, `TelemetryFeatureEvidence`, `ContradictionEvidence`, `HumanReviewEvidence`,
`PackBuildEvidence`.

## Content-addressed identity (§9)

Every expensive source and stage output is content-addressed: package/file/page/image/video/clip/
PLC-project/telemetry-window/stage-output/dataset/pack-artifact hashes. **Page identity must survive
reordering, duplicate uploads, renames, and partial replacement** (so replacing 1 page of 3,000
rebuilds 1 page's descendants, not 3,000). Video detections reference `(video_hash, start/end, frame
range, detector version)`; telemetry references `(asset, signals, time range, historian, ingestion
watermark, feature-algorithm version)`.

The seed already exists: **`printsense/cas.py`** keys derived artifacts on `(source_sha, stage,
algorithm/prompt version)` and never re-pays for an approved interpretation unless the source,
extraction version, or prompt version changes. This layer generalizes that.

## Dependency & invalidation (§10, Appendix F)

Explicit lineage edges between raw sources → stage datasets → reviewed evidence → approved context →
packs → reports/embeddings/summaries. On a change: identify affected descendants, mark them stale,
leave the rest valid, schedule only necessary rebuilds, never silently serve stale trusted output,
preserve previous versions for audit/rollback. The Appendix F invalidation matrix (change → must
invalidate → must-not-auto-invalidate) becomes executable tests.

## Agent-readable evidence summaries (§11)

A bounded per-dataset summary (name, purpose, schema, scope, lineage, counts, coverage, key entities,
unresolved/contradictions, trust/approval, freshness, example records, query ops, downstream packs,
cost, repair-doc link) — searchable by MIRA and Claude Code. **The summary indexes the evidence; it
does not replace it.** MIRA and Claude must not scan millions of records to learn what exists.

## Mapping to existing systems (reuse, do not duplicate — see the inventory)

| Concern | Reuse | Not a new… |
|---|---|---|
| Content-addressed derivation cache | `printsense/cas.py` (generalize) | — |
| Run ledger / workflow status | `WorkflowRun` (mig 044) + `mira-bots/shared/workflow.py` | second workflow ledger |
| Approval / trust transitions | `ai_suggestions`, `relationship_proposals`, KG approval (ADR-0017) | second approval queue |
| Capability Packs | `mira-bots/shared/drive_packs/` (schema/loader/packs) | second pack registry |
| Machine-run diff materialization | `tag_diff_historizer`/`tag_diff_logger`, run-diff (mig 060) | — |
| Dedup | `mira-crawler/ingest/dedup.py` | — |
| Materialized model-output eval | `conversation_logger` / `conversation_eval` / `print_autoeval` | — |
| Ingest contract | `mira-relay/ingest_contract.py` (one-pipeline law) | second ingest normalizer |

## Vendor neutrality (ADR A6)

Public evidence contracts are vendor-neutral. DataChain may be evaluated/used **behind** a MIRA-owned
evidence interface (PR L bake-off), but domain contracts must not depend on DataChain-specific types,
and no vendor becomes the approval authority or asset source of truth.

## PR ladder (this doc = PR A; the runtime layers follow, each reviewable, none merged without authorization)

| PR | Scope | Runtime change? |
|---|---|---|
| **A** | this doctrine + North Star + CLAUDE.md rule + ADRs + glossary | no |
| **B** | expensive-compute + materialization inventory + migration plan | no |
| **C** | evidence manifest + record + recall-query typed contract + hash helper + tests | additive, no wiring |
| D | Materialization Registry (records, scope, lineage, lookup) | additive |
| E | Recall resolver (compatibility gates, reason codes) | additive |
| F | Dependency graph + invalidation (stale propagation, affected-only rebuild) | additive |
| G | Agent-readable evidence summaries (search/query contract) | additive |
| H | Temporal materialization bridge (workflows/activities, `WorkflowRun` linkage, payload guards) | additive |
| I | **PrintSense vertical slice** (staged materialize, interrupt/resume, changed-page rebuild, recall-first follow-up) | the proof |
| J | Capability Pack compiler linkage (exact dataset deps, model-off proof) | additive |
| K | Cost ledger + promotion metrics | additive |
| L | DataChain bake-off + ADR (adopt/adapt/reject) | eval |
| M | Enforcement + duplicate retirement (CI checks, hidden-inference detection) | CI |

Do not big-bang. Keep every PR reviewable. Preserve foreign work. Merge only on explicit authorization.
