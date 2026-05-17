-- Migration 014: equipment_guest_reports
--
-- Stores issue reports submitted by unauthenticated visitors who scanned a QR
-- code but don't have a hub account. The reporter can optionally leave contact
-- info so the maintenance team can follow up.
--
-- Security model:
--   - INSERT is performed via neondb_owner on the public report endpoint
--     (no session required). The endpoint validates the equipment_number
--     exists and rate-limits by IP hash before inserting.
--   - SELECT is RLS-gated: tenants read their own reports via factorylm_app
--     (same isolation policy as other CMMS tables). The INSERT path bypasses
--     RLS intentionally — it runs as neondb_owner.
--
-- Notification: Telegram notification to the tenant is a follow-up (post-MVP).
-- Reports are queryable on the asset detail page by authenticated users.

CREATE TABLE IF NOT EXISTS equipment_guest_reports (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id     UUID        NOT NULL REFERENCES cmms_equipment(id) ON DELETE CASCADE,
  tenant_id        TEXT        NOT NULL,
  equipment_number TEXT        NOT NULL,
  description      TEXT        NOT NULL CHECK (char_length(description) BETWEEN 1 AND 2000),
  contact_info     TEXT        CHECK (contact_info IS NULL OR char_length(contact_info) <= 200),
  ip_hash          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guest_reports_equipment
  ON equipment_guest_reports (equipment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_guest_reports_ip_rate_limit
  ON equipment_guest_reports (ip_hash, created_at DESC)
  WHERE ip_hash IS NOT NULL;

-- RLS: tenants read only their own reports.
ALTER TABLE equipment_guest_reports ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY tenant_isolation ON equipment_guest_reports
    FOR ALL
    TO factorylm_app
    USING (tenant_id = current_setting('app.tenant_id', true));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT ON equipment_guest_reports TO factorylm_app;

-- ─── Rollback ────────────────────────────────────────────────────────────────
-- REVOKE SELECT ON equipment_guest_reports FROM factorylm_app;
-- DROP TABLE IF EXISTS equipment_guest_reports;
