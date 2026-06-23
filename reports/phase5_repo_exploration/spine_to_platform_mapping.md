# Phase 5 — Spine → Platform Mapping

**For every spine component: existing home / partial / missing / duplication risk / recommended integration point.** All grounded to the deep-dive audits (file:line in the area plans). 2026-06-23.

> **Correction carried from the deep dives:** the 4.5 audit said the answer-card "hard" fields were *already stored* in `decision_traces`. **Wrong.** `context_ignored`/`next_check`/`decision_path` are **comment-only** (deferred PRD §11, `WhyMiraThinksThis.tsx:21-22`); a grep finds **zero** columns/code. Only `confidence` is a real column (mig 055). Those fields need a **new `explanation` JSONB column** — see `mira_integration_plan.md`.

| Spine component | Existing home | Verdict | Recommended integration point |
|---|---|---|---|
| **Discovery Recorder** (`/discovery_corpus`) | No platform analog (it's a dev-time interrogation library) | **MISSING — and that's fine** | Keep in the spine/worktree as a dev artifact. Do NOT build a product feature; it's methodology, not runtime. |
| **FactoryModel** (`factory_context`: assets/signals/relationships as Suggestions) | `kg_entities`(asset) + `tag_entities`(signal) + `relationship_proposals`(edges), staged via `ai_suggestions` / `ctx_extractions` | **PARTIAL** | **Emit `ai_suggestions` rows via a new `factory-model-proposals.ts` mirroring `plc-proposals.ts`** (`mira-hub/src/lib/`). Assets→`kg_entity`, signals→`tag_mapping`. Accept path (`suggestion-accept.ts`) needs zero change. (`hub_integration_plan.md`) |
| **Suggestion** (kind/confidence band/status/evidence) | `ai_suggestions` (mig 027) + ADR-0017 status machine | **PARTIAL — enum gap** | Map `confidence` band→FLOAT (high=0.85), `status` via `proposal-transition.ts`. **`needs_review` not in `ai_suggestions.status`** → one CHECK-constraint migration. |
| **UNS draft** (proposed UNS paths) | `ltree` columns; `/contextualization/[id]` + `/knowledge/suggestions` UI | **DIRECT** (data) / **PARTIAL** (the spine's draft isn't persisted) | Persist as part of FactoryModel write; render in the existing contextualization + suggestions UI. No new page. |
| **Cause / ranked hypotheses** (`causality`) | none (the Supervisor emits a single reply, not ranked causes) | **MISSING — genuine net-new** | Realize inside the engine as `explain_cause` (pure post-processor) → new `explanation` JSONB on `decision_traces`. Reply text unchanged. (`mira_integration_plan.md`) |
| **Failure Mode** | `component_templates.common_failure_modes` (per-model JSONB) + `HAS_FAILURE_MODE` edge type | **PARTIAL / no first-class row** | Default: keep embedded in `component_templates`; no `failure_modes` table, no `fault_code` suggestion_type. (`db_migration_plan.md`) |
| **Evidence graph** (`evidence_graph` nodes/edges) | `decision_traces` (`tag_evidence`/`manual_evidence`/`kg_evidence`) + `kg_entities`/`kg_relationships` + `relationship_evidence` | **PARTIAL** | Do **not** persist the graph as its own store. Build it transiently from the same evidence the engine already gathers; the durable record is `decision_traces`. |
| **Answer card** (most-likely-cause + for/against + checks + citations + history + review) | `WhyMiraThinksThis.tsx` skeleton + `decision_traces` + Ignition envelope (empty) | **PARTIAL** | One producer (`explain_cause`) → new `explanation` JSONB → rendered in `WhyMiraThinksThis` AND populating the empty Ignition envelope. **No new "Diagnosis" page.** |
| **MQTT event** (`mqtt_uns`) | `ignition_chat.py` `direct_connection` contract (HTTP); no MQTT subscriber reaches the engine | **PARTIAL — one adapter** | An MQTT subscriber beside `ignition_chat.py` calling `engine.process(uns_source="direct_connection")`. **Defer** (Phase 5 is Hub+MIRA, not transport). |
| **Decision trace** | `decision_traces` (mig 032) + `decision_trace_feedback` (055) | **DIRECT** | Already the per-explanation record; extend with the `explanation` column. |
| **Technician check** (`next_check`) | comment-only deferred field; Ignition envelope `suggested_actions` (empty) | **NEEDS-NEW-FIELD** | `explanation.technician_checks` → render to `suggested_actions` + `WhyMiraThinksThis`. |
| **Manual citation** | `knowledge_entries` + mig 045 anchors; `manual-rag.ts ManualSource`; `decision_traces.manual_evidence` | **DIRECT (storage)** / **PARTIAL (bots-side locator gap)** | Point at `knowledge_entries`; extend `neon_recall.recall_knowledge` to select `page_start`/`section_path`. Retire the synthetic fixture as a runtime source. |
| **Historical event / corrective action** | `cmms_*` work orders via `mira-mcp` (`get_fault_history`, `cmms_complete_work_order`) + `decision_traces` per-asset history | **DIRECT** | Read from `cmms_*`; assemble into `explanation.history`. No new history store. |

## Summary of verdicts

- **DIRECT homes (consume now):** UNS draft (ltree), Decision trace, Manual citation (storage), Historical event.
- **PARTIAL (wire/extend):** FactoryModel, Suggestion (enum), Answer card, MQTT event, evidence graph, Failure Mode.
- **MISSING but net-new value (build inside the platform):** ranked Cause / Answer-card `explanation`, technician checks.
- **MISSING and keep out of product:** Discovery Recorder (dev artifact only).

**The spine's lasting contribution = the ranked, contradiction-aware answer-card SHAPE + determinism/tests.** Everything else has a home; the work is re-homing its I/O and realizing the `explanation` field.
