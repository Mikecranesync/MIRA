# Materialized Evidence & Recall-First Architecture

The permanent rule for expensive industrial data work:

> **Infer once. Materialize every expensive discovery. Validate and approve stable truth. Compile it
> into Capability Packs. Recall it unless the evidence changed.** — do not make the machine pay twice
> for the same understanding.

Doctrine: `NORTH_STAR.md` § "Materialized Evidence and Recall-First Architecture". Architecture:
`docs/architecture/materialized-evidence.md`. Decisions: `docs/adr/0029-materialized-evidence.md`.
Inventory of what already exists (reuse it): `docs/architecture/materialized-evidence-inventory.md`.

## The 15 engineering rules (every Claude/Codex session honors these)

1. **Recall before recompute.** Before running an expensive stage (OCR, vision, transcription, video
   detection, embedding, large-doc parse, PLC analysis, graph extraction, telemetry features, model
   classification, large search, human-reviewed interpretation), search for a compatible existing
   result first.
2. **State why, when you recompute.** If compatible evidence appears to exist and you recompute
   anyway, record a reason code (`recomputed_source_changed`, `recomputed_algorithm_changed`,
   `recomputed_schema_changed`, `recomputed_prompt_changed`, `recomputed_missing_output`,
   `recomputed_corrupt`, `recomputed_human_requested`) — recomputation must be observable.
3. **Chat is never the only store for an expensive discovery.** A result that lives only in the chat
   transcript, a log line, or a temp file is not materialized. Write it to the evidence layer.
4. **Preserve intermediate stage outputs.** Each expensive stage creates a reusable checkpoint; a
   failed downstream stage must not discard valid upstream evidence.
5. **Include source + dependency hashes.** Every materialized result carries its source hashes and its
   `parent_dataset_versions` — content-addressed identity, not filename/timestamp identity.
6. **Keep inference versions in lineage.** When a stage used a model, record `model_provider`,
   `model_id`, and `prompt_contract_version`. A prompt change may invalidate an explanation without
   invalidating the OCR beneath it.
7. **Deterministic keys, idempotent writes.** Key derived artifacts on `(source_sha, stage,
   producer/prompt version)` (the `printsense/cas.py` pattern). Re-running a stage on unchanged inputs
   must be a no-op that returns the same version, not a duplicate.
8. **Invalidate only downstream dependents.** Follow lineage edges (Appendix F matrix), not broad
   cache clearing. A changed page invalidates that page's OCR + descendants, never the other pages.
9. **Never self-promote model output to trusted truth.** Evidence may be `candidate` before it is
   trusted; promotion to `approved` goes through the existing FactoryLM approval systems
   (`ai_suggestions` / `relationship_proposals` / KG approval state — ADR-0017), never automatically.
10. **Keep large data out of Temporal workflow history.** Temporal passes tenant/source ids + hashes +
    dataset ids; PDFs, images, video, full OCR corpora, PLC projects, raw historian streams, and large
    model request/response bodies stay in FactoryLM storage.
11. **Ship a Developer Repair Package with any materialization system** (Appendix / §20): where the
    registry is, how a recall key is computed, why a stage was reused/recomputed, how to inspect
    lineage, mark stale, rebuild one item, find downstream packs, recover/replay a Temporal workflow,
    reproduce a model-assisted stage, run model-off, and roll back.
12. **Add model-off recall tests.** After materialization, the supported query must work with
    inference disabled; and unchanged follow-ups must perform **no** expensive perception call.
13. **Record cost + runtime for expensive stages** (provider, model, input/output units, wall/queue/
    compute time, $ where known, recall-hit, records produced, retries) so recall savings are
    measurable.
14. **Prefer query + recall over raw-source reinspection.** A follow-up question begins from
    previously materialized evidence; a chat follow-up must not automatically reprocess raw source. A
    model may *explain* a recalled evidence chain (regenerating wording) without rerunning the
    perception layer.
15. **Do not build a second registry.** No parallel evidence registry, pack registry, approval queue,
    or workflow ledger. Reference the canonical systems (FactoryLM asset identity, document storage,
    KG approval, Capability Pack registry, Temporal history, `WorkflowRun`); use ONE shared evidence
    contract with typed payload schemas, not one registry per dataset type.

