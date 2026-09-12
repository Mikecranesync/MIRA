# Corpus-Spine PRD — Implementation Ledger (reconciled 2026-07-29)

**PRD:** MIRA General Maintenance Intelligence Corpus Spine (2026-07-29, uploaded).
**Reconciliation:** the PRD's grounding baseline `d54d67abe` **is current `main` HEAD** —
no drift. Two same-day merges sit directly beneath it and matter: #2999/#2982 (SP1 OEM
crawler trusted-content path + `.claude/rules/oem-crawler-trusted.md`, the §8.1 doctrine)
and #2993 (kb_has_pair_coverage embedding filter fix). Machine-readable twin:
`implementation-ledger.json`. No merges, no paid calls, no prod writes under this ledger.

## Requirement → status map

| PRD req | Status | Existing assets | New work | Slice |
|---|---|---|---|---|
| G1 governed resource registry | PARTIAL | `corpus-source.v1` schema + `adapters/source_candidate.py` (fail-closed) + ZTA source registries (34 rows) | curated registry mechanism for gov/OER/textbook + `source_type=package` convention + quarantine workflow | D |
| G2 rights-aware source classes | PARTIAL | `governance/rights.py` 5 license classes, fail-closed; per-source decisions (DC grant, PF40 block, SCU2 **unregistered — gap**) | class table encoded as fixtures/tests; SCU2 + real-photo corpus registered fail-closed customer-private; conversation/correction class added (denied-until) | D |
| G3 format law (JSON/JSONL/Parquet) | PARTIAL | de-facto compliant everywhere; Parquet design doc (#3001) | write the law doc + a lint/test that flags Parquet-as-source-of-truth violations | H |
| G4 one evidence contract | LARGELY DONE | `context_contract.py`: 10 kinds, validation, citation ids, lineage backref; adapters: manual/drive-pack/KG/print/ontology/live/uns | adapters missing: `HISTORIAN_WINDOW`, `WORK_ORDER`, `PRIOR_DECISION`, `TECHNICIAN_CORRECTION`; page/section/bbox coordinate fields on document-backed items | B |
| G5 KB/KG stays the engine | DONE (doctrine) | ADR-0033; inventory conflict list; no second stack built | metadata-consistency improvements only as touched | — |
| G6 general behavior corpus | PARTIAL | `unified_compile.py`: 9 general families ×12 archetypes, bridge, mixture caps enforced; 180-record compile | domain axis (12 PRD domains vs current ~6 implicit), task-type axis expansion, more representations, volume 2–4k via governed generation | E |
| G7 serious evaluation | PARTIAL | 108-rec PF40 3-track + 36 reserved-family prompts + judge protocol v3 + deterministic-first | sealed families for: unreadable-image, wrong-identity, cross-sheet tracing, unseen-OEM, multi-turn corrections, cross-domain; lineage freeze files; per-domain scorecards | F |
| G8 continuous learning w/o auto-promotion | SPEC ONLY | capture exists (`conversation_eval`, PII-sanitized) but **no corpus-source envelope, no lineage** (inventory finding); correction-event.v1 spec unimplemented | corrections adapter (immutable events), sanitized-candidate path, fail-closed rights class | B (adapter) + E (candidates) |
| §8.1 OEM manuals | LARGELY DONE | SP1 trusted path + rule doc; store.py sets verified per doctrine; lineage keys in ZTA registry | `MANUAL_CHUNK` items to carry lineage key from chunk metadata (adapter-side join); **no origin backfill** — audit-report-only for historic rows | A (audit) + B |
| §8.2 gov/public/OER | NEW | — (curriculum crawler must be inspected before reuse — trust-inheritance check) | curated registry path + adapter + fixtures, no network in tests | D |
| §8.3 textbooks | NEW | — | classification rules + retrieval-first defaults + quarantine | D |
| §8.4 PDFs | PARTIAL | crawler ingest preserves page/chunk; hierarchy/figure/table anchors inconsistent | document-family lineage rule (family carries lineage; pages carry evidence hashes) encoded in adapter + tests | C/D |
| §8.5 PrintSense graph versioning | NEW (designed) | inventory flagged graph.json unversioned; `factorylm.visual-region.v1` precedent | `$id`/version on graph JSON + compat loader + provenance fields + deterministic serialization + `PRINT_OBSERVATION` regression tests | C |
| §8.6 KG read-only adapter | PARTIAL | `evidence_from_kg_context` exists (dict-shaped) | wire to real traversal row shape incl. entity/relationship ids, approval filtering contract, contradiction pass-through; **no schema-family changes** (PRD §6) | B |
| §8.7 live state | LARGELY DONE | `LiveStateOverlay` + packet adapter (TS-shape verified, dropped-count explicit) | historian window refs as first-class evidence items | B |
| §8.8 WO/corrections | NEW | decision_traces (write-only), review_queue (mutable — flagged) | three adapters + immutable correction events + sanitization tests | B |
| §9 training reqs | PARTIAL | caps enforced + reported; candidate envelope has most fields | add task_mode/domain/evidence-kind/representation reporting axes; hard negatives exist (distractor/wrong-evidence); multi-turn exists (pushback, S6) | E |
| §10 Parquet | DESIGNED | design + pinned contract (#3001); proof-suite spec'd | `parquet_export.py` + proof suite + analytical exporters + launch-driver wiring behind stop-gates; $0 probes stay at ceremony boundary | G |
| §11 trust reqs | LARGELY DONE | tenant/hybrid law, approval flag fail-closed, SP1 doctrine | no-global-flag-flip guard test; backfill-forbidden documented in audit | A |
| §12 PR plan A–H | THIS LEDGER | — | see slice map below | — |

## PR-slice map (small, independently testable, no unreviewed migrations)

- **PR A (this slice, read-only):** this ledger + `knowledge_entries_touchpoints.jsonl`
  (83-file reader/writer classification w/ trust behavior) + rights/tenant gap report +
  duplicate/legacy path report (extends `technician-unified/inventory.md`) + unprovable-
  origin groups marked. **No DB writes, no prod calls.**
- **PR B:** four missing evidence adapters + coordinate fields + corrections-as-immutable-
  events adapter (rights-permitting, fail-closed) + determinism/citation/lineage tests.
- **PR C:** PrintSense graph schema version + compat loader + provenance + regression.
- **PR D:** curated public-resource registry + textbook classes + quarantine + fixtures.
- **PR E:** candidate expansion (domains/tasks/representations/multi-turn/hard negatives)
  through the existing compiler; coverage + rejection reports; review package. No sitting
  bypass.
- **PR F:** sealed eval family expansion + freeze files + per-domain scorecards + leakage
  tests.
- **PR G:** Parquet exporters + proof suite + stop-gate wiring (no signing consumption).
- **PR H:** docs: architecture, runbooks, format law, onboarding, rights guide,
  retirement plan for duplicate paths (console v1, flywheel export bypass, v1.1 builder).

## Standing constraints carried from the PRD

No merges without Mike; no paid events; no prod mutations; no KG schema-family changes;
no `oem_trusted` broadening; no origin backfill from row shape; frozen eval families
never train; customer-private stays tenant-isolated; unknown rights = quarantine.
