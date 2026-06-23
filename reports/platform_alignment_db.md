# Platform Alignment — Database / Schema (Audit Area 7)

**Phase 4.5 audit, read-only. 2026-06-23.**
**Question:** which Phase 0–4 structures already have a DB home, which need schema changes, which should not exist separately?

**Migration head: 056** (`mira-hub/db/migrations/056_contextualization_intake.sql`). Duplicate numeric prefixes (021/025/026/027/032/033/048/055) are **cosmetic — do not renumber** (`.claude/rules/mira-hub-migrations.md §7`).

## Which spine structures already have a home

| Spine structure | Has a home? | Where |
|---|---|---|
| UNS path | ✅ canonical | `ltree` columns on `kg_entities`/`cmms_equipment`/`tag_entities`/`component_templates` (GiST). |
| Asset | ✅ | `cmms_equipment` (`uns_path ltree`). |
| Signal | ✅ (two) | `tag_entities` (approved) + `ctx_extractions` (staged). |
| FactoryModel intake | ✅ (HubV3 staging) | `contextualization_projects` / `ctx_sources` / `ctx_extractions` / `ctx_import_batches` / `ctx_extraction_asset_matches` (migs 055/056). |
| Relationship | ✅ (enum-bounded) | `relationship_proposals` + `relationship_evidence` → `kg_relationships`. |
| Suggestion queue | ✅ | `ai_suggestions` (mig 027). |
| Evidence (per-explanation) | ✅ | `decision_traces` (mig 032 — `uns_path ltree`, `tag_evidence`, `manual_evidence`, `kg_evidence`, `recommendation`, `citations_present`, `confidence`, `outcome`) + `kg_query_traces` (mig 033). |
| Manual citation | ✅ | `knowledge_entries` + mig 045 (`page_start`/`page_end`/`section_path`/`doc_id`). |
| Component / failure-mode catalog (per-model) | ✅ (partial) | `component_templates.common_failure_modes` / `expected_signals` / `troubleshooting_steps` (JSONB, mig 016). |
| Live signal cache | ✅ | `live_signal_cache` + `tag_events` + `current_tag_state` (written by `mira-relay/tag_ingest.py`). |
| Health / readiness | ✅ | `health_scores` (L0–L6, mig 021). |

## Which require schema changes

1. **`needs_review` is absent from `ai_suggestions.status`** (enum: `pending|accepted|rejected|deferred|superseded`, mig 027). The spine emits `needs_review` for inferred components / feeds-relationships / cell layers; today it would flatten to `pending` (ADR-0017). **Add `needs_review` to the CHECK** if those should sit in review on the queue the UI renders.
2. **No `review` confidence band.** Hub confidence is `FLOAT(0-1)`; the spine's `review` band has no representation. Map spine bands → numeric (`high=0.9, medium=0.6, low=0.3`) and treat `review` as `needs_review` status, not a confidence value.
3. **Failure Mode has no first-class table.** Decide: (a) keep it embedded in `component_templates.common_failure_modes` + the `HAS_FAILURE_MODE` edge (no new table), or (b) add a `failure_modes` table if per-asset citable failure-mode rows are needed. **(a) is the no-fork default.**
4. **`source_format` has no column** in any evidence home (minor — fold into `evidence_type` or `extracted_data` JSONB).

## Which should NOT exist separately (no-fork rules)

- **No `factory_nodes` table** → use `kg_entities.properties`.
- **No third signal table** → `ctx_extractions` → promote → `tag_entities`.
- **No `suggestions` table** → `ai_suggestions`.
- **No fourth evidence table** → `decision_traces` (per-explanation) + `relationship_evidence` (per-edge).
- **No `failure_modes` table by default** → `component_templates.common_failure_modes`.

## Conclusion

The DB is **ready for the spine** with **one real schema change** (`needs_review` on `ai_suggestions`) and **one product decision** (whether Failure Mode gets a table). Everything else maps onto migration-056-era tables. Promotion path (offline → staging → prod via `apply-migrations.yml`, dry-run first) per `docs/environments.md`. The spine currently writes to **none** of these — it has no DB layer at all — so this is greenfield integration, not a migration of conflicting data.
