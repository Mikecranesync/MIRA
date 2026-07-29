# Unified Technician Brain — Phase-1 Inventory (2026-07-29)

Reconciled from 7 parallel read-only discovery passes (repo families + Google Drive) at
worktree `feat/technician-unified-brain` @ `55e4803c6`. Machine-readable twin:
`inventory.json`. Verbatim agent transcripts live in the session record; every row below
was verified against the repo this night.

## Source-family inventory

| source family | canonical location | runtime role | data shape | rights/privacy | approval state | lineage key | volume | gaps | adapter needed | action |
|---|---|---|---|---|---|---|---|---|---|---|
| Technician dataset machinery | `factorylm_ai/{governance,adapters,dataset}/` | training-candidate factory + gates | `SourceCandidate` → `DatasetRecord` → manifest | corpus-source.v1, fail-closed | frozen (v0/v1) / built-unreviewed (v1.1, v2) | `<mfr>:<doc>` or `tenant:<id>:document:<uuid>` | v0 219/119 reviewed·trained; v1 211/105 reviewed·trained; v1.1 211/0 (dead); v2 2,148/0 | v1.1 orphaned; console defaults stale; two ledger filenames | none | v2 = forward path; archive v1.1; repoint console |
| General technician behavior | — (does not exist) | training source | — | — | — | — | **0 records** | THE missing family (mission thesis confirmed) | new candidate builder through existing pipeline | build (Phase 4) |
| Drive Commander | `mira-bots/shared/drive_packs/` (+`tools/drive-pack-extract/`) | deterministic evidence producer + training source | pack.json schema v2 (v3 declared, unused) | gs10+pf525 train-granted; **pf40 held-out invariant** | registry vs scorecard trust ladders disagree | `<mfr>:<manual-doc-number>` (never drive_model) | 3 live packs (45 train records used); Magnetek candidate (77 faults/468 params) unwired; g120 sold-but-orphaned | 4 pack copies, 1 drift guard; no observability | existing (`adapters/drive_commander.py`) | reuse; register g120; wire Magnetek later |
| PrintSense | `printsense/` (39 modules) + `mira-bots/shared/visual/` | evidence producer (prod paid vision) + training source | `PrintSynthGraph` graph.json (UNVERSIONED — top gap) | SCU2 + real-photo corpus = customer-private LOCAL-ONLY, **no rights registry row**; synthetic corpora = safest trainable | prod-activated v3.212.0 | content-hash (evidence) vs document_lineage_key (corpus) — unbridged | 26 registry rows; 165 v2 candidates; 8 internet-print cases | corrections written as mutable dicts, not correction-event.v1; graph.json needs `$id` | extend (`adapters/printsense.py` exists) | register SCU2 fail-closed; version graph.json |
| KG / ontology | `mira-hub/db/migrations/001,018,027,029` + `ontology/` | evidence producer (traversal/context-builder) + approval workflow | kg_entities/relationships + proposals + ai_suggestions | tenant RLS (Hub family) | proposed/verified enforced; ontology approval model RICHER than DB CHECK | kg_entities.id; 3 provenance schemes side-by-side | 42 SHACL shapes (31 without fixtures); ontology runtime-inert | **two live kg schema families** (Hub UUID+RLS vs engine TEXT); 3 stale canonical docs | extend (evidence adapter into contract) | bridge schemas (flagged, not fixed here); adapter |
| Retrieval | `mira-bots/shared/neon_recall.py` + `mira-hub/src/lib/manual-rag.ts` | evidence producer | raw chunk dicts / `ManualChunk` | hybrid law `(is_private=false OR tenant_id=$1)` in 3 hand-copied dialects | `verified` gate flag exists, column unbackfilled | knowledge_entries id + (tenant, source_url, chunk_index) | 2 engines + ≥8 bespoke readers of the same table | no typed evidence out; fault_codes stream ungated | extend | adapter → contract; note gate-flag hazard |
| Live state / machine memory | `mira-relay/` + `mira-hub` migrations 020/033/035/038/040 + `machine-context-packet.ts` | evidence producer | `MachineContextPacket` (typed, unversioned) / `live_snapshot.py` (renders to prose) / `historian.EvidenceWindow` | tenant + approved_tags allowlist | approved_tags = human gate | (tenant, source_system, source_tag_path); uns_path | modelled 3×, typed 1× | `simulated` defaults disagree (tag_events vs cache); normalize_tag_path ×3 | fold packet into contract | adapter (overlay) |
| Approved conversations / corrections | `mira-bots/shared/conversation_logger.py` → `conversation_eval` + score/distill tools | future training source (real technician data) | DB rows, PII-sanitized | **rights UNRESOLVED — no corpus-source.v1 envelope, no lineage scheme** | NOT approved for training | none minted | unbounded, uncounted | the single biggest ungoverned real source | **corpus-source.v1 adapter (the missing piece)** | build adapter spec (Phase 4, eval-only until rights) |
| Context-contract candidates | `materialized_evidence/schema.py` (winner) + `machine-context-packet.ts` + `observe/agent_registry.py` | runtime context spine | `EvidenceManifest` (versioned+validated, 6/8 target dims) | tenant+environment scoped | ADR-0029 merged | content/manifest hash | thin runtime adoption (printsense recall only) | missing `task_mode`, `allowed_actions`, unknowns-promotion | extend IT — do not fork | Phase 3 |
| decision_traces | migrations 032/055 + `shared/decision_trace.py` | post-hoc audit — de-facto contract, write-only | tag/manual/kg evidence JSONB in ONE row | RLS, append-only | technician_confirmed = human loop | trace_id; (tenant, ts) | 2 divergent writers, 0 readers | evidence not FK-resolved | reader/resolver | wire as consumer of contract |
| Eval assets (frozen) | `holdout_eval.py` (25+108) + SimLab + printsense benchmarks + internet-print corpus + DC gold/graders | EVALUATION-ONLY | prompt sets, gold, graders, rubrics | PF40 held-out invariant; SimLab double-locked; SCU2-derived = customer-private | frozen / CI-gated | lineage / sha256 freeze files | 25 frozen + 108 expanded + 2-case grader gate + 6 sha256 corpora + 8 internet cases | judge rubric uncalibrated (internet-print); 31 SHACL shapes fixture-less | none | keep out of training (enforced) |
| Synth substrate | `factorylm_ai/synth/` | generation governance (idle) | JobRecord + 16-state FSM + SQLite queue | §15 answer-key independence | shipped PR-A, 0 records produced | case_key/execution_key | 0 | producer stages B–E never built | none | use contracts for Phase-4 generation provenance |
| Legacy flywheel | `factorylm_ai/flywheel/` | competing export path | records/redact/splits/export | drops sensitive | shipped, unused by program | record-id hash (NOT lineage) | — | 70/10/10/10 splits + export bypasses paid_gate | none | reconcile: gate or retire export |

