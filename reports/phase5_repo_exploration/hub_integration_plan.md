# Phase 5 — Hub Integration Plan

**Goal:** make the Phase 1 `factory_context.FactoryModel` output appear inside the existing Hub approval workflow — without a new queue, table, or page. Grounded to the contextualization-flow deep dive. 2026-06-23.

## The existing flow we plug into

Two ingestion families converge on the same approval queue + accept→materialize path:

**Family A — Contextualization project (HubV3):**
1. `POST /api/contextualization` → `contextualization_projects` (`route.ts:103`).
2. `POST /api/contextualization/[id]/sources` (multipart) → `ctx_sources`, parse via mira-ingest, `reportToExtractions` → `ctx_extractions` (`sources/route.ts:80`, status `pending`).
   - **OR** `POST /api/contextualization/import` (Intake Contract / bundle) → `importFromContract`/`importFromBundle` → `ctx_*` (`import/route.ts:48`). **Header comment: "P5 migrates the offline client onto the contract."**
3. Per-signal review (`/contextualization/[id]`) flips `ctx_extractions.status='accepted'`.
4. `POST /api/contextualization/batches/[batchId]/review {decision:"approve"}` → `buildEntityInsert(... verified)` writes `kg_entities approval_state='verified'` + keeps the paired `ai_suggestions` row in lockstep via `applyHubProposalTransition` (`review/route.ts:150,188`).

**Family B — Direct PLC connector (the template):**
1. `POST /api/connectors/plc/import` → `handlePlcImport` → mira-ingest parse → `plcReportToSuggestions(report)` (`plc-proposals.ts:66`) → `insertPlcSuggestions` (`:135`) → **`ai_suggestions` directly** (status `pending`).
2. Accept: `decideSuggestion(... "verify")` (`suggestion-accept.ts:155`) → `createKgEntity` (`kg_entities` verified) or `createTagEntity` (`tag_entities` verified, `ON CONFLICT (tenant_id, uns_path)` upsert).

## Recommended integration: mirror Family B (write `ai_suggestions`)

Create **`mira-hub/src/lib/factory-model-proposals.ts`**, a verbatim structural copy of `plc-proposals.ts`:

- **Pure transform** `factoryModelToSuggestions(model): PlcSuggestion[]`:
  - one `kg_entity` per asset (`extracted_data = {entity_type:"equipment", name, uns_path, …}`, mirroring `plc-proposals.ts:108`),
  - one `tag_mapping` per signal (`extracted_data = {tag, uns_path, signal, data_type, …}`, mirroring `:77`),
  - `confidence`: synthesize a constant high band (FactoryModel is deterministic/ground-truth → `0.85`),
  - `proposed_by: "import:factory_model"` (the `import:<format>` convention, mig 027:99),
  - `risk_level`: `"low"` for structural, optionally `"medium"` for inferred items the spine marks `needs_review`.
- **Writer** `insertFactoryModelSuggestions(tenantId, rows)` — a verbatim copy of `insertPlcSuggestions` (`jsonb_to_recordset` multi-row INSERT at `status='pending'`).
- **Route** `POST /api/connectors/simlab/import` (or `/api/factory-model/import`) mirroring `connectors/plc/import/route.ts:19` — `sessionOr401()` → forward to the lib.

**The accept→materialize path needs ZERO changes** — `decideSuggestion` already handles `kg_entity`→`kg_entities` and `tag_mapping`→`tag_entities`. The `/knowledge/suggestions` queue + `/contextualization/[id]` already render them.

### Why `ai_suggestions`, not `ctx_extractions`
- `createKgEntity`/`createTagEntity` read `ai_suggestions.extracted_data` keys (`entity_type/name/uns_path`, `tag/data_type`) — FactoryModel carries exactly these.
- `ctx_extractions` models **signals only** (no equipment entities, no relationships) and forces a project+source+batch scaffold.
- `plc-proposals` is the proven "deterministic parser IR → approval-ready suggestions" template; FactoryModel is the same shape.

*(Secondary path, only if per-signal review + batch publish is wanted: emit a `contextualization-intake/v1` Intake Contract and POST to `/api/contextualization/import` — but it carries signals only, not entities/relationships.)*

## Field coverage

| Spine output | Lands as | Status |
|---|---|---|
| asset | `ai_suggestions(kg_entity)` → `kg_entities` on verify | ✅ direct (template exists) |
| signal | `ai_suggestions(tag_mapping)` → `tag_entities` on verify | ✅ direct |
| UNS path | `extracted_data.uns_path` (→ `kg_entities.uns_path`/`tag_entities.uns_path` ltree) | ✅ direct |
| confidence | synthesized FLOAT (high) | ✅ (synthesize) |
| status | `pending` (queue default) | ✅ |
| **needs_review** | **NOT an `ai_suggestions.status` value today** → use `risk_level='medium'` + one CHECK migration to add `needs_review` | ⚠ migration (see `db_migration_plan.md`) |
| evidence | `extracted_data.evidence` (schema-on-read) | ✅ |
| **relationship (contains/feeds)** | **NO ingestion writer** (Intake Contract drops `proposed_relationships`; `relationship_proposals` needs both entities to exist first) | ❌ **second PR** (post-approval relationship resolver via `upsertInferredProposal`, `proposals-writer.ts:117`, types `LOCATED_IN`/`HAS_SIGNAL`/`OCCURS_ON`) |
| **fault codes / alarms** | no `suggestion_type` | ❌ deferred (ride as `extracted_data` or model as kg fault entities later) |

## UNS-draft rendering (no new page)

- The persisted assets/signals appear in **`/knowledge/suggestions`** (Verify/Reject) and **`/contextualization/[id]`** (per-signal). 
- Wire the **`/namespace` per-node Proposals tab stub** (`namespace/page.tsx:880-887`, counts-only) to a filtered `/knowledge/suggestions` — do not reimplement.

## Sequence

1. **PR-1 (first PR):** `factory-model-proposals.ts` + route + `needs_review` migration → assets + signals flow into the queue and approve. (`phase5_recommended_first_pr.md`)
2. **PR-2:** post-approval relationship resolver (names → entity ids → `upsertInferredProposal`).
3. **PR-3 (MIRA side):** the `explanation` answer-card field (`mira_integration_plan.md`).

This makes the synthetic factory appear in the **one** existing approval UI and become real `kg_entities`/`tag_entities` on human approval — proving the spine's output is FactoryLM data, not a parallel store.
