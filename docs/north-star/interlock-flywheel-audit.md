# Interlock Flywheel — Repo Audit & Build Plan (2026-06-23)

**Mission:** wire existing pieces so the production contextualization flywheel works end-to-end for
ONE technician-grade "hidden condition blocks motion" scenario. Reuse > rebuild. Investigate first.

> Status of this doc: **investigation deliverable, pre-code.** Evidence is file:line from the live
> tree @ `ef90c7e8`. Build plan follows the audit.

---

## Chosen scenario — Conv_Simple conveyor run-permissive (REAL repo data)

The actual bench PLC program already encodes the exact "hidden condition blocks motion" chain:

```
plc/Prog_init_ConvSimple_v2.1.st
  208  IF _IO_EM_DI_05 THEN pe_latched := TRUE;   (* beam blocked -> latch soft stop *)
  214  vfd_run_permit := _IO_EM_DO_02 AND e_stop_ok AND NOT pe_latched;
  236  motor_running  := vfd_run_permit AND (dir_fwd OR dir_rev);
```

Causal chain: **photoeye beam blocked → `pe_latched` TRUE → `vfd_run_permit` FALSE → `motor_running`
FALSE (conveyor won't run).** This is the example desired answer, verbatim, in real Structured Text —
not invented. It matches the Conv_Simple PLC lineage, the garage conveyor demo, and SimLab's conveyor
machine. **This is the scenario.**

---

## Existing pieces found (reusable)

| Capability | Where | Status | Reuse decision |
|---|---|---|---|
| **PLC permissive logic (source data)** | `plc/Prog_init_ConvSimple_v2.1.st:214,236` | ✅ real ST | INGEST source — parse this file |
| **Proposal creation** | `mira-crawler/ingest/proposal_writer.py` `propose_relationship(c, tenant, src, tgt, relation_type, confidence, reasoning, proposed_by, source_chunk_id, source_description)` | ✅ real (just hardened #2273) | PROPOSE step — call as-is. Writes `relationship_proposals` + `relationship_evidence` + `ai_suggestions(kg_edge)` |
| **Proposal→verified promotion** | Hub `mira-hub/src/app/api/proposals/[id]/decide/route.ts` | ✅ real (TS/Next) | APPROVE step — TS route; needs a python-callable equivalent for a hermetic test (mirror its SQL in a shared helper) |
| **KG schema** | `kg_entities`, `kg_relationships`, `relationship_proposals`, `relationship_evidence`, `ai_suggestions` | ✅ real (prod) | Store. **Gotcha:** prod `kg_relationships` uses Hub-001 cols `source_id/target_id/relationship_type` (NOT engine-lineage `source_entity/...`). Read the Hub columns. |
| **Engine KG-context seam** | `engine.py:3355 _build_kg_context` → `_fetch_kg_maintenance_context` (Hub `/api/internal/kg` op `maintenance_context`) → `_format_kg_context` | ⚠️ partial | EXTEND — surfaces equipment/components/faults/WOs only; **no interlocks; marked "not a citable source"** |
| **Engine live-data seam** | `engine.py:3462 _build_live_data_context` (mira-fault-detective HTTP) | ⚠️ flag-gated | pattern to mirror for live tag state |
| **Live tag state (sim)** | `simlab/` (engine/scenarios/publishers) | ✅ real | LIVE STATE — drive conveyor to beam-blocked, read `pe_latched`/photoeye (exact API: pending SimLab survey) |
| **Doc retrieval (citable)** | `mira-bots/shared/neon_recall.py` `recall_knowledge` (BM25+vector) | ✅ real | evidence for the manual reference, if a conveyor manual chunk exists |
| **Citation/evidence carrier** | `engine.py` per-turn grounding (L1094, L3606); `citation_compliance.py` | ⚠️ logs, no enforce | LOG step — assert evidence present |
| **Asset-agent approve lifecycle** | `asset_agent_status` (mig 046/047), `asset_agent_transition.py` | ⚠️ partial | orthogonal to this loop (deployment auth, not answer-grounding) — note, don't block on it |

## Gaps (classified)

| Gap | Class | Notes |
|---|---|---|
| **Engine answer path never reads `kg_relationships`** | **missing wiring** | `neon_recall` grounds only on `knowledge_entries`; `_build_kg_context` returns equipment/components/faults/WOs, never interlock edges. **THE core gap.** |
| **No "interlock/blocking-condition" op in Hub internal KG API** | missing wiring | `maintenance_context` op doesn't return `relation_type IN (blocks,inhibits,enables,requires)` edges |
| **KG context marked non-citable** | missing wiring | `_format_kg_context` label forbids citing it; a verified+approved interlock SHOULD be citable evidence |
| **No ST permissive→relationship extractor** | genuinely new (small) | parse `X := ... AND NOT Y` permissive assignments into edges. The PLC parser lineage handles tags/anomaly rules, not permissive-edge extraction (verified: `plc/` has the ST, no edge extractor) |
| **No python-callable proposal→verified promotion** | missing wiring | promotion lives only in the Hub TS route; a hermetic python test needs the same SQL in a shared helper |
| **asset_id→equipment_id resolver** | missing resolver | the "one remaining slice" (`asset-agent-validation-spec.md:33`); only blocks the *Ignition deployment gate*, NOT this answer loop (we key on uns_path/equipment_id directly) |
| **KG proposal flywheel input dead in prod** | broken job | ingest jobs don't run in prod (0 suggestions/3wk) — out of scope for this loop; we drive ingest explicitly |

---

## Build plan (P0 → P3) — reuse-maximal, deterministic, hermetic

**Principle:** build REAL production functions (extractor, reader, engine wire); prove them with ONE
deterministic test against an ephemeral Postgres (CI already uses `postgres:16`) + SimLab live state.
The non-deterministic LLM phrasing layer is NOT asserted on; the deterministic *grounding/evidence
assembly* is. (Matches SimLab's own evidence-packet+rubric grading.)

**P0 — one end-to-end loop (conveyor, photoeye, won't-run):**
1. `plc_permissive_extract.py` (new, small): parse `Prog_init_ConvSimple_v2.1.st` → edges
   `pe_latched --blocks--> vfd_run_permit`, `vfd_run_permit --enables--> motor_running`, with
   evidence `{file, line, rung_text}`.
2. PROPOSE via real `propose_relationship` (relation_type `blocks`/`enables`, evidence = rung).
3. APPROVE via a shared promotion helper (`promote_proposal_to_verified`) mirroring the Hub decide
   route SQL → insert verified `kg_relationships` (Hub cols) + mark proposal verified.
4. READ via new `recall_interlocks(conn, tenant, equipment_or_uns)` → verified blocking/enabling edges
   + evidence (the real missing wire).
5. ANSWER assembly: combine approved interlock edges + live tag state (SimLab `pe_latched`) + PLC
   evidence → grounded result `{blocking_tag, affected_asset, why, live_value, evidence[], next_checks}`.
6. LOG: record answer + evidence + `context_approved` flag; refuse to answer from *unapproved* context
   unless `dev_mode`.

**P1 — wire into the real engine:** extend Hub `/api/internal/kg` with an `interlocks` op (or fold
into `maintenance_context`), and have `engine.py` render approved interlocks as **citable** evidence +
cross-reference live tag state. (Production path, behind the existing `_KG_CONTEXT_ENABLED` flag.)

**P2 — evidence/trust:** every answer cites ≥1 of {PLC rung, tag path, uns_path, approved proposal id,
live value}. Wire `citation_compliance` to flag an interlock answer with no evidence.

**P3 — tests:** deterministic test proving: ST→proposal; proposal→approved; approved→retrievable;
live beam-blocked→diagnosis; answer contains blocking tag + asset + why + live value + evidence;
unapproved context yields no answer (except dev mode).

## Proving command (target)
`pytest tests/flywheel/test_interlock_flywheel.py -v` (ephemeral PG + SimLab) — green = loop real.

## What will remain theatre after P0 (to be blunt up front)
- Running through the **real Supervisor + cloud LLM + Neon** end-to-end (non-deterministic; the test
  asserts grounding, not LLM prose).
- **Prod ingest** still doesn't auto-run; we drive the ST extractor explicitly.
- The **Ignition deployment gate** stays off (resolver unbuilt) — this loop doesn't need it.
- Hub TS approval UI unchanged; the hermetic test uses the SQL-equivalent promotion helper.