## Cross-cutting conflicts (ranked)

1. **Two live `kg_entities`/`kg_relationships` schema families** (Hub `001` UUID+RLS vs engine `docs/migrations/004-008` TEXT, no RLS, different natural keys; competing approval-state bolt-ons `008` vs `029`). Highest-value unification target; out of this PR's surgical scope — flagged with a bridge recommendation.
2. **Evidence identity vs corpus lineage never bridge**: materialized_evidence/CAS key on content hash; CLF/adapters key on document_lineage_key. Leakage partitioning cannot cover recalled evidence until a join exists. Contract extension adds the optional `document_lineage_key` back-reference.
3. **Retrieval law hand-copied in 3 dialects** (+ ≥8 bespoke `knowledge_entries` readers); approval gate = two separately-read env flags over an unbackfilled `verified` column (flipping it on would zero retrieval).
4. **decision_traces already carries tag+manual+kg evidence in one row** — two divergent writers, zero readers. The unified contract should feed it, not replace it.
5. **Corrections exist twice** (mutable review_queue dicts vs immutable spec-only correction-event.v1); the shipped path writes the unversioned one.
6. **Trust ladders disagree** (DC registry vs scorecard; ontology TrustState richer than DB approval_state; deterministic self-check can masquerade as human approval in Postgres but not in SHACL).
7. **Console/tooling drift**: review_console_v2 defaults to a stale worktree path; review_console v1 (data-destroying export bug) still committed; two ledger filenames; judge protocol v1 vs v3.
8. **Pack copies ×4** with one drift guard; `siemens_g120` sold via Stripe but invisible to resolver/registry/rights.

## Documented mixture choice: the FactoryLM house-content exemption

The mission's default is "any one manufacturer ≤10% unless the inventory proves a better
documented choice." This inventory documents that choice: `FactoryLM` is not an OEM — it
is the house author of the synthetic general-behavior family, the CV-101 training print,
and the style guide. Applying the OEM manufacturer cap to house content would cap the
*general majority class itself* (the ≥50% rule and the 10% rule would be mutually
unsatisfiable). Therefore the manufacturer cap applies to real OEMs only
(rockwell/automationdirect/etc.), FactoryLM's share is reported transparently in
`mixture_report.json` (`by_manufacturer`), and house content remains bounded by the
product-family (≤25%) and template-family (≤20%) caps.

## Google Drive reconciliation (discovery inputs only)

Superseded: MIRA-Projects-PRD-v1, MIRA_LlamaIndex_RAG_PRD. Reconcile-worthy: Cognite-style
entity-matching build spec (unshipped matching engine), 2026-07-04 cohesion audit (3 login
systems, 3 diagnostic engines, orphan modules — orthogonal, still open), Teleop meta-plan
(thesis "technician demonstrations + machine state are the unique corpus" → foreshadows
the conversation-capture adapter).

## Phase-0 record

Issue #2945 (staging migration drift): CLOSED with proof — apply run 30366072307
(`063_reconcile_staging_schema_drift.sql`, ledger row recorded), re-verify run 30366176272
(staging + prod drift checks green). Prod clean throughout. Not repeated.
