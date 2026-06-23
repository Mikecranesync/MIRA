# Platform Alignment — MIRA Services (Audit Area 3)

**Phase 4.5 audit, read-only. 2026-06-23.**
**Question:** can Phase 3 answer cards be generated through existing MIRA services, or has a second explanation engine been created?

**Verdict:** there is **one shared brain** already — `Supervisor` in `mira-bots/shared/engine.py`, fronted by thin HTTP adapters. The spine's `explain_cause()` **would be a second brain if built standalone**, but its **ranked for/against hypothesis card is a genuine net-new capability** the Supervisor lacks. Build it as a **layer over** the existing evidence packet + `decision_traces`, not a parallel grounding/citation/gate stack.

## The one engine + its adapters

| Service | File | Output | Answer-card-shaped? |
|---|---|---|---|
| **Supervisor (the brain)** | `mira-bots/shared/engine.py` (`process_full` L1763, `_make_result` L1062, `_evidence_from_parsed` L1093) | `{reply, confidence, trace_id, _citation_evidence}` + per-turn evidence `{kb_status, chunks, sources, no_kb}`; groundedness scored **1–5** in the LLM JSON contract. | Partial — reply + confidence + flat evidence packet; **no for/against hypothesis ranking**. |
| **Ignition cloud-chat** (direct-connection) | `mira-pipeline/ignition_chat.py` (envelope L654) | `{answer, sources, citations, evidence, confidence, suggested_actions, …}` — **already answer-card-shaped, but `sources/citations/evidence/suggested_actions` are emitted empty `[]`**. | Envelope yes, contents no. |
| **Hub asset chat** | `mira-hub/src/app/api/mira/ask/route.ts` | `{answer, citations (typed [C1..Cn]), transition_fact, trend_proposal}` — citations bound to asset row / component_template / live_signal_cache / KG edges. | **Closest existing analog** — ranked grounded facts + typed citations + a hypothesis proposal. |
| **AskMira kiosk** | `mira-bots/ask_api/app.py` | `{answer, uns_gate_state, candidate_asset}` — flat. | No. |

Citation enforcement is centralized: `mira-bots/shared/citation_compliance.py` (`check_citation_compliance`, `enforce_citation_via_rewrite`). The per-turn evidence record is **already persisted**: `decision_traces` (mig 032) stores `uns_path`, `tag_evidence`, `manual_evidence`, `kg_evidence`, `recommendation`, `citations_present`, `confidence`, `outcome`.

## Mapping verdicts

- **evidence_graph `explain_cause()` vs `engine.py` Supervisor → DUPLICATION RISK if standalone.** The Supervisor produces a single grounded reply + 1–5 groundedness + a flat evidence packet — *not* ranked for/against hypotheses. So the spine fills a real gap. But building its own grounding / citation-enforcement / UNS-gate / retrieval stack would duplicate `engine.py` + `citation_compliance.py` + `neon_recall`/`manual-rag.ts` + `decision_traces`. **Seam: `explain_cause` consumes `Supervisor.process_full()` → `_evidence_from_parsed` (L1093) + the `decision_traces` row; the for/against ranked card is the net-new output.**
- **Answer card vs existing service → CAN be produced via the existing service; the envelope is half-built.** Populate `ignition_chat.py`'s already-shaped envelope from `_evidence_from_parsed` + `decision_trace.build_trace_row`, and reuse the Hub `mira/ask` `[Cn]` citation pattern. **Do not introduce a parallel card type.** Most-likely-cause + for-vs-against is the one new field.

## The EvidenceGraph node ↔ existing table map (so it's a view, not a store)

| evidence_graph node kind | Existing backing |
|---|---|
| asset / cause / failure_mode | `kg_entities` (+ `component_templates.common_failure_modes`) |
| signal | `tag_entities` / `live_signal_cache` / `tag_evidence` |
| uns_path | the `ltree` columns |
| manual | `knowledge_entries` (+ mig 045 page/section) |
| procedure | `component_templates.troubleshooting_steps` |
| historical_event / corrective_action | `cmms_*` work orders (via `mira-mcp` tools) |
| confidence / approval_status | `kg_relationships.confidence` + `approval_state` |

## Conclusion

**Not a second product conceptually** — the spine reasons over the same UNS/asset/signal/manual world. But it is a **second brain in code** today (standalone, zero `engine.py` imports). Integrate by making `explain_cause` a thin layer that reads the Supervisor's evidence packet + `decision_traces` and emits the ranked for/against card; populate the existing Ignition envelope instead of a new endpoint. The spine's real contribution is the **structured, ranked, contradiction-aware answer card** — a rendering/shaping layer the platform genuinely lacks, on top of grounding the platform already does.
