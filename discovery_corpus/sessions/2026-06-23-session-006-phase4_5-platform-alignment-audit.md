# Session 006 — Platform alignment & Hub integration audit (Phase 4.5)

**Date:** 2026-06-23
**Recorder:** Discovery Recorder (ProveIt 2027 northstar, Phase 4.5)
**Class of work:** read-only architecture audit (NO code, NO new features, NO Phase 5)

> Mission: determine whether the Phase 0–4 spine is integrated into the existing FactoryLM Hub/MIRA
> ecosystem or exists as a parallel subsystem. Build nothing until known.

---

## 1. Question being answered

Is the Phase 0–4 spine already part of FactoryLM and MIRA, or have we accidentally built a second
product beside them? If parallel — exactly where and how does it merge?

## 2. Files / architecture inspected (existing MIRA repo, read-only)

- **DB/schema:** `mira-hub/db/migrations/*.sql` (head = **056**), `docs/migrations/*.sql` — `kg_entities`/`kg_relationships`, `relationship_proposals`/`relationship_evidence`, `ai_suggestions` (027), `tag_entities` (025), `component_templates` (016), `knowledge_entries` (001+045), `cmms_equipment`, `decision_traces` (032), the HubV3 `contextualization_*`/`ctx_*` stack (055/056).
- **Approval:** `mira-hub/src/lib/proposal-transition.ts`, `mira-bots/shared/proposal_transition.py`, ADR-0017, `/api/proposals|suggestions/[id]/decide`, `/knowledge/suggestions` UI.
- **MIRA services:** `mira-bots/shared/engine.py` (Supervisor), `citation_compliance.py`, `decision_trace.py`, `neon_recall.py`, `mira-pipeline/ignition_chat.py`, `mira-hub/.../mira/ask`, `manual-rag.ts`, `mira-mcp/server.py` CMMS tools.
- **Transport:** `mira-relay/`, `mira-bridge/`, `mira-fault-detective/`, `plc/conv_simple_anomaly/`, `simlab/uns.py`+`publishers.py`, `.claude/rules/direct-connection-uns-certified.md`.
- **UI:** `mira-hub/src/app/(hub)/{namespace,contextualization,knowledge,assets,command-center}`, `WhyMiraThinksThis.tsx`, `AssetChat.tsx`, `NodeChat.tsx`.

Method: 5 parallel sub-agents (one per area cluster), each returning grounded file:line facts + mapping verdicts. Synthesized into 7 area reports + `platform_alignment_master.md`.

## 3. Assumptions tested

| # | Assumption | Result |
|---|---|---|
| A1 | The spine has *some* coupling to the platform (shared lib, DB, API). | **FAILED** → zero imports from mira-bots/hub/pipeline; no DB/API/UI. Fully standalone. |
| A2 | `mira-relay` has an MQTT ingest (`mqtt_ingest`) the spine can plug into. | **FAILED** → `mira-relay` has ZERO MQTT; HTTP/WS only. The module is planned, not built. Sparkplug B is documentation-only (no code). |
| A3 | The Hub has no answer-card UI; the spine's card is net-new UI. | **FAILED** → `WhyMiraThinksThis.tsx` IS the answer card; `decision_traces` already STORES the hard fields (`next_check`, `context_ignored`) — parked, not missing. |
| A4 | The spine's manual/history fixtures fill a real evidence gap. | **PARTIAL** → they were the right offline stand-in, but duplicate `knowledge_entries` (mig-045 anchors) + `cmms_*`. Real stores exist. |
| A5 | The spine's approval model is its own concept. | **FAILED** → it IS the ADR-0017 machine; `{suggested,approved,rejected,needs_review}` == `kg_*.approval_state` verbatim. |
| A6 | The FactoryModel has no Hub home. | **PARTIAL** → HubV3 `contextualization_*`/`ctx_extractions` (migs 055/056) is a staging home; canonical materialized-tree home is `kg_entities`+`tag_entities`+`cmms_equipment`. |
| A7 | Every spine object maps cleanly. | **PARTIAL** → Asset/Signal/UNS DIRECT; Suggestion/Relationship/Evidence PARTIAL (enum/locator gaps); **Failure Mode MISSING** (no table). |

## 4. Failed assumptions (the load-bearing surprises)

- The platform is **more built than the spine assumed** (migration head 056; HubV3 intake; the card component; `decision_traces`; the approval machine). The spine **re-invented** several things FactoryLM already has.
- The one genuinely-new thing the spine contributes: the **ranked, contradiction-aware answer-card SHAPE** — and even its fields are already *stored* in `decision_traces`, just unrendered.
- The spine is a **parallel codebase**, not a parallel *product* — same world, same brain target, same approval machine, almost every object has a home.

## 5. Integration risks

Top risks (full list in `reports/platform_alignment_master.md` §B): the spine as a whole (no platform imports); `evidence_graph` becoming a second brain; synthetic fixtures shipping as the runtime store; naive new tables (`factory_nodes`/`suggestions`/`evidence`/`failure_modes`); a relationship-type enum fork; a new "Diagnosis" page; `mqtt_uns` becoming another standalone-rules subscriber (the `mira-fault-detective` trap).

## 6. Reusable architecture findings

The 8 committed reports ARE the reusable artifact:
`reports/platform_alignment_{master,data_model,db,approval,mira,evidence,transport,ui}.md`.
Key seams to remember: `proposal-transition.ts`/`.py` (status), `_evidence_from_parsed`+`decision_traces`
(explanation evidence), `manual-rag.ts ManualSource` (citation shape), `ignition_chat.py` direct_connection
(transport), `WhyMiraThinksThis.tsx` (card UI), `ai_suggestions`+`/knowledge/suggestions` (approval queue),
`contextualization_*`/`ctx_extractions` (FactoryModel intake). The single schema change needed:
`needs_review` on `ai_suggestions`. The single missing object: a Failure-Mode home.

## 7. Conclusion + decision

**Parallel architecture in code; one thin integration layer from merging.** Recommended next move:
**Phase 5 = Hub integration (A) + MIRA integration (B)** — make the spine write the Hub's tables via the
existing helpers, read the real evidence stores, layer `explain_cause` over the Supervisor, and render the
card in `WhyMiraThinksThis`. **Defer** Ignition (C), live MQTT (D), and a real factory pilot (E) until the
spine speaks FactoryLM — doing them first would pilot a parallel product. First PR: persist the Phase 1
FactoryModel into `ai_suggestions`/`ctx_extractions` (+`needs_review` migration). No new tables/pages/
infra. Full plan: `reports/platform_alignment_master.md`.

## 8. Tests / fixtures added

None — audit only. No code, no package changes, no licensed data. The Phase 0–4 gates (76 tests) are
untouched. Deliverable = the 8 alignment reports + this session record.
