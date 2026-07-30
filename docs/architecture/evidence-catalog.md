# Evidence Catalog — the traceable table

**Status:** Living catalog (drift-guarded) · **Date:** 2026-07-30 · **Hub:** [`bravo-evidence-lane.md`](./bravo-evidence-lane.md)

The authoritative, `file:line`-traceable map of the spine. Every `EvidenceKind` and every
`evidence_from_*` adapter in `materialized_evidence/context_contract.py` **must** appear here —
`tests/test_evidence_catalog_sync.py` fails the build otherwise. Line numbers are anchors as of
`main` @ commit `374f70db9`; the drift-guard keys on **names**, not lines, so line drift is a
docs nit, not a build break.

> **Scope note:** rows below reflect `main`. `evidence_from_visual_session` (Bravo VisualSession
> → `PRINT_OBSERVATION`) is **incoming in PR #3016**, footnoted `[†]`, and intentionally *not*
> gated by the drift-guard until it merges.

---

## A · Evidence kinds → producers (Layer 2 → Layer 3 runtime contract)

All adapters live in `materialized_evidence/context_contract.py`. "Trust default" is what the
adapter stamps on `EvidenceItem.trust`; only a **human** signal ever yields `verified`
(ADR-0033; see the hub §3 invariant 2).

| # | `EvidenceKind` | Adapter (`context_contract.py`) | `producer_name` | Upstream source | Cite | Trust default |
|---|---|---|---|---|---|---|
| 1 | `manual_chunk` | `evidence_from_recall_chunks` :317 | `recall_knowledge` | OEM manual corpus (`knowledge_entries`) via `recall_knowledge` / Hub `ManualChunk` | `M{i}` | `verified` iff chunk `verified` else `candidate` |
| 2 | `drive_pack_fact` | `evidence_from_drive_pack_answer` :392 | `drive_pack_ask` | Promoted capability packs (`mira-bots/shared/drive_packs/packs/`) | `D{i}` | `verified` (packs are human-promoted) |
| 3 | `kg_path` | `evidence_from_kg_context` :409 | `kg_traversal` | `kg_entities` / `kg_relationships` traversal | `G{i}` | row `approval_state` or `proposed` |
| 4 | `print_observation` | `evidence_from_printsense_graph` :507 | `printsense` | PrintSense interpreted schematic graph (`printsense/interpret.py`) | `P{i}` | item `trust` or `candidate` |
| 4b | `print_observation` `[†]` | `evidence_from_visual_session` (PR #3016) | `visual_session` | Bravo VisualSession ledger rows (`mira-bots/shared/visual/`, mig 063) | `V{i}` | `candidate` → `verified` only on human `review_state ∈ {confirmed, corrected}` |
| 5 | `ontology_validation` | `evidence_from_ontology_validation` :543 | `ontology_validator` | Ontology conformance check (ADR-0032) | `O{i}` | `verified` iff conforms else `rejected` |
| 6 | `live_tag` | *(no `evidence_from_*` adapter — see §B)* | — | Live tag snapshot → `LiveStateOverlay`, not an `EvidenceItem` | — | n/a (overlay) |
| 7 | `historian_window` | `evidence_from_historian_window` :578 | `historian_window` | `tag_events` run-diff windows (`mira-relay` historizer) | `H{n}` | window `trust` or `candidate` |
| 8 | `work_order` | `evidence_from_work_orders` :623 | `cmms_work_orders` | Atlas/CMMS work-order history | `W{n}` | order `trust` or `verified` |
| 9 | `prior_decision` | `evidence_from_prior_decisions` :658 | `decision_traces` | Prior `decision_traces` rows | `R{n}` | `candidate` |
| 10 | `technician_correction` | `evidence_from_technician_corrections` :694 | `technician_corrections` | Human correction events | `T{n}` | `candidate` |

**Citation prefixes in use:** `M D G P O H W R T` + `V` (incoming, #3016). Pick a **free** letter
for any new kind (do not reuse). See the [add-a-producer runbook](../runbooks/evidence-add-a-producer.md).

---

## B · Structural adapters (not `EvidenceItem`s — they shape identity/overlay)

These adapt IN but produce non-evidence structures, so they are **not** drift-gated as evidence
kinds. They are part of the contract surface and belong in any trace.

| Adapter (`context_contract.py`) | Produces | Role |
|---|---|---|
| `live_overlay_from_machine_packet` :452 | `LiveStateOverlay` | The live-state overlay (freshness-tagged); the runtime home of `live_tag` (kind #6) |
| `asset_from_uns_context` :495 | `AssetIdentity` | Resolves `state["uns_context"]` → the turn's asset identity |

---

## C · The spine package (Layer 3 modules)

`materialized_evidence/` — two sub-layers in one package (hub §2).

| Module | Public surface (`__init__` exports) | Role | Decision |
|---|---|---|---|
| `schema.py` | `EvidenceManifest`, `EvidenceRecord`, `RecallQuery`, `RecallResult`, `validate_manifest`, `SCHEMA_CONTRACT_VERSION` + vocab enums | The vendor-neutral typed contract | ADR-0029 (PR C) |
| `hashing.py` | `content_hash`, `manifest_hash`, `record_hash`, `canonical_json`, `with_hashes` | Content-addressed hashing (the "hash-law") | ADR-0029 |
| `registry.py` | `MaterializationRegistry`, `InMemoryRegistry`, `StatusOverlay`, `RegistryError` | Materialization registry (references, never copies) | ADR-0029 (PR D) |
| `resolver.py` | `resolve_recall` | Recall-first resolver (reuse expensive stages) | ADR-0029 (PR E) |
| `invalidation.py` | `invalidate`, `InvalidationResult` | Lineage / descendant invalidation | ADR-0029 (PR F) |
| `context_contract.py` | `TechnicianContext`, `EvidenceItem`, `to_prompt_block`, `validate_context`, `TaskMode`, `EvidenceKind`, the adapters | Runtime prompt-assembly contract + read-only gate | ADR-0033 |

---

## D · Task modes (one policy, six modes)

`TaskMode` (`context_contract.py:40`) — modes of the one brain, **not** personas (ADR-0033 Rule 2).

`general_troubleshooting` · `drive_commander` · `printsense` · `graph_reasoning` ·
`live_state_diagnosis` · `work_order_assist`

---

## E · Read-only vocabulary (the gate)

`context_contract.py`: `ALLOWED_ACTION_VOCAB` (read/cite/suggest/explain/request_*) vs
`FORBIDDEN_ACTION_SUBSTRINGS` (write/set_/reset/force/start/stop/energize/…). Kept in lockstep
with `agent_registry._WRITE_VERBS` by `tests/test_context_contract.py`. Hub §3 invariant 1.

---

`[†]` Incoming in **PR #3016** — Bravo VisualSession → TechnicianContext evidence adapter.
Not on `main`; the drift-guard does not require it until merged.
