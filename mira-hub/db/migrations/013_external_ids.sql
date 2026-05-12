-- Migration 013: external ID columns on cmms_equipment for i3X interoperability
--
-- MIRA assets need to round-trip with adjacent systems (an existing CMMS,
-- the PLC tag namespace, the SCADA historian, the UNS broker, the ERP
-- spares catalog, the engineering drawing set). Each system has its own
-- identifier for the same physical asset. We store those alongside the
-- canonical MIRA row so we can:
--
--   * dedupe on import (e.g. MaintainX → Atlas sync uses cmms_id)
--   * resolve tags coming off Ignition / SCADA streams to a MIRA asset
--   * surface manufacturer part numbers in work-order parts lists
--   * deep-link from a fault to the original drawing
--
-- All columns are nullable TEXT — empty is the normal state for assets
-- that aren't yet cross-referenced. No indexes here: lookups are
-- read-rare and tenant-scoped, so a full table scan is fine until the
-- sync paths actually drive query traffic. Add indexes in a later
-- migration once we have a real workload to size against.
--
-- CRA-258. Companion application changes:
--   * mira-hub rowToAsset()  → exposes columns on /api/assets/by-tag
--   * mira-hub /m/[tag] page → collapsible "External IDs" section
--   * seed-stardust-racers   → populates demo values for SR-SUMP-001

ALTER TABLE cmms_equipment
  ADD COLUMN IF NOT EXISTS cmms_id                    TEXT,
  ADD COLUMN IF NOT EXISTS plc_tag                    TEXT,
  ADD COLUMN IF NOT EXISTS scada_path                 TEXT,
  ADD COLUMN IF NOT EXISTS manufacturer_part_number   TEXT,
  ADD COLUMN IF NOT EXISTS uns_topic_path             TEXT,
  ADD COLUMN IF NOT EXISTS erp_asset_id               TEXT,
  ADD COLUMN IF NOT EXISTS drawing_reference          TEXT;

-- serial_number already exists on cmms_equipment (see seed-stardust-racers.ts
-- which writes to it). Intentionally NOT re-added here.

-- ─── Rollback notes ───────────────────────────────────────────────────────────
-- ALTER TABLE cmms_equipment
--   DROP COLUMN IF EXISTS cmms_id,
--   DROP COLUMN IF EXISTS plc_tag,
--   DROP COLUMN IF EXISTS scada_path,
--   DROP COLUMN IF EXISTS manufacturer_part_number,
--   DROP COLUMN IF EXISTS uns_topic_path,
--   DROP COLUMN IF EXISTS erp_asset_id,
--   DROP COLUMN IF EXISTS drawing_reference;
