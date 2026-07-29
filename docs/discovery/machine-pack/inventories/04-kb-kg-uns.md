# Manuals+KB / Knowledge Graph / UNS — Discovery Inventory

Sibling `mira-uns` = stale partial snapshot from 2026-06-16 — ignore.

## 1. Manual ingestion + cited extraction
- `mira-crawler/tasks/full_ingest_pipeline.py` — CLI orchestrator download→extract→chunk/embed→KG entities→quality gate. **BROKEN in prod: DOCLING_URL default :5001 but docling removed 2026-06-06** (replaced by mira-tika-saas). Fix: repoint at Tika or default pdfplumber-only.
- `mira-crawler/ingest/converter.py` (pdfplumber default / docling opt-in legacy), `chunker.py` (section-aware, token-capped), `embedder.py` (Ollama nomic-embed-text:v1.5, retry, returns None on failure), `quality.py` (3-stage gate: content→relevance→semantic dedup, fails open), `dedup.py` (MD5 SQLite), `store.py` (NeonDB knowledge_entries), `manufacturer_normalize.py` (must stay in sync with uns_resolver VENDOR_ALIASES).
- **DUPLICATE ingest path:** `mira-core/mira-ingest/` + mira-core scripts (older, Open WebUI-facing, also docling-referencing) vs mira-crawler/ingest — consolidation review needed. Other docling touchpoints: mira-pipeline/main.py, bravo/evaluate_pipelines.py, scripts/ab_manual_hunter, scripts/ingest_guardrails.py, tools/proveit/manual_chunks.py, tools/seeds/oem-manuals — grep-and-fix sweep.
- Tests present: test_kb_growth_cron, test_chunker, test_dedup, test_quality, test_manufacturer_normalize, test_converter_tables, test_ingest.

