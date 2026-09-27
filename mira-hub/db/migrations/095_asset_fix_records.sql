-- Migration 095: asset_fix_records — technician-confirmed resolutions ("plant memory").
--
-- WHY
-- A technician who fixes a machine knows something MIRA doesn't have anywhere
-- else: what actually worked, for this symptom, on this asset. Today that
-- knowledge lives only in the technician's head (or a chat turn nobody
-- revisits). This table gives it a durable home so the NEXT technician who
-- hits the same symptom on the same machine sees "recorded fix" as a
-- grounding source, per docs/architecture/materialized-evidence.md's
-- Materialized Evidence / Approved Context split:
--   - a technician's explicit confirmation IS the approval act (rule 9 —
--     "never self-promote model output to trusted truth" does not apply here
--     because this row is never model output; it is a human-typed record of
--     what a human did),
--   - but it is still evidence, not doctrine: it is scoped to the notebook it
--     was recorded on, cited as "Recorded fix" (never presented as a manual
--     citation), and it is NEVER auto-promoted into kg_relationships or any
--     other canonical KG structure. Promotion, if it ever happens, is a
--     separate admin/KG action per ADR-0017 — this table is not that queue.
--
-- APPEND-ONLY BY DESIGN. GRANT is SELECT, INSERT only — no UPDATE, no DELETE.
-- A recorded fix is a point-in-time record of what a technician did and
-- reported; correcting the record is a NEW row (a later, better fix
-- supersedes by recency — see the query order in fix-records.ts), never an
-- edit of history. This mirrors equipment_notebook_turns' append-only turn
-- snapshot posture (073/081).
--
-- Tenant family: UUID (kg/Hub family — .claude/rules/mira-hub-migrations.md §1).
-- Only UUID tenants can authenticate (session.ts 401s non-UUID tid), so UUID is
-- both correct and reachable — same posture as 073.
--
-- equipment_entity_id is TEXT, NOT UUID: it mirrors
-- equipment_notebooks.equipment_entity_id (081), which stores
-- kg_entities.entity_id — the cmms_equipment row UUID AS TEXT. A UUID column
-- here would force a cast that throws the moment a non-UUID entity key shows
-- up (same reasoning as 081's header). NULL is legitimate: a notebook can
-- record a fix before (or without) an asset binding.
--
-- notebook_id has NO hard FK to equipment_notebooks(id) — same deliberate
-- posture as node_id/doc_id in 073 (runtime-created table precedent); the app
-- validates ownership before insert (fix-records.ts / the fixes route).
-- source_turn_id has NO hard FK to equipment_notebook_turns(id) either, for
-- the same reason, and is nullable: not every recorded fix originates from a
-- chat turn.
--
-- RLS: in-type UUID comparison (current_setting(...)::uuid), both
-- app.tenant_id and app.current_tenant_id honored — identical shape to 073.
-- GRANT to factorylm_app in this migration (rule §3 — a new table without the
-- grant 403s before RLS runs).
--
-- Idempotent, additive-only, single transaction. Applied via migration-verify
-- (staging) / apply-migrations.yml (prod) only.
-- Rollback: DROP TABLE IF EXISTS asset_fix_records;

BEGIN;

CREATE TABLE IF NOT EXISTS asset_fix_records (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  notebook_id         UUID NOT NULL,
  -- kg_entities.entity_id (cmms_equipment UUID as text) — see header. NULL
  -- when the notebook has no canonical asset binding at record time.
  equipment_entity_id TEXT NULL,
  symptom             TEXT NOT NULL,
  fault_code          TEXT NULL,
  fix                 TEXT NOT NULL,
  -- hub_users identity of the technician who recorded the fix (session
  -- userId, per the app-layer convention already used for
  -- equipment_notebook_sources.added_by / equipment_notebooks.asset_confirmed_by).
  recorded_by         TEXT NULL,
  -- equipment_notebook_turns.id this fix was recorded from, when applicable.
  source_turn_id      UUID NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT asset_fix_records_symptom_len_chk
    CHECK (char_length(symptom) <= 500),
  CONSTRAINT asset_fix_records_fix_len_chk
    CHECK (char_length(fix) <= 2000),
  CONSTRAINT asset_fix_records_fault_code_len_chk
    CHECK (fault_code IS NULL OR char_length(fault_code) <= 64)
);

CREATE INDEX IF NOT EXISTS idx_asset_fix_records_notebook
  ON asset_fix_records (tenant_id, notebook_id, created_at DESC);

-- RLS (UUID family — in-type cast; both setting names honored, per 073)
ALTER TABLE asset_fix_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asset_fix_records_tenant_isolation ON asset_fix_records;
CREATE POLICY asset_fix_records_tenant_isolation ON asset_fix_records
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR tenant_id = current_setting('app.current_tenant_id', true)::uuid
  );

-- Append-only: SELECT + INSERT only. No UPDATE, no DELETE — see header.
GRANT SELECT, INSERT ON asset_fix_records TO factorylm_app;

COMMIT;
