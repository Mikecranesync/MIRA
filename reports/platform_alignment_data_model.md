# Platform Alignment — Hub Data Model (Audit Area 1)

**Phase 4.5 audit, read-only. Branch `feat/cappy-northstar-factory`. 2026-06-23.**
**Question:** can the Phase 1 contextual model map directly into existing Hub structures, or does it create parallel tables?

**Verdict in one line:** every spine object has an existing Hub home, but only `Asset` / `Signal` / `UNS path` are DIRECT; `Suggestion` / `Relationship` / `Evidence` are PARTIAL (enum/locator gaps); **`Failure Mode` is MISSING** (no table). Persisting the spine naively would fork 5–6 tables.

## Existing Hub structures (the homes)

| Spine object | Verdict | Existing home (table.column) |
|---|---|---|
| **FactoryModel** (tree container) | PARTIAL | No single "FactoryNode" table. The tree = `kg_entities` (nodes, `uns_path ltree`) + `cmms_equipment.uns_path` + `tag_entities.uns_path`. **HubV3 intake home exists** — `contextualization_projects` (mig 055) — but it's *staging*, not a materialized canonical tree. |
| **FactoryNode** (uns_path, name, level, archetype, udt_type, mes_path, unit) | PARTIAL / DUP-RISK | `kg_entities` (`name`, `entity_type`≈level, `uns_path ltree`, `properties JSONB` for archetype/udt_type/mes_path/unit, `approval_state`). **No first-class `level`/`archetype`/`udt_type`/`unit` columns** — they live in `properties`. |
| **Asset** | **DIRECT** | `cmms_equipment` (`id UUID`, `tenant_id TEXT`, `uns_path ltree` via mig 015). Per-instance components → `installed_component_instances`; per-model → `component_templates`. |
| **Signal** (uns_path, data_type, unit, address) | **DIRECT (two homes → dup-risk)** | Approved: `tag_entities` (mig 025 — `uns_path LTREE`, `data_type`, `units`, `source_address`, `expected_envelope`, `approval_state`). Staged: `ctx_extractions` (mig 055 — `tag_name`, `roles[]`, `uns_path_proposed TEXT`, `i3x_element_id`, `evidence_json`, `confidence`, `status`). |
| **UNS path** | **DIRECT — `ltree`** | `ltree` on `kg_entities` / `cmms_equipment` / `tag_entities` / `installed_component_instances` / `component_templates` (GiST-indexed, migs 010/015). Staging variant is plain TEXT (`ctx_extractions.uns_path_proposed`, `health_scores.scope_path`). Builders: `mira-crawler/ingest/uns.py` — **never hand-format** (`.claude/rules/uns-compliance.md`). |
| **Relationship** (contains / feeds) | PARTIAL — enum mismatch | `kg_relationships.relationship_type` (verified) + `relationship_proposals.relationship_type` (proposed, mig 018, 25-value CHECK). Spine `{contains, feeds}` ≈ `HAS_COMPONENT`/`LOCATED_IN` (contains) + `UPSTREAM_OF`/`DOWNSTREAM_OF`/`POWERED_BY` (feeds) — **needs a mapping, no 1:1**. |
| **Suggestion** (kind, statement, confidence band, approval_needed, evidence[], status) | PARTIAL — enum/band gap | `ai_suggestions` (mig 027) is canonical. **kind**: spine `{entity,signal,relationship,component}` vs Hub `suggestion_type {kg_edge, kg_entity, tag_mapping, component_profile, uns_confirmation, namespace_move}` (no `signal` kind; closest `tag_mapping`). **status**: see approval report. **confidence**: Hub `FLOAT(0-1)` + UI bands (low<0.5/med/high>0.8); spine enum `{high,medium,low,review}` — **no `review` band exists**. |
| **Evidence** (source_file, source_format, locator, detail) | PARTIAL — scattered, 3 homes | `relationship_evidence` (mig 018 — `evidence_type`, `page_or_location`=locator, `excerpt`=detail), `ai_suggestions.extracted_data JSONB` + `source_document_id`/`source_page`, `ctx_extractions.evidence_json`, `component_template_sources.page_numbers`/`excerpt`. **No single canonical Evidence table; `source_format` has no column anywhere.** |
| **Failure Mode** | **MISSING — DUP-RISK** | No `failure_modes` table. Exists only as `component_templates.common_failure_modes JSONB` (per-model, embedded) + the `HAS_FAILURE_MODE` edge type. **No home for a first-class, citable per-asset failure-mode row.** |

## The five biggest duplication risks

1. **FactoryNode → a new `factory_nodes` table** parallels `kg_entities` (which already has `uns_path ltree` + `properties` + `approval_state`). Persist node attrs into `kg_entities.properties`.
2. **Signal → a third signal table.** Signals already have two homes (`tag_entities` approved, `ctx_extractions` staged). The intended flow is `ctx_extractions` → promote → `tag_entities`; wire that, don't add a table.
3. **Suggestion → a new `suggestions` table** splits the single Hub work queue (`ai_suggestions`, the only thing `/proposals` reads).
4. **Evidence → a fourth evidence table.** Evidence is already scattered across 3+ homes with no canonical table — high risk a naive persist picks a new table by default.
5. **Failure Mode → a new `failure_modes` table** — the most likely accidental new table, because it's the one object with no existing home. (Sixth: a free-text relationship-type column outside the 25-value CHECK.)

## Load-bearing facts

- **tenant_id type split is live:** CMMS/equipment family (`cmms_equipment`, `asset_agent_status`, `knowledge_entries`) = **TEXT**; kg/Hub/contextualization family (`kg_entities`, `ai_suggestions`, `tag_entities`, `ctx_*`) = **UUID**. Match the column you join to (`.claude/rules/mira-hub-migrations.md §1`).
- **Two `kg_entities` definitions in-repo:** deployed Hub one (`mira-hub/db/migrations/001`, `tenant_id UUID`, no embedding) vs planned engine one (`docs/migrations/004`, `tenant_id TEXT`, `vector(768)`). Hub one is authoritative (ADR-0013).

## Conclusion

The Phase 1 contextual model **can map into existing Hub structures** — it is *not* a new data domain — but it currently exists as an **in-memory model with no persistence**, so nothing maps yet. The integration is "emit into `ai_suggestions` / `ctx_extractions` / `kg_entities` / `tag_entities` via the existing helpers," not "design new tables." The one genuine schema gap is **Failure Mode** (no home) and the `review` confidence band / `needs_review` queue status (see approval report).
