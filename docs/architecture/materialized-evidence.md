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

## First vertical flow — the batch-document evidence receipt (shipped)

The first working consumer of this contract is the **batch OEM-manual lane**
(`mira-crawler/tasks/full_ingest_pipeline.py`), compiled by
`materialized_evidence/document_compiler.py`:

```
raw document (downloaded PDF)
  → byte identity            sha256 of the ACTUAL bytes  → PageIdentityEvidence (candidate)
  → local text / Tika extraction (already performed)     → OCREvidence         (candidate)
  → reference to the existing knowledge_entries / raw-source materialization
  → manifest receipt in a MaterializationRegistry (FileRegistry snapshot)
  → [future] recall / runtime consumer
```

**Two datasets, one document.** `PageIdentityEvidence` records the document's byte identity;
`OCREvidence` records what the extractor did and descends from it via `parent_dataset_versions`, so a
re-extraction invalidates only the extraction layer, not the document's identity.

**`OCREvidence` is a *stage* name, not a claim about how the text was obtained.** The vocabulary above
names one extracted-text stage and this flow uses it rather than forking the contract — so the honest
distinction is carried explicitly instead: `schema_name` is `document_text_extraction` (never
`..._ocr`), and every record payload carries `extraction_method` verbatim (`pdfplumber`, `pypdf`,
`tika_ocr`, …), a derived `extraction_mode` (`text_layer` | `ocr` | `none` | `unknown`), and an
explicit `is_ocr` boolean. A non-OCR dataset also states it in `known_gaps`. **A text-layer parse is
never labelled OCR.** The mode mapping is total: an unrecognised method is `unknown`, never
`text_layer`.

**Page identity is not fabricated.** `PipelineReport.extract_pages` counts markdown headings — an
*estimate*, not page provenance. This extraction layer supplies no page identity, so the dataset is
**document-scoped**, declares the gap in `known_gaps`, and leaves `completeness` `None` (a numeric
`1.0` would let a future page-level recall query pass resolver gate 3 against evidence that has no
pages at all). The compiler accepts verified pages when a caller genuinely has them; the batch lane
passes none.

**What this slice deliberately does not do.** It makes **no automatic recompute-or-skip decision** —
it never calls `resolve_recall`, so it cannot skip an extraction, convert a failed extraction into a
success, or retry a quarantined document. Writing a receipt is purely additive. Trust stays
`candidate` and approval `pending`; the compiler raises rather than emit anything else.

**Determinism is load-bearing, and subtle — two distinct traps.** `manifest_hash` covers every
manifest field except the two hash fields, and the registry rejects a re-register of one
`dataset_version_id` with a different `manifest_hash` (ADR A3). So *anything* that varies between runs
but is absent from the version key produces a permanent `immutable version conflict` — swallowed by
the lane's fail-open path, invisible in a fresh-registry test, and recall is silently dead forever.

1. **Clock/cost fields.** `created_at`, `wall_time_ms`, `compute_time_ms`, and the cost fields are
   left `None` (enforced by `_DETERMINISM_MUST_BE_UNSET`) and reported in `PipelineReport` instead.
2. **Provenance fields.** `source_objects` (the fetch URL, redacted to origin+path — a CDN change,
   mirror, or http→https still varies it; a query token no longer does, since it is stripped before
   persisting) and `storage_ref` (the local path, per-host via `MANUALS_ROOT`) legitimately vary for
   identical bytes. The fix is not to freeze them but to make the version key **content-derived**:
   `dataset_version_id` is a hash over every manifest field except itself and the two hash fields,
   plus the records' `content_hash` (`_with_version_id`). Any content difference is therefore a new
   *version*, never a conflict. Callers cannot preset it.

Byte identity remains the **recall** key: `dataset_id` is byte-derived and `source_hashes` is what
`registry.find` / `resolve_recall` match on. Two fetch URLs for identical bytes yield two versions of
one dataset with an **identical** `content_hash`, so the resolver selects one instead of reporting a
conflict — which is why record `source_locator`s are content-addressed (`sha256:<hash>[#page=N]`) and
materialization pointers live only on the manifest's `index_refs`, never in a record payload. Record
ids are derived from `(source_sha, stage)`, never random.

*(Found by running a real PDF end-to-end on 2026-07-30, not by inspection: re-ingesting one document
from a different port wedged the registry. The unit test that used a constant URL passed.)*

