-- dogfood-cv101-identity.sql — make the CV-101 identity decision real.
--
-- Compensating seed for the garage dogfood rig. It does NOT rewrite
-- garage-cv101-kg-bridge.sql (already applied; an applied artifact is
-- immutable) — it repairs the three things that seed left in a state the
-- resolvers cannot use.
--
-- THE IDENTITY DECISION (Mike, 2026-08-23 — plan §2, "Option A"):
--
--   internal key    cmms_equipment.id (UUID)   never printed, never changes
--   human handle    CV-101                     the QR sticker, search, speech
--   signal address  enterprise.home_garage.conveyor_lab.conveyor_1
--   display name    Discharge Conveyor         ADR-0035 §1
--
-- The canonical asset key `cv_101` is **derived**, not stored:
-- slug(equipment_number), already computed in SQL at
-- mira-pipeline/ignition_chat.py:381. This seed therefore NEVER writes
-- kg_entities.entity_id — see the ADR-0035 amendment of 2026-08-23 for the
-- resolver evidence. Writing 'cv_101' there would blank three working
-- surfaces (context/route.ts:66, signal-history/route.ts:43,
-- machine-memory-response.ts:108 → the live-evidence packet) and NOTHING
-- would error: uns_path returns null, the packet returns empty, the card
-- renders blank. tests/test_dogfood_cv101_identity_seed.py pins that.
--
-- WHAT THIS FIXES
--   1. The bridge row is approval_state='proposed' (the column defaults to
--      'proposed' at 029_kg_approval_state.sql:29-30 and the bridge seed omits
--      it). Every KG-grounded reader requires 'verified' — chat/route.ts:400,
--      traversal.ts:432, context-builder.ts:95 — so the conveyor's graph
--      context silently resolves to nothing today.
--   2. properties carries 'equipment_number', which zero readers read. The
--      alias key that IS read is properties->>'asset_tag'
--      (mira-bots/shared/demo_namespace.py:205). Both are set here; the
--      derived canonical key is recorded alongside for display only.
--   3. Both label fields hold a seed changelog string — "Conv_Simple Bench
--      Conveyor (staging probe seed 2026-08-02, PRD #3048 PR 5)" — which is
--      what renders as the machine's name on the QR scan card. TWO explicit
--      UPDATEs are required: kg_entities.name was materialized at INSERT time
--      by the bridge seed (garage-cv101-kg-bridge.sql:37) and no view, trigger
--      or FK propagates a later cmms_equipment.description change.
--
-- DISPLAY NAME: 'Discharge Conveyor', per ADR-0035 §1 and the dogfood spec §8.
-- This is deliberately NOT a new name. The dogfood plan suggested "Garage Bench
-- Conveyor CV-101"; the spec §19 states ADR-0035 is the authority for CV-101
-- identity and that references must follow it "rather than duplicating or
-- casually renaming its values". Renaming here would also collide with the
-- kg_entities natural key in a way that is invisible in the UI (064).
--
-- Idempotent, additive, single transaction, tenant-parameterised.
--   psql "$URL" -v tenant_id="'<uuid>'" -f tools/seeds/dogfood-cv101-identity.sql
-- Staging first, then prod via apply-seeds.yml. Mike owns the prod dispatch.

\set tenant_id_default '''e88bd0e8-8a84-4e30-9803-c0dc6efb07fe'''
\if :{?tenant_id}
\else
\set tenant_id :tenant_id_default
\endif

\set display_name '''Discharge Conveyor'''

BEGIN;

-- psql does NOT interpolate :variables inside dollar-quoted ($$…$$) bodies, so
-- the assertion below cannot read :tenant_id directly. Hand it through a
-- transaction-local GUC instead; SET LOCAL dies with the transaction.
SET LOCAL "mira.seed_tenant" = :tenant_id;

-- 0. Refuse to run against an ambiguous rig.
--
-- Every statement below keys on "the CV-101 row". If a tenant somehow holds two
-- of them, the promotion and the label repair would land on an arbitrary one and
-- the operator would see a green run with half a fix. equipment_number is unique
-- only per tenant (012_qr_permanent_binding.sql:44 — a PARTIAL index, not the
-- global constraint the older probe seed's comment claimed), so this assertion
-- is the guard that makes the singular phrasing true.
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n
    FROM cmms_equipment
   WHERE tenant_id = current_setting('mira.seed_tenant', true)
     AND equipment_number = 'CV-101';
  IF n <> 1 THEN
    RAISE EXCEPTION
      'dogfood-cv101-identity: expected exactly 1 CV-101 row for this tenant, found %. Resolve the duplicate before seeding.', n;
  END IF;
END $$;

-- 1. Promote the ONE bridge row to 'verified', BY entity_id.
--
-- Scoped to the single row the bridge seed created, never a pattern. Promotion
-- from proposed → verified is an explicit, evidenced act (.claude/CLAUDE.md
-- "Knowledge graph proposals"): the evidence here is the operator applying this
-- seed for a rig they physically own, recorded in properties.
UPDATE kg_entities k
   SET approval_state = 'verified',
       updated_at = now()
  FROM cmms_equipment ce
 WHERE k.tenant_id = (:tenant_id)::uuid
   AND k.entity_type = 'equipment'
   AND k.entity_id = ce.id::text
   AND ce.tenant_id = :tenant_id            -- cmms_equipment.tenant_id is TEXT
   AND ce.equipment_number = 'CV-101'
   AND k.approval_state IS DISTINCT FROM 'verified';

-- 2. Add the alias key that is actually read, plus the derived canonical key.
--
-- jsonb || merges, so this preserves the bridge seed's own keys rather than
-- replacing the object. canonical_key is recorded for display/debugging only —
-- it is derived from equipment_number and must never become a lookup target.
UPDATE kg_entities k
   SET properties = coalesce(k.properties, '{}'::jsonb) || jsonb_build_object(
         'asset_tag', 'CV-101',
         'canonical_key', 'cv_101',
         'canonical_key_note', 'derived from equipment_number; NOT a stored identity — see ADR-0035 amendment 2026-08-23',
         'identity_seed', 'dogfood-cv101-identity'
       ),
       updated_at = now()
  FROM cmms_equipment ce
 WHERE k.tenant_id = (:tenant_id)::uuid
   AND k.entity_type = 'equipment'
   AND k.entity_id = ce.id::text
   AND ce.tenant_id = :tenant_id
   AND ce.equipment_number = 'CV-101';

-- 3a. The label the QR scan card renders (rowToAsset falls back to
--     description for `name` — api/assets/by-tag/[tag]/route.ts:11).
UPDATE cmms_equipment
   SET description = :display_name,
       updated_at = now()
 WHERE tenant_id = :tenant_id
   AND equipment_number = 'CV-101'
   AND description IS DISTINCT FROM :display_name;

-- 3b. The label every KG surface renders. Materialised separately at bridge
--     INSERT time, so 3a alone leaves this stale.
--
--     GUARDED against kg_entities_tenant_type_name_key (064): the natural key is
--     (tenant_id, entity_type, name). If a DIFFERENT row in this tenant already
--     holds the display name, this update would raise a unique violation and
--     abort the whole transaction. Skipping instead leaves the rig's old label
--     visible — loud in the UI and safe in the database, which is the right way
--     round for a name.
UPDATE kg_entities k
   SET name = :display_name,
       updated_at = now()
  FROM cmms_equipment ce
 WHERE k.tenant_id = (:tenant_id)::uuid
   AND k.entity_type = 'equipment'
   AND k.entity_id = ce.id::text
   AND ce.tenant_id = :tenant_id
   AND ce.equipment_number = 'CV-101'
   AND k.name IS DISTINCT FROM :display_name
   AND NOT EXISTS (
     SELECT 1 FROM kg_entities other
      WHERE other.tenant_id = (:tenant_id)::uuid
        AND other.entity_type = 'equipment'
        AND other.name = :display_name
        AND other.id <> k.id
   );

COMMIT;

-- Verification (read-only) — run after applying.
\echo === CV-101 identity after seed ===
SELECT ce.equipment_number,
       ce.description        AS cmms_label,
       k.name                AS kg_label,
       k.approval_state,
       k.uns_path::text,
       k.properties->>'asset_tag'     AS alias_key,
       k.properties->>'canonical_key' AS derived_key,
       left(k.entity_id, 8) || '…'    AS entity_id_prefix
  FROM cmms_equipment ce
  LEFT JOIN kg_entities k
    ON k.tenant_id = (:tenant_id)::uuid
   AND k.entity_type = 'equipment'
   AND k.entity_id = ce.id::text
 WHERE ce.tenant_id = :tenant_id
   AND ce.equipment_number = 'CV-101';
