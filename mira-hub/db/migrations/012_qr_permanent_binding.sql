-- Migration 012: permanent QR binding for cmms_equipment
--
-- Every asset gets a permanent identity (equipment_number) the moment it's
-- created. The QR code printed on the equipment encodes
--   https://app.factorylm.com/m/{equipment_number}
-- and once bound it never changes — the QR is the asset's lifelong handle.
--
-- This migration only adds the columns and the uniqueness guarantee. The
-- application layer (mira-hub POST /api/assets) is responsible for
-- auto-generating equipment_number on create and stamping qr_generated_at.
--
-- NOTE: mira-bots/shared/integrations/hub_neon.py also INSERTs into
-- cmms_equipment. That path currently assumes the caller supplies
-- equipment_number; the hub-side invariant ("every asset has a tag") is
-- enforced at the hub API only, until that path is updated separately.

-- qr_generated_at: NULL means QR was never generated for this asset (legacy
-- rows pre-dating this migration). Stamped on first generation; never
-- updated thereafter — the binding is permanent.
ALTER TABLE cmms_equipment
  ADD COLUMN IF NOT EXISTS qr_generated_at TIMESTAMPTZ;

-- parent_asset_id: optional pointer to a parent asset for sub-component
-- hierarchy (e.g. a VFD that lives inside a pump skid). Uses the UUID PK as
-- the FK target, not equipment_number — equipment_number isn't unique
-- across tenants, and the UUID is already the canonical row identity.
ALTER TABLE cmms_equipment
  ADD COLUMN IF NOT EXISTS parent_asset_id UUID;

DO $$ BEGIN
  ALTER TABLE cmms_equipment
    ADD CONSTRAINT cmms_equipment_parent_fk
    FOREIGN KEY (parent_asset_id) REFERENCES cmms_equipment(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_cmms_equipment_parent
  ON cmms_equipment (parent_asset_id)
  WHERE parent_asset_id IS NOT NULL;

-- Uniqueness: equipment_number must be unique per tenant when present.
-- Partial index keeps legacy NULL rows out of the constraint until the
-- backfill / generate-on-click flow assigns them a tag.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmms_equipment_number_tenant_unique
  ON cmms_equipment (tenant_id, equipment_number)
  WHERE equipment_number IS NOT NULL;

-- ─── Rollback notes ───────────────────────────────────────────────────────────
-- DROP INDEX IF EXISTS idx_cmms_equipment_number_tenant_unique;
-- DROP INDEX IF EXISTS idx_cmms_equipment_parent;
-- ALTER TABLE cmms_equipment DROP CONSTRAINT IF EXISTS cmms_equipment_parent_fk;
-- ALTER TABLE cmms_equipment DROP COLUMN IF EXISTS parent_asset_id;
-- ALTER TABLE cmms_equipment DROP COLUMN IF EXISTS qr_generated_at;