**No secrets in a durable receipt.** A download URL is routinely a *credential* — a presigned
S3/GCS signature, an OEM portal `?token=`, `user:pass@` on a mirror — and a manifest outlives the
process that wrote it. Provenance is scheme+host+path; the query string is how the fetch was
*authorized*, not where the document came from, and byte identity is what identifies it anyway. So
every URI reaching a durable field is redacted (`materialized_evidence/redaction.py`) at the producer
boundary, and `validate_manifest` rejects an unredacted network URI on every `register` — the floor
applies to any producer, not just this one. The detector deliberately catches a URI *embedded* in a
composite locator, because that was the real leak shape: `urlsplit` reads
`knowledge_entries:https://host/m.pdf?token=…#records=7` as scheme `knowledge_entries`, so a
whole-value parse reports it clean while a live token sits in the middle. Composite locators are
therefore built from the content hash (`knowledge_entries:sha256:<hash>#records=N`), never a URL.

**Persistence.** `FileRegistry` persists **manifests and status overlays only** — never
`EvidenceRecord` payloads. It is a receipt store, not a second content store. The lane is enabled
per-run by `--evidence-registry` / `MIRA_EVIDENCE_REGISTRY`; unset means unchanged behavior.

**Concurrent writers.** The snapshot is rewritten whole, so every write is a load-modify-replace of
one shared file. Atomic replace prevents a *torn* file and does nothing about a *lost* one: two
ingest processes could each hydrate, each add a manifest, and each write everything back — both
reporting success while the last writer erased the other's receipts. Writes therefore run under an
exclusive `flock` on a sidecar `.lock` **and re-hydrate from disk inside the lock before mutating**.
The reload is the load-bearing half; locking alone still writes back a construction-time view. It
also makes the ADR-A3 immutability check evaluate against what is really on disk. Reads are not
locked (a staleness bound, not a correctness bug — a recall miss recomputes); `refresh()` opts in.
Neon remains the concurrent-safe *shared* backend; this makes the file backend safe for the
concurrent processes that exist today, the KB-growth cron's pipeline subprocesses.

**A receipt gap is recorded, not swallowed.** Receipt writing is fail-open: a failure stays out of
the pipeline's exit code, because a non-zero exit would make the cron re-download and re-extract a
document that ingested perfectly. That left no trace at all — a document with no receipt looked
exactly like one with two. A failure now appends an `evidence_pending` repair item to
`<snapshot>.repair.jsonl` carrying the compiler's inputs verbatim (byte identity, byte count, the
real extraction method and its hashes, the materializations produced), so replay needs neither the
network nor a re-extraction; the cron stamps `evidence_status` on the queue entry as the
operator-facing pointer. The journal is redacted on the same rule as the manifest — it is exactly as
durable, so it must not become a second copy of the leak.

**Caller input is validated at the boundary.** Duplicate or non-positive page numbers collide record
ids (`{sha}:page:{n:05d}`), and a malformed page hash would let a Page Identity dataset assert
provenance it cannot support. Both are rejected as contract violations. A *failed extraction* is not
— that is legitimate evidence, recorded with `stage_status` `failed`/`cancelled`.

**Next consumers, explicitly not included here:** Hub v2 document ingestion, node attachments,
Telegram, PrintSense, any chat answer path, and **verified page-level extraction**.

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

## Bravo VLM/OCR → context → runtime → trace (the visual evidence seam)

Bravo's local vision lane is a *producer*, not a runtime. Its output crosses into the one technician
policy along a single typed seam — the same discipline every other producer follows:

```
VisionWorker (VLM/OCR, ELECTRICAL_PRINT / NAMEPLATE / EQUIPMENT_PHOTO)
   │  persists to the VisualSession ledger (ADR-0027, migration 063:
   │  evidence_item · region_of_interest · observation)
   ▼
evidence_from_visual_session(observations, evidence=…, regions=…)   ← pure adapter, dict-in
   │  materialized_evidence/context_contract.py
   ▼
EvidenceItem(kind=PRINT_OBSERVATION, trust=candidate|verified, producer=extractor,
             evidence_hash=original_hash, page/bbox only when explicit, lineage=None)
   ▼
TechnicianContext.evidence   →   sole technician runtime (mira-pipeline / Supervisor)
   ▼
decision trace (the cited answer records which PRINT_OBSERVATION items it used)
```

Guarantees at the crossing (enforced by `tests/test_visual_session_adapter.py`): trust is
model-`candidate` until a human `review_state` raises it; rejected/superseded observations are
dropped; source hash, extractor, timestamp, page and bbox survive only when explicitly present and are
never invented; and vision prose, OCR text, and schematic inference stay distinguishable by producer.
This adapter is the **only** path from Bravo evidence into context — no second schema, no second
ledger, no Bravo chat personality (NORTH_STAR.md § "Bravo runtime boundary").

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
