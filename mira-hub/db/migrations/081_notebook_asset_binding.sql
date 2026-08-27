-- Migration 081: bind an equipment notebook to a canonical asset.
--
-- WHY
-- A notebook is where a technician asks about a machine, yet nothing tied it to
-- one. `equipment_notebooks` (073) carries free-text manufacturer/model and an
-- `asset_tag` column that is written, echoed back, and used in ZERO query
-- predicates — a decoy. The chat route passes `unsPath: null` with the comment
-- "notebook nodes are standalone". So the answer, the citation and the turn
-- history all exist without a recorded answer to "which machine was this about".
--
-- This adds that binding, plus the provenance the dogfood spec §8 step 7 asks
-- for ("record how the asset was selected and when it was confirmed").
--
-- NUMBER: 081, the next free integer on main. 078 is double-claimed by two open
-- PRs (#3342, #3300) — a pre-existing collision this migration stays clear of.
-- Duplicate prefixes are cosmetic (.claude/rules/mira-hub-migrations.md §7) but
-- there is no reason to add another.
--
-- WHAT IS DELIBERATELY *NOT* STORED HERE
-- The asset's UNS path is NOT cached on the notebook. A cached path drifts
-- silently the moment the asset is re-pathed, and a stale routing identity is
-- exactly the class of bug ADR-0035 exists to prevent. The notebook stores the
-- key; the path is resolved live. The TURN, by contrast, stores both, because a
-- turn is a point-in-time record of what the answer was actually grounded on —
-- a snapshot, not a cache.
--
-- SELECTED IS NOT CONFIRMED
-- `asset_selected_via` records how the asset arrived (a QR scan is a selection,
-- not a confirmation — stickers get swapped during a rebuild). `asset_confirmed_by`
-- / `_at` are set only by an explicit human confirmation and are derived
-- server-side; a client may never supply them.
--
-- 'nfc' is in the CHECK from the start. An NFC tag is the same URL, NDEF-encoded,
-- carrying identical selected-not-confirmed provenance; adding it later would
-- cost a whole migration to say something we already know. There is deliberately
-- NO GPS value: GPS cannot resolve one machine from its neighbour indoors, and a
-- provenance value that cannot identify an asset would only ever launder a guess.
--
-- SCHEMA NOTES (checked against 073, not assumed)
--   - equipment_notebooks.tenant_id and equipment_notebook_turns.tenant_id are
--     UUID (073:39, :89); the RLS policies compare in-type with no cast
--     (073:113-131), so no policy drop/recreate is needed.
--   - GRANTs are table-level (073:130-132) and therefore already cover new
--     columns. No new GRANT.
--   - No column type changes, no GiST index, so none of the ALTER-ordering
--     hazards in .claude/rules/mira-hub-migrations.md §4 apply.
--
-- Idempotent, additive-only, single transaction.
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_equipment_notebooks_asset_unique;
--   ALTER TABLE equipment_notebooks
--     DROP COLUMN IF EXISTS equipment_entity_id,
--     DROP COLUMN IF EXISTS asset_selected_via,
--     DROP COLUMN IF EXISTS asset_confirmed_by,
--     DROP COLUMN IF EXISTS asset_confirmed_at;
--   ALTER TABLE equipment_notebook_turns
--     DROP COLUMN IF EXISTS equipment_entity_id,
--     DROP COLUMN IF EXISTS asset_uns_path;

BEGIN;

ALTER TABLE equipment_notebooks
  -- Mirrors kg_entities.entity_id, which holds the cmms_equipment row UUID as
  -- text (garage-cv101-kg-bridge.sql:36). TEXT, not UUID: entity_id is TEXT and
  -- a join that casts would throw on any non-UUID entity key.
  ADD COLUMN IF NOT EXISTS equipment_entity_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS asset_selected_via  TEXT NULL,
  ADD COLUMN IF NOT EXISTS asset_confirmed_by  TEXT NULL,
  ADD COLUMN IF NOT EXISTS asset_confirmed_at  TIMESTAMPTZ NULL;

DO $$ BEGIN
  ALTER TABLE equipment_notebooks
    ADD CONSTRAINT equipment_notebooks_asset_selected_via_chk
    CHECK (
      asset_selected_via IS NULL
      OR asset_selected_via IN ('asset_picker','qr','nfc','work_order','nameplate','manual_entry')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- One notebook per asset, per tenant.
--
-- Two notebooks on one conveyor is not a cosmetic duplicate: each mints its own
-- namespace node (equipment-notebooks.ts:117-123) so their corpora are DISJOINT,
-- their turn histories split, and they resolve nondeterministically by
-- last_opened_at DESC. Worse, the kg_entities natural key (064) forces the
-- second one to carry a different display name — which is exactly what makes it
-- invisible in a list. Partial-unique, the same shape as 012:44.
CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_notebooks_asset_unique
  ON equipment_notebooks (tenant_id, equipment_entity_id)
  WHERE equipment_entity_id IS NOT NULL;

-- Per-turn snapshot: what this specific answer was grounded on.
--
-- Stored even when the notebook is later rebound or the asset re-pathed —
-- rewriting history to match current configuration would destroy the audit
-- value. asset_uns_path is TEXT, not ltree: it is a record of a value used, not
-- a tree to query, and TEXT cannot fail to store a path an older ltree label
-- ruleset would reject.
ALTER TABLE equipment_notebook_turns
  ADD COLUMN IF NOT EXISTS equipment_entity_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS asset_uns_path      TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_equipment_notebook_turns_asset
  ON equipment_notebook_turns (tenant_id, equipment_entity_id, created_at DESC)
  WHERE equipment_entity_id IS NOT NULL;

COMMENT ON COLUMN equipment_notebooks.equipment_entity_id IS
  'kg_entities.entity_id of the bound asset (the cmms_equipment UUID as text). The canonical asset key cv_101 is DERIVED, never stored — ADR-0035 amendment 2026-08-23.';
COMMENT ON COLUMN equipment_notebooks.asset_selected_via IS
  'How the asset arrived: asset_picker|qr|nfc|work_order|nameplate|manual_entry. Selection provenance, NOT confirmation.';
COMMENT ON COLUMN equipment_notebooks.asset_confirmed_at IS
  'Set only on explicit human confirmation, server-derived. NULL means selected-but-unconfirmed, which the UI must show as such.';
COMMENT ON COLUMN equipment_notebook_turns.asset_uns_path IS
  'Point-in-time snapshot of the asset UNS path this turn was grounded on. Never backfilled or corrected — it records what was used.';

COMMIT;
