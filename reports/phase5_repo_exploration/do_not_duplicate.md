# Phase 5 — Do Not Duplicate

**The systems that already exist and must NOT be re-built. Each line = the existing home + the rule.** 2026-06-23.

| # | Do NOT build | Because it already exists at | Rule |
|---|---|---|---|
| 1 | **A second approval queue** | `ai_suggestions` + `/knowledge/suggestions` (the only `/proposals` reader); ADR-0017 state machine via `proposal-transition.ts` / `proposal_transition.py` | Write spine suggestions into `ai_suggestions`; transition only via `applyHubProposalTransition`. Never a `suggestions` table. |
| 2 | **A second answer-card UI / a "Diagnosis" page** | `WhyMiraThinksThis.tsx` (the card skeleton, attached to every `AssetChat` answer via `traceId`) | Render the new `explanation` JSONB inside `WhyMiraThinksThis`; a standalone page orphans chat context + duplicates the `/api/decision-trace/[id]` fetch. |
| 3 | **A second evidence / citation store** | `knowledge_entries` (+ mig 045 `page_start`/`section_path`) for manuals; `decision_traces` (`tag_evidence`/`manual_evidence`/`kg_evidence`) per turn; `relationship_evidence` per edge; `cmms_*` for history | Point spine citations at these; retire the synthetic `maintenance_knowledge.json` / `maintenance_history.json` as runtime sources (they stay as test fixtures). |
| 4 | **A second MIRA endpoint / a second chatbot** | one `Supervisor` (`engine.py`); doors `ignition_chat.py`, `/api/mira/ask`, `ask_api`, Slack/Telegram all call `engine.process()` | `explain_cause` is a **pure post-processor inside the engine** (`_schedule_decision_trace`), not a new route/LLM call. The HMI keeps calling `/api/v1/ignition/chat`. |
| 5 | **A `factory_nodes` table** | `kg_entities` (`uns_path ltree` + `properties JSONB` + `approval_state`) | Node attributes (archetype/udt_type/unit) go in `kg_entities.properties`. |
| 6 | **A third signal table** | `tag_entities` (approved) ← `ctx_extractions` (staged) | Promote `ctx_extractions` → `tag_entities`; do not add a third. |
| 7 | **A fourth evidence table** | evidence already in `decision_traces` + `relationship_evidence` + `ai_suggestions.extracted_data` | Reuse; do not centralize into a new table. |
| 8 | **A `failure_modes` table / `fault_code` suggestion_type** | `component_templates.common_failure_modes` (JSONB) + the `HAS_FAILURE_MODE` edge type | Keep embedded; revisit only on a proven per-asset citable-failure-mode requirement. |
| 9 | **A relationship-type enum fork** | `relationship_proposals` / `kg_relationships` (25-value CHECK) + `CANONICAL_PROPOSAL_RELATIONSHIP_TYPES` (`LOCATED_IN`/`HAS_SIGNAL`/`OCCURS_ON`/…) | Map spine `{contains,feeds}` onto existing canonical types; never a free-text rel-type column. |
| 10 | **A separate runtime DB for synthetic spine objects** | the spine has no DB by design; its synthetic fixtures are Evidence-class-3 test data | Spine writes the Hub's Neon tables; fixtures never become a runtime store. |
| 11 | **A second MQTT/event-processing architecture** | the `direct_connection` contract (`ignition_chat.py`); the bench `mira-fault-detective` already shows the standalone-rules-subscriber anti-pattern | When transport lands, the MQTT subscriber calls `engine.process(uns_source="direct_connection")` — not its own rules engine, not inside `mira-relay` (HTTP-only). |
| 12 | **A new UNS-draft review surface** (a 5th) | already four: `/contextualization/[id]`, `/contextualization/review/[batchId]`, `/knowledge/suggestions`, `/knowledge/map` | Consolidate; wire the `/namespace` Proposals-tab stub to the existing queue. The risk here is fragmentation, not absence. |
| 13 | **A second Ask-MIRA HMI** | the Perspective `MaintenancePanel`/`MiraAsk`/`AnomalyCard` exist | Rewire the existing MiraAsk button to `/api/v1/ignition/chat`; do not author a new panel. |
| 14 | **A second citation-enforcement / UNS-gate stack** | `citation_compliance.py` + the engine's UNS gate (`engine.py` + `direct-connection-uns-certified.md`) | `explain_cause` reuses the engine's `_citation_evidence`; it does not re-enforce citations or re-implement the gate. |
| 15 | **A second history/review inbox** | `/settings/review-queue` + `/knowledge/suggestions` + `decision_trace_feedback` | The answer-card "human review" links into these; no third inbox. |

## The one-sentence rule

**Phase 5 re-homes the spine's I/O onto FactoryLM's existing tables, queue, engine, citation store, and UI — and ports the spine's one net-new capability (the ranked, contradiction-aware `explanation`) *into* the engine.** If a Phase 5 change would create any row above's twin, stop and wire into the existing home instead.
