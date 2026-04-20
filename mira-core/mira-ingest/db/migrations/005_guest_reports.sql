-- mira-core/mira-ingest/db/migrations/005_guest_reports.sql
BEGIN;

CREATE TABLE IF NOT EXISTS guest_reports (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID        NOT NULL,
    asset_tag        TEXT        NOT NULL,
    reporter_name    TEXT,
    reporter_contact TEXT,
    description      TEXT        NOT NULL,
    photo_url        TEXT,
    scan_id          UUID,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_guest_reports_tenant_created
    ON guest_reports (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_guest_reports_tenant_asset
    ON guest_reports (tenant_id, lower(asset_tag));

CREATE INDEX IF NOT EXISTS idx_guest_reports_unack
    ON guest_reports (tenant_id, acknowledged_at)
    WHERE acknowledged_at IS NULL;

COMMIT;
