# Maintenance / CMMS / Distillation Flywheel — Discovery Report

**Caveat:** the gs10-ask-tool worktree branch predates the flywheel work, migrations 061/062, and the MachineMemoryCard WO button — all on main only.

## 1. Work orders — mira-hub
- `work_orders` table (migs 005/006/007/008): tenant_id, description, fault_description, resolution, closed_at, source enum, route_taken enum, atlas_id, cmms_synced_at/etag.
- **Mig 060** `060_work_orders_source_run_diff.sql` — work_orders.source_run_diff_id UUID → run_diff(diff_id) + partial index. Closes "WO from anomaly" measurability gap (product-scoreboard §4.1 Metric 7).
- **Anomaly→WO wiring (main, PR #2415 "T4")**: MachineMemoryCard "Create work order" button deep-links /workorders/new?prefill_title&prefill_description&source_run_diff_id; `prefill.ts` parseWorkOrderPrefill pure+tested; POST /api/work-orders persists source_run_diff_id. REUSE AS-IS.
- WO detail page: start/stop timer, complete form (#897), parts picker, comments, **photo evidence attachment** (#1929, wo-photo-upload.ts) — the ONLY real evidence-attachment feature in the repo.
- WO list/API + CSV export, tested.

## 2. CMMS
- `mira-cmms/` — self-hosted Atlas (GPL-3.0, REST-only boundary), 4 containers. Production infra.
- Adapter layer: `mira-mcp/cmms/{atlas,fiix,limble,maintainx,base,factory}.py` — CMMSAdapter protocol, CMMS_PROVIDER env. `atlas_client.py` = documented back-compat shim (not duplicate).
- MCP tools (`mira-mcp/server.py:260-390`): cmms_write_work_order, cmms_create_work_order (external if configured, else internal Atlas), cmms_list_work_orders, cmms_complete_work_order, cmms_list_assets, cmms_get_asset, cmms_list_pm_schedules, cmms_health.
- **DUPLICATE flag:** `tools/owui_tools/create_work_order.py` — Open-WebUI tool hits Atlas via raw urllib, copy-pasted auth/JWT. Extend/retire → route through shared adapter.
- Retry outbox: `mira-bots/shared/integrations/wo_outbox.py` (local SQLite, 3 attempts + drain + 3h alert; mira-bridge/migrations/004). Legit retry buffer, NOT competing source of truth; invisible to NeonDB audits.
- Skill `work-order-history-miner` — doctrine only, findings taxonomy (repeat failures, MTBF, reset-only, parts churn, PM gaps), output docs/work-order-mining/. **No implementation exists — build against this spec.**

## 3. Machine-history storage
- 038 machine_run/run_step/run_baseline/run_diff (append-only, RLS dual-GUC); 040 machine_state_window + typed anomaly columns. run_diff = anomaly ledger, FK target of mig 060.
- Historian list_runs() wiring to machine_run still TODO (#2339 note in migration header).
- **No dedicated technician-notes/downtime/repair-record table** — captured via work_orders.resolution/fault_description, relationship_evidence.evidence_type='technician_note', ai_suggestions.source_kind='technician_note', machine_state_window/run_diff.

## 4. Distillation flywheel (all on main, shipped)
| Phase | PR | What |
|---|---|---|
| 1 capture | #2573 | mira-core/mira-ingest migs 012/013 conversation_eval (+meta JSONB: surface, pack_id, matched, matched_kind, answer_source, resolution) |
| 2 auto-score | #2576 | Groq cascade → auto_score + breakdown |
| 3a gap report | #2578 | drive-pack coverage gap report |
| 3b gap→suggestion | #2585 | gap → review suggestion |
| 4a golden harvest | #2586 | tools/harvest_golden_cases.py (print-only, human-gated → bot_regression GOLDEN_CASES) |
| benchmark | #2587 | tools/flywheel_benchmark.py + 6-criterion rubric, sabotage-tested |
| fail-clean | #2589 | tools fail-clean when capture schema absent |
| 4b relational distill | #2596 `b8e65032` | tools/relational_distill.py — matched fault turns (grounded-by-construction) → "<family> HAS_FAILURE_MODE <fault>" proposals via proposal_writer.propose_relationship_cursor → relationship_proposals(proposed) + relationship_evidence(technician_note) + ai_suggestions(kg_edge) → Hub /proposals. Resolve-or-skip, never fabricates entities. |
Tests: test_relational_distill (12), test_flywheel_benchmark, test_harvest_golden_cases, test_proposal_writer (22).
**Verdict: reuse/extend — natural place to hang WO-history mining (same proposal_writer + ai_suggestions bridge, no new write path).**

## 5. ai_suggestions
Mig 027 (ADR-0014): suggestion_type CHECK kg_edge|kg_entity|tag_mapping|component_profile|uns_confirmation|namespace_move, +drive_pack_update in 062. source_kind: knowledge_entry|work_order|tag_entity|photo|session|manifest_row|technician_note|live_event|manual_entry. RLS hardened 058. Lifecycle pending→accepted/rejected/deferred/superseded via POST /api/suggestions/[id]/decide. UI knowledge/suggestions/page.tsx (read-only "slice 1"; confirm/edit/reject = slice 2, verify if shipped).

## 6. Shift handoff / maintenance-case / evidence-attachment
- Shift handoff: ideation docs + marketing copy only. NO feature/table/route.
- Maintenance-case: zero hits; closest = ai_suggestions/relationship_proposals queue.
- Evidence attachment: WO photo upload only (§1).

## 7. Technician-confirmation loops
Canonical doc: `docs/mira/technician-confirmation-gate.md` — three existing mechanisms (don't reinvent):
1. UNS location gate (engine.py::_should_fire_uns_gate)
2. ai_suggestions queue (027)
3. relationship_proposals/evidence (018) + /api/proposals/[id]/decide = ONLY path to verified kg_relationships (ADR-0017)
- `mira_connectors/confirmation_gate.py` (+store/service+tests) extends to connector data: propose→confirm/correct/reject.
- `proposal_transition.py`/`proposal-transition.ts` — doc said missing; mira-hub/src/lib/proposal-transition.ts + test EXISTS on main — verify current state.
- PostgresProposalStore: schema-verified, NEVER run against real DB — needs staging exercise.

## Verdicts
- Reuse: mig 060 + MachineMemoryCard prefill (anomaly→WO), flywheel 1–4b, ai_suggestions/relationship_proposals architecture, WO-miner taxonomy.
- Extend: owui create_work_order (unify with adapter), build the WO-history miner, verify proposal-transition state.
- Build fresh if needed: shift handoff, maintenance-case, dedicated technician-notes/downtime tables.
