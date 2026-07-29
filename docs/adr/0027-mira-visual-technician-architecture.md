# ADR-0027: MIRA Visual Technician — architecture, canonical contracts, and reuse map

## Status
Draft — 2026-07-11 (implementation-ready; encodes the PRD `MIRA Visual Technician` + a six-scout repository inventory. Phase 0 deliverable #1.)

**Related:** ADR-0017 (proposal state-machine mapping), ADR-0025 (drive intelligence packs + Drive Commander), ADR-0026 (Machine Pack evidence classes + provenance/trust unification), ADR-0023 (Hub as system of record), `.claude/rules/train-before-deploy.md`, `.claude/rules/direct-connection-uns-certified.md`, `.claude/rules/knowledge-entries-tenant-scoping.md`, `machine-print-pack/SPEC.md` (PR #2642), `docs/prd/mira-visual-technician.md`.
**Implements:** the Phase-0 contract-alignment mandate of the PRD ("choose one canonical representation … extending existing contracts where practical … do not restart completed work").

---

## Context

The PRD defines **MIRA Visual Technician**: a multimodal maintenance product that (1) interprets wiring-print snippets, (2) understands real-equipment photographs, and (3) reconstructs verified print packs from accumulated field evidence — through **persistent, evidence-graded visual sessions** with grounded Q&A. Its non-negotiables: *preserve evidence, expose uncertainty, never invent field facts, keep the exported artifact useful without an LLM.*

The PRD's own execution directive is **"do not restart completed work."** A six-agent repository inventory (`scratchpad/vt_inv_1..6`, summarized below) found that **~75% of the required building blocks already exist and are production-tested.** This ADR's job is therefore *not* to design a new system — it is to **name the canonical contracts, map every PRD capability onto an existing asset or a genuine gap, and sequence the build so no existing seam is rebuilt.**

### The reuse map (what already exists)

| PRD capability | Existing asset | Verdict |
|---|---|---|
| Input classification + routing | `VisionWorker` (`mira-bots/shared/workers/vision_worker.py`) — 3-class + drawing-type + dual OCR (glm-ocr + Tesseract), 502 lines, tested | **REUSE** |
| Nameplate/equipment field extraction | `NameplateWorker` + `build_asset_identity()` (`asset_identity.py`) — raw-OCR-separate-from-interpreted, `approval_status` starts `unreviewed`, never auto-promoted | **REUSE** — this *is* the PRD's "looks-like vs verified-installed" distinction |
| Equipment identity → pack → manual | `resolve_service_pack()` + `DrivePack` schema (`mira-bots/shared/drive_packs/`); BM25 `retrieveManualChunks()` (`mira-hub/src/lib/manual-rag.ts`) over the `knowledge_entries` hybrid corpus | **REUSE** |
| Print understanding + plain-English theory | `PrintWorker` + `print_translator.py` (OCR ground-truth → 6-section explanation, observation-vs-inference in the prompt) | **REUSE** |
| Symbol + connection extraction from schematics | `SchematicIntelligence` (`mira-mcp/schematic_intelligence.py`) — 16 symbol types, IEC/ANSI, connection tracing | **PARTIAL-extend** (no quality gate; single vision provider) |
| Candidate graph → write seam | `WiringRow` + `write_rows()` (`tools/wiring_map_import.py`, `wiring_schematic_import.py`) → `wiring_connections` (mig 026): dedup by natural key, idempotent, `approval_state='proposed'`, `evidence_summary` JSONB | **REUSE** |
| Entity candidates | `kg_entities` (`approval_state` per ADR-0017) + `build_asset_identity()` packet | **REUSE** |
| Review / approval workflow | `ai_suggestions` (5 states) + `applyHubProposalTransition()` (TS) / `apply_kg_approval()` (Py), ADR-0017, CI canary | **REUSE** |
| Deterministic pack publishing | Print Pack (`machine-print-pack/`, PR #2642): `pack_model.json` is the graph shape; `build_pack.py` byte-deterministic; `validate_pack.py` checks M–R; standalone-without-MIRA by construction | **REUSE** (Phase 4 target) |
| Grading / hard-failure gates | `tests/eval/grader.py` (6-checkpoint, no-LLM), Print Pack `RUBRIC.md`, drive-pack `scorecard.py`, `citation_compliance.py` (alias-aware), named-pytest CI | **REUSE** |
| Turn processing + grounding + tenancy | Supervisor engine (`mira-bots/shared/engine.py`), UNS gate, 7-layer tenant scoping incl. the `knowledge_entries` hybrid read filter | **REUSE** |

### The genuine gaps (what VT must build)

1. **Persistent multi-image `VisualSession` + `Observation` ledger.** Today a session holds **one** photo (`session_photos/{chat_id}.jpg`, *replaced* not accumulated); `PhotoBatchQueue` is intra-burst (4 s). There is no cross-turn, cross-surface, multi-image session and no per-claim evidence ledger. **This is the spine of the product.**
2. **Evidence-state vocabulary + structured `AnswerClaim` envelope** — the PRD's 8 states and the required 6-part answer pattern, as data, not prose.
3. **Contradiction engine** — ADR-0017 defines the `contradict` transition; no active detector re-evaluates evidence for conflict.
4. **Image quality gate** — a numeric score to reject unreadable photos and request a better one.
5. **Confidence-scored candidate inference** — photo → candidate edges with per-edge confidence feeding the review queue (schematic rows currently land `function_class='unknown'`).
6. **Next-best-evidence recommender** — "the single most useful next photo/sheet/label."
7. **Real-photo benchmark corpus + hard-failure gates** — including a **tenant-isolation regression test** (absent today) and a **no-unsupported-safety-claim** gate.

---

## Decision

### D1 — The VisualSession spine is a new, Neon-backed, tenant-scoped ledger (the only substantial new schema)

The session/observation ledger MUST be **cross-surface** (a photo taken on Telegram is reviewable in the Hub) and **tenant-isolated**. The engine's current per-instance SQLite `conversation_state` cannot satisfy either. Decision: a small set of **Neon (Postgres) tables**, RLS-scoped, reachable from the engine (Python) and the Hub (TypeScript), added via `mira-hub/db/migrations/` under the mig rules (§`.claude/rules/mira-hub-migrations.md`). New tables:

`visual_session`, `evidence_item`, `region_of_interest`, `observation`, `answer_claim`, `verification_task`.

`entity_candidate` and `connection_candidate` are **NOT** new tables — they are the existing `kg_entities` (proposed) and `wiring_connections` (proposed) rows, written through the existing `WiringRow`/`write_rows` seam. `pack_revision` is the existing Print Pack `pack_model.json` + `CHECKSUMS.txt` (deterministic, already versioned). This keeps the new surface minimal and the publish path standalone.

### D2 — The evidence-state vocabulary COMPOSES over existing vocabularies; it does not fork a sixth

ADR-0026's lesson is binding: *divergent provenance vocabularies with no documented mapping produce silent breakage.* The PRD's answer-claim states are therefore defined as a **view over** existing systems, and this mapping is the contract:

| PRD evidence state | Backed by (existing) |
|---|---|
| `VISIBLE` | an `observation` whose extractor is image/OCR/vision on the supplied `evidence_item` |
| `DOCUMENTED` | a cited `knowledge_entries` chunk (BM25) or a `DrivePack` item with `provenance.tier ∈ {manual_cited, bench_verified}` (ADR-0025/0026 evidence classes) |
| `MACHINE_VERIFIED` | a `kg_entities`/`wiring_connections` row with `approval_state='verified'` (ADR-0017) **within the asset's revision scope** |
| `LIKELY` | model inference — never written as a `verified` edge; lands as a `proposed` candidate with confidence |
| `NEEDS_CONTEXT` | no resolving observation/citation exists; triggers the next-best-evidence recommender |
| `CONFLICTING` | ≥2 observations disagree → the ADR-0017 `contradict` transition (`kg_*→needs_review`) |
| `FIELD_VERIFICATION_REQUIRED` | the Print Pack tier **APPROVABLE WITH FIELD VERIFICATION** / an open-item on the pack |
| `REJECTED` / `SUPERSEDED` | ADR-0017 `rejected` / `superseded` |

The enum ships **once**, in three synchronized surfaces (a Python module, a TS module, and a SQL `CHECK`), the same discipline ADR-0017 uses. It is `EvidenceState`, not a per-call-site string.

### D3 — The AnswerClaim envelope is the grounded-answer contract for every surface

Every consequential answer returns the PRD's structured envelope (not only prose): `answer`, `claims[]` (each `{text, state, evidence_ids[], reason?}`), `next_best_evidence`, `safety_notes[]`. Thin clients render the prose but MUST receive the envelope — "thin clients must not create a weaker, uncited answer path" (PRD §7). The envelope is produced by the existing answer composer extended to read the `observation` ledger, and it passes through the existing `citation_compliance` grounding gate.

### D4 — Reuse the existing workers as the extraction layer; add only the quality gate and the confidence-scored candidate builder

`VisionWorker` classifies/routes; `PrintWorker`/`SchematicIntelligence` extract print structure; `NameplateWorker`+`resolve_service_pack` handle equipment identity. VT adds (a) a numeric **image-quality gate** in front of the vision call, and (b) a **candidate-graph builder** that turns extracted observations into `proposed` `wiring_connections`/`kg_entities` with per-edge confidence — reusing `write_rows()`, never a parallel writer.

### D5 — Publishing goes through the Print Pack unchanged; the bundle stays standalone

Phase 4 maps accepted `observation`/`connection_candidate` rows into the Print Pack model and runs `build_pack.py` → `validate_pack.py`. The exported bundle remains useful without MIRA (Print Pack SPEC §6). The **APPROVABLE WITH FIELD VERIFICATION** tier is preserved end-to-end; nothing is published as field-verified that is only approvable-with-field-verification (PRD hard rule; Print Pack check R).

### D6 — Safety and tenancy are gates, not guidance

- **No-invention** and **no-unsupported-safety-claim** become **hard-failure CI gates** (extending the `grader.py`/RUBRIC pattern), not just prompt instructions.
- A **tenant-isolation regression test** (absent today) is a release gate: Tenant A's evidence/uploads never appear in Tenant B's retrieval — enforced through the existing hybrid read filter + RLS, and *tested* on an ephemeral DB.
- The engine never claims de-energized/safe state from an image; the answer envelope carries a standing `safety_notes` entry to that effect for energized-adjacent questions.

---

## Canonical data contracts (minimums; extend, don't fork)

```
VisualSession(session_id, tenant_id, machine_id/asset_id?, status, created_by, created_at, updated_at, current_revision?)
EvidenceItem(evidence_id, session_id, source_type[print|panel|nameplate|terminal|plc|drive|hmi|area|mixed|unknown],
             original_uri/hash, derived_uri/hash, capture_meta, quality_score, page/sheet?)
RegionOfInterest(region_id, evidence_id, geometry, label, origin[user|system], transform_to_original)
Observation(observation_id, region_id, entity|property|relation, raw_value, normalized_value,
            evidence_state, confidence, extractor, review_state)     # the ledger; append-only + review history
EntityCandidate      -> kg_entities (proposed)                        # NOT a new table
ConnectionCandidate  -> wiring_connections (proposed, via WiringRow)  # NOT a new table
AnswerClaim(claim_id, question_id, text_span, claim_type, supporting[observation|doc|machine_fact] ids,
            evidence_state, uncertainty, safety_flag)
VerificationTask(task_id, requested_check, priority, risk, assignee?, status, resolution_evidence?)
PackRevision         -> pack_model.json + CHECKSUMS.txt (Print Pack)  # deterministic, already versioned
```

---

## Phased PR plan (narrow PRs, PRs-only, isolated worktrees)

- **PR-0 (this) — Phase 0.** ADR-0027 + the saved PRD (`docs/prd/…`). Docs only. Deliverable #1.
- **PR-1 — Phase 1 (Snippet Interpreter MVP).** New Neon tables (`visual_session`, `evidence_item`, `region_of_interest`, `observation`, `answer_claim`) + `EvidenceState` enum (Py/TS/SQL). One print image → `VisionWorker` classify → `PrintWorker`/`SchematicIntelligence` extract → observation ledger → AnswerClaim envelope with next-best-evidence; persistent follow-up Q&A. Golden corpus + hard-failure tests (no-invented-destination). Deliverables #2, #3.
- **PR-2 — Phase 2 (equipment/panel).** Wire `NameplateWorker`+`resolve_service_pack`+`retrieveManualChunks` into the session; `looks-like` vs `verified-installed` via `build_asset_identity`; machine-pack mismatch → `CONFLICTING`. Deliverable #4.
- **PR-3 — Phase 3 (multi-photo + contradiction + review).** Cross-photo entity/terminal reconciliation; the **contradiction engine** (ADR-0017 `contradict`); reviewer queue via `ai_suggestions`; derived-crop→original mapping. Deliverable #5.
- **PR-4 — Phase 4 (draft publishing).** Accepted candidates → Print Pack model → `build_pack.py`/`validate_pack.py`; preserve tier; standalone bundle. Deliverable #6. (Stacks on PR #2642 / merges after it.)
- **PR-5 — Phase 5 (connected + parity + ops).** Link to PLC tags/params/manuals/WOs; thin-client parity (Telegram + 1 more, same envelope); tenant-isolation + safety hard-failure CI gates; observability, cost/latency, runbooks. Deliverables #7 (CV-101 demo session), #8 (benchmark+CI), #9 (thin-client proof), #10 (operator docs).

Each PR body carries: before/after evidence, exact changed files, tests + outputs, risks, dependency order, rollback — per the PRD execution directive.

---

## Non-goals / hard rules (restated)

Not an unrestricted "AI electrician": no unsupported hazardous-energy instructions, no panel certification, no LOTO replacement, no treating a photo as proof of de-energization. No control writes (read-only OT). No new provenance vocabulary. No anonymous cross-tenant retrieval. No publishing field-verified what is only approvable-with-field-verification. No bypassing existing validators/graders/approval states.

## Open questions / risks

- **Session store placement.** Neon-backed (D1) adds a DB round-trip per turn on the bot path (today SQLite-local). Mitigation: cache the working session state; persist observations async. Revisit if p95 regresses.
- **Cross-surface identity.** A portable `session_id` decoupled from platform `chat_id` needs a join table per surface; Phase 1 scopes to one surface, Phase 5 generalizes.
- **Ignition cloud has no KB access today** — Phase 5 parity work, not Phase 1.
- **ADR-0026 ordering.** VT's evidence-state view (D2) depends on ADR-0026's unified classes; land/accept ADR-0026 first or together.

## Consequences

The new surface is ~6 small tables + one enum + one candidate-builder + one quality gate; **everything else is composition of existing, tested seams.** The product's spine (session + observation ledger + answer envelope) becomes the durable structured artifact the PRD's north star demands, while the exported Print Pack stays useful without MIRA.
