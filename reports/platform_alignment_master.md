# Platform Alignment — MASTER REPORT (Phase 4.5)

**Branch `feat/cappy-northstar-factory` · read-only audit · 2026-06-23**
**Auditors:** 5 parallel agents over the existing MIRA repo (data-model, approval, MIRA-services, evidence, transport, UI). Area reports: `platform_alignment_{data_model,approval,mira,evidence,transport,ui,db}.md`.

---

## THE ANSWER (test of success)

> *"Is the Phase 0–4 spine already part of FactoryLM and MIRA, or have we accidentally built a second product beside them?"*

**Parallel architecture in code — but NOT a second product in concept. It is one thin integration layer away from being merged.**

- **Why it's parallel:** the spine (`discovery_corpus`, `factory_context`, `causality`, `evidence_graph`, `mqtt_uns`) is a self-contained Python codebase in this worktree with **zero imports from `mira-bots` / `mira-hub` / `mira-pipeline`**, **no database**, **no API**, **no UI**, and **no calls to the Supervisor engine**. By the strict test, that is a second system.
- **Why it's NOT a second product:** it reasons over the *exact same world* the platform already models — UNS `ltree`, assets (`cmms_equipment`), signals (`tag_entities`), manuals (`knowledge_entries`), the ADR-0017 approval machine, and the one shared brain (`engine.py` Supervisor). **Almost every spine object and output has an existing Hub home**, and the spine's status enum `{suggested,approved,rejected,needs_review}` equals `kg_*.approval_state` *verbatim*.
- **The sharpest finding:** the Hub is *more built than the spine assumed*. The answer-card component already exists (`WhyMiraThinksThis.tsx`), its backing table (`decision_traces`) **already stores the spine's "hard" fields** (`context_ignored`=evidence-against, `next_check`=technician-checks) — they're deliberately *parked, not missing*. A HubV3 contextualization-intake stack already exists (`contextualization_projects`/`ctx_extractions`, migration head **056**).

**So: not a second product — but a parallel *codebase* that will calcify into one if Phase 5 builds outward (Ignition/MQTT/pilot) before wiring inward. Merge first.**

---

## SECTION A — WHAT ALREADY FITS (can immediately consume the engine)

| Spine output | Existing FactoryLM home | Fit |
|---|---|---|
| UNS path | `ltree` on `kg_entities`/`cmms_equipment`/`tag_entities` | DIRECT |
| Asset | `cmms_equipment` | DIRECT |
| Signal | `tag_entities` (approved) ← `ctx_extractions` (staged) | DIRECT |
| FactoryModel intake | `contextualization_projects`/`ctx_sources`/`ctx_extractions` (HubV3, migs 055/056) | DIRECT (staging) |
| Approval machine | ADR-0017 (`proposal-transition.ts`/`.py`); spine enum == `kg_*.approval_state` | DIRECT for assets+relationships |
| Suggestion queue + UI | `ai_suggestions` + `/knowledge/suggestions` (Verify/Reject) | DIRECT |
| Per-explanation evidence record | `decision_traces` (`uns_path`,`tag_evidence`,`manual_evidence`,`kg_evidence`,`recommendation`,`confidence`) | DIRECT |
| Answer-card UI skeleton | `WhyMiraThinksThis.tsx` (+ parked `next_check`/`context_ignored` fields) | DIRECT (skeleton) |
| Manual citations | `knowledge_entries` + mig 045 anchors; canonical shape `manual-rag.ts ManualSource` | DIRECT |
| Procedure / per-model failure modes | `component_templates.troubleshooting_steps` / `common_failure_modes` | DIRECT |
| History / corrective actions | `cmms_*` work orders via `mira-mcp` tools | DIRECT |
| The brain | `engine.py` Supervisor; `ignition_chat.py` envelope already answer-card-shaped | DIRECT (envelope) |
| direct_connection contract | implemented (HTTP) in `ignition_chat.py`; spine `asset_uns` = required identifier | DIRECT (contract) |

## SECTION B — DUPLICATION RISKS (where parallel systems would form)

1. **The spine as a whole** — a standalone codebase with no platform imports. (Root risk.)
2. **`evidence_graph` as a second brain** — if it keeps its own grounding/citation/UNS-gate/retrieval stack instead of layering over `engine.py` + `decision_traces`.
3. **Synthetic citation/history fixtures as the runtime store** — duplicates `knowledge_entries` + `cmms_*`.
4. **A `factory_nodes` table** — parallels `kg_entities.properties`.
5. **A third signal table** — `tag_entities` + `ctx_extractions` already exist.
6. **A `suggestions` table** — splits the single `ai_suggestions` queue.
7. **A fourth evidence table** — evidence already scattered across 3 homes.
8. **A relationship-type enum fork** — `{contains,feeds}` vs the 25-value vocab.
9. **A new "Diagnosis"/"Hypotheses"/answer-card page** — orphans `WhyMiraThinksThis.tsx`.
10. **`mqtt_uns` as another standalone-rules subscriber** — re-forks the engine, exactly as `mira-fault-detective` did.

## SECTION C — REQUIRED INTEGRATIONS (exact tasks)