## 2. recall_knowledge production retrieval — REUSE AS-IS
- `mira-bots/shared/neon_recall.py` — THE retrieval layer: (1) dense pgvector cosine, (2) fault-code table + ILIKE, (3) product-name vector-rerank, (4) BM25 tsvector; RRF fusion k=60, fault hits bypass RRF. kb_has_coverage/kb_has_pair_coverage. GS11 regression fixed (BM25 runs without embedding).
- `rag_worker.py` — citation tagging, evidence-relevance gate (#2384: only cosine-floor vector chunks or fault-code hits count as coverage). source_page ≈ chunk_index (deliberately not "p. N").
- Tests: test_neon_recall_pair_coverage, test_recall_no_embedding_fallthrough + golden CSVs + deepeval_suite.

## 3. Knowledge graph
- Migs: 001 (kg_entities/kg_relationships/kg_triples_log + RLS), 010 (uns_path ltree + GIST), 018 (**relationship_proposals**: type CHECK incl. HAS_FAILURE_MODE, confidence, status proposed/reviewed/verified/rejected/deprecated/contradicted, created_by llm/human/import/rule, risk_level, requires_human_review, reasoning; + **relationship_evidence**: 9-type enum document_page/plc_rung/tag_list/work_order/technician_note/live_data/manifest/oem_kb/human_observation, excerpt, confidence_contribution [-1,1]), 029 (approval_state ADR-0017), 050 (kg_relationships.relationship_proposal_id FK back-link), 024/025/026/039 (dedup/natural-key/source-object).
- `mira-crawler/ingest/kg_writer.py` — single choke point for ALL KG writes; non-NULL uns_path enforced; MIRA_KG_INGEST_AUTOVERIFY default off → proposals-only.
- `mira-crawler/ingest/proposal_writer.py` — propose_relationship(_cursor): proposals + evidence + bridging ai_suggestions(kg_edge). canonical_relation_type maps has_fault → HAS_FAILURE_MODE.
- `tools/relational_distill.py` (#2596, MERGED main 2026-07-09) — grounded HAS_FAILURE_MODE edges from real Q&A. Model new grounded-edge mining on this.
- `mira-hub/scripts/kg-infer-proposals.ts` — THE inference worker: inferSameModelPairs→SAME_MODEL_AS, inferCoFailedPairs (WO co-occurrence 1h)→CO_FAILED_WITH, inferComponentManualPairs→HAS_DOCUMENT. All created_by='rule' proposals. (withKgContext duplicated from cmms-sync.ts — noted in-file.)
- TS proposals-writer.ts + Python proposal_writer.py — two writers BY DESIGN (Hub-side vs ingest-side), same tables per ADR-0017.
- Hub: /api/proposals + [id]/decide (ONLY promote path), /graph + /proposals UI.
- ADR-0017 = canonical doctrine (3 status vocabularies, one state machine, centralized writers). Read before touching KG writes.
- `mira-connectors/` canonical.py/confirmation_gate.py/store.py — connector-side same doctrine, no new tables. PostgresProposalStore schema-verified but never run vs real DB.
- `mira-contextualizer/bundle.py` — offline bundle@1 zip (kg_entities/relationships proposed, incl. HAS_FAILURE_MODE ISO-14224, uns.json, i3x.json, evidence.json).

## 4. UNS
- `mira-crawler/ingest/uns.py` — CANONICAL path grammar (^[a-z0-9_]+(\.[a-z0-9_]+)*$), two branches: enterprise.knowledge_base.{mfr}.{model} (permanent, INSTANCE_OF links) + ISA-95 site hierarchy enterprise.{co}.site.{s}.area.{a}.line.{l}.work_cell.{c}.equipment.{id} w/ .component/.datapoint/.maintenance/.documentation. Spec: docs/specs/uns-kg-unification-spec.md.
- `uns_topic_map.py` — flat MQTT/Ignition topics → full UNS paths via TopicRule; every segment from uns.py builders (invariant).
- `mira-bots/shared/uns_paths.py` — VERBATIM dep-free copy (CI-enforced import boundary, intentional — don't "fix").
- `mira-bots/shared/uns_resolver.py` — production message resolver → UNSContext at state.context.uns_context (placement load-bearing); VENDOR_ALIASES sync w/ manufacturer_normalize.
- `engine.py` gate — _UNS_GATE_ENABLED default ON, _GATED_INTENTS {diagnose_equipment, schedule_maintenance}; non-negotiable.
- `mira-plc-parser` i3x.py + own uns.py copy (third copy — tool-local).
- `tag_classifier.py` — Ignition/connector tags → 10 UNS categories → ai_suggestions(tag_mapping).
- simlab/uns.py, tools/uns_backfill.py present.
- **Flag: 3 copies of uns.py grammar — any grammar change must touch all three.**

## 5. Component identity / nameplate
- `nameplate_worker.py` — vision nameplate extraction {manufacturer, model, serial, voltage, fla, hp, frequency, rpm}; photo_ingest_worker/batch_queue/handler pipeline.
- `mira-connectors/canonical.py` — CanonicalAsset/Location/Tag/WorkOrder/PMTask/FailureCode/Meter/Part/Document/Relationship — identity+hierarchy normalization contract.
- All converge on kg_entities + relationship_proposals. No competing identity model — coherently centralized.

## 6. Citation/provenance/confidence — cross-cutting schema
- knowledge_entries: content, manufacturer, model_number, equipment_type, source_type, source_url, source_page(≈chunk_index), metadata, verified, embedding.
- relationship_proposals: confidence [0,1], status, created_by, risk_level, requires_human_review, reasoning.
- relationship_evidence: evidence_type (9-enum), source_id, page_or_location, excerpt, confidence_contribution [-1,1] (negative=contradicts).
- kg_relationships: confidence, approval_state, proposed_by, evidence_summary, relationship_proposal_id.
- ai_suggestions: bridging queue.
All funnels through ADR-0017. **Don't invent a parallel confidence field.**

## Verdicts
- Reuse as-is: neon_recall/rag_worker, uns.py/topic_map/resolver/gate, kg_writer/proposal_writer/relational_distill/kg-infer-proposals.
- Fix before reuse: full_ingest_pipeline + siblings (docling :5001 → Tika/pdfplumber).
- Consolidate: mira-crawler/ingest vs mira-core/mira-ingest (two ingest trees).
- Intentional duplication (leave): 3× uns.py copies, 2× proposal writers.