## The distinction that must never blur

- **Materialized Evidence** — what MIRA *discovered* (durable, typed, versioned; may be candidate,
  uncertain, or conflicting). Not automatically trusted.
- **Approved Context** — what a human *validated* (KG entities/relationships, tag mappings, component
  profiles), via the canonical approval systems.
- **Capability Pack** — what FactoryLM *promoted* into reliable, immutable, versioned runtime skill
  (e.g. a drive pack). References exact evidence dataset versions.
- **Temporal** — the *orchestrator* of the long-running movement between these. Not a data store.
- **MIRA runtime** — resolves packs, queries evidence, does deterministic work first, calls inference
  only through declared boundaries, explains in technician language.

## The runtime context contract (ADR-0033 — proposed, wired default-off)

`materialized_evidence/context_contract.py` is the **single per-answer runtime object**
every producer feeds; assembly + the flag live in `mira-bots/shared/technician_context.py`
(flag `MIRA_CONTEXT_CONTRACT`, default off). Plain-language explainer:
`materialized_evidence/README.md`.

- **`TechnicianContext`** is the one "case file" the policy answers from; products are a
  `task_mode` tag on it, **never** a separate model/persona (ADR-0033 rule 1).
- **One flag, one context, one manifest.** A new evidence family adds a pure
  `evidence_from_<source>(dict) -> list[EvidenceItem]` adapter, then is folded into the SAME
  per-turn context in `technician_context.py` — `build_turn_context` (prior-decision family,
  engine seam, pre-RAG) or `augment_with_retrieval` (manual-chunk family, merged post-RAG when
  the chunks exist). The combined context is re-manifested once and rides
  `parsed["_context_manifest"]` to the trace. Never a second flag, assembly site, prompt
  format, or registry (rule 15 above).
- **Candidate, not verified.** Model output is `trust="candidate"`; promotion to `verified`
  goes through the canonical approval systems (rule 9), never automatically.
- **Read-only, fail-closed.** `validate_context()` rejects any write-shaped `allowed_action`
  or non-`read_only` `authorization_state`. Actions live outside this contract.
- **Byte-stable render + audited.** `to_prompt_block()` / `manifest_of()` are deterministic;
  the manifest rides to `decision_traces.context_manifest` (migration 071). **Never add fields
  to `EvidenceManifest`** (its hash is a recall key — rules 5–7).
- **Don't double-render.** Chunks reach the prompt via the worker's `[Source: label]` block;
  `prompt_block` renders only the prior-decision projection and the manual-chunk family is
  merged in **for the audit manifest only** (post-RAG), so one fact never appears under two
  trust labels and prompt bytes are unchanged. A citation-preserving retrieval *render* is the
  next slice — see `docs/plans/2026-08-01-technician-context-runtime-adoption.md`.

## When this applies
- Any new or changed expensive-compute path (PrintSense, Drive Pack extraction, OCR, vision, photo
  interpretation, ingestion, embeddings, PLC parsing/analysis, wiring extraction, machine memory,
  video, historian analysis, provider calls) under any module.
- Any code that stores the output of an expensive stage.

## When this does NOT apply
- Cheap deterministic work with no expensive perception/inference (a pack lookup, a regex, a table
  read) — those are already recall-by-construction.
- Pure documentation / config edits.

## Cross-references
- `NORTH_STAR.md` § "Materialized Evidence and Recall-First Architecture" (doctrine)
- `docs/architecture/materialized-evidence.md` (5-layer architecture + data contracts)
- `docs/architecture/materialized-evidence-inventory.md` (existing systems to reuse — the seed is `printsense/cas.py`)
- `docs/adr/0029-materialized-evidence.md` (platform decisions A1–A6)
- `docs/adr/0033-one-technician-brain.md` + `materialized_evidence/README.md` + `mira-bots/shared/technician_context.py` (the TechnicianContext runtime contract)
- `.claude/rules/one-pipeline-ingest.md` (the analogous "one canonical path" law for ingest)
- `.claude/rules/train-before-deploy.md` (the approve-before-trust discipline evidence promotion mirrors)