1. **Persist the FactoryModel** by emitting `ai_suggestions` (`kg_entity`/`tag_mapping`) + `relationship_proposals`, and/or `ctx_extractions`, via the existing helpers — never new tables. Map FactoryNode→`kg_entities.properties`, Signal→`tag_entities`/`ctx_extractions`, Relationship `{contains,feeds}`→`HAS_COMPONENT`/`LOCATED_IN`/`UPSTREAM_OF`.
2. **Route every status change through `proposal-transition.ts` / `proposal_transition.py`** (`suggested→proposed/pending`, `approved→verified/accepted`); never write status directly.
3. **Make `explain_cause` a layer over the Supervisor** — consume `process_full()`→`_evidence_from_parsed` + the `decision_traces` row; emit the ranked for/against card as the net-new output. Do not re-implement grounding/citation/gate.
4. **Point citations at the real stores** — Manual→`knowledge_entries` (`manual-rag.ts ManualSource`), History→`cmms_*`, Procedure→`component_templates`; retire the synthetic fixtures as runtime sources.
5. **Close the bots-side locator gap** — extend `neon_recall.recall_knowledge` + `format_source_label` to select mig-045 `page_start`/`section_path`.
6. **Add the MQTT→engine adapter** beside `ignition_chat.py`: subscribe the spine topics → `simlab/uns.py from_mqtt_topic` → `engine.process(uns_source="direct_connection")`. Not in `mira-relay`; not a standalone-rules subscriber.
7. **Render the card in `WhyMiraThinksThis.tsx`** — un-defer `next_check`/`context_ignored`, add ranked-causes + recommendation; emit `traceId` from `NodeChat`/quickstart so every Ask-MIRA surface inherits it.
8. **Wire the `/namespace` Proposals-tab stub** to `/knowledge/suggestions`; consolidate the UNS-draft surfaces (no 5th page).

## SECTION D — REQUIRED MIGRATIONS (schema / service / API / UI)

- **Schema (one real change):** add `needs_review` to `ai_suggestions.status` CHECK (mig 027) so inferred-component/feeds/cell suggestions can sit in review on the rendered queue. *(Optional, deferrable: rename `pending→suggested`/`accepted→approved`, or keep the existing `PROPOSAL_TO_SUGGESTION_STATUS` translation.)*
- **Product decision:** Failure Mode's home — keep it embedded in `component_templates.common_failure_modes` + `HAS_FAILURE_MODE` edges (no-fork default), **or** add a `failure_modes` table + a `failure_mode` `suggestion_type` + decide path if per-asset citable failure-mode rows are required. **This is the single genuinely-missing object.**
- **Service:** extend `recall_knowledge` (locator columns); populate the `ignition_chat.py` envelope from the evidence packet + `decision_trace`; add the MQTT subscriber adapter.
- **API:** emit `traceId` from `NodeChat`/`quickstart/ask` routes; (if Failure Mode gets a home) a decide path for it.
- **UI:** un-defer the `WhyMiraThinksThis` fields + ranked causes; fill the `/namespace` Proposals-tab stub; use `--fl-*` tokens.
- **Process:** all schema via `apply-migrations.yml` (dev→staging→prod, dry-run first); UUID-vs-TEXT `tenant_id` discipline (`.claude/rules/mira-hub-migrations.md`).

## SECTION E — PHASE 5 RECOMMENDATION

**Phase 5 = A. Hub integration — paired inseparably with B. MIRA integration. Defer C (Ignition), D (live MQTT), E (real factory pilot).**

**Recommendation: A (+B).** Make the spine *speak FactoryLM's data model and reason through FactoryLM's brain*, and render its card in the existing UI — before building any new outward surface.

Why A+B first, not C/D/E:
- **The duplication risk is concentrated in the data model + queue + UI + brain** (Sections B 1–9). Every week the spine runs beside the platform, the parallel codebase hardens. Merge inward *now*, while it's still a clean re-mapping job and not a rewrite.
- **It's mostly re-mapping + rendering, not rebuild** — low risk, high leverage. The card UI already exists (`WhyMiraThinksThis`), the evidence store already exists (`decision_traces`), the approval machine already exists (ADR-0017), the citation store already exists (`knowledge_entries`). The spine's lasting value — the **deterministic, replayable engine + the ranked contradiction-aware answer-card shape** — folds in cleanly.
- **A+B unblocks everything else cheaply.** Once the spine writes `ai_suggestions`/`kg_entities`/`tag_entities`, reads `knowledge_entries`/`cmms_*`/`decision_traces`, and renders in `WhyMiraThinksThis`: **C (Ignition)** is "surface the same card on the Perspective panel," **D (live MQTT)** is the ~1-file `direct_connection` subscriber adapter, and **E (pilot)** finally has one product to pilot. Doing C/D/E first would pilot a *parallel* product.

**Concrete first PR (Phase 5, slice 1):** persist the Phase 1 FactoryModel as `ai_suggestions` (+`ctx_extractions`) through `proposal-transition`, so the synthetic factory's assets/signals/relationships appear in `/knowledge/suggestions` and `/contextualization/[id]` and can be human-approved — proving the spine's output flows into the *one* queue. Add `needs_review` to `ai_suggestions` in the same PR. No new tables, no new pages, no Ignition, no MQTT.

---

## What to keep from the spine (it is not throwaway)

The spine's **determinism, the one-command gates, the Discovery Recorder, the reproducible-claims discipline, and the ranked for/against answer-card shape** are real assets the platform lacks. Phase 5 should preserve the engine + tests and re-home its *I/O* (read real stores, write real tables, render the real component) — not delete and rewrite. The brain works; this phase proved the brain is **compatible** with FactoryLM. The remaining work is wiring, not reinvention.
