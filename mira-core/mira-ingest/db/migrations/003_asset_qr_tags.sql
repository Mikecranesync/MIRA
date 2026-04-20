-- mira-core/mira-ingest/db/migrations/003_asset_qr_tags.sql
BEGIN;

CREATE TABLE IF NOT EXISTS asset_qr_tags (
    tenant_id       UUID         NOT NULL,
    asset_tag       TEXT         NOT NULL,
    atlas_asset_id  INTEGER      NOT NULL,
    printed_at      TIMESTAMPTZ,
    print_count     INTEGER      NOT NULL DEFAULT 0,
    first_scan      TIMESTAMPTZ,
    last_scan       TIMESTAMPTZ,
    scan_count      INTEGER      NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, asset_tag)
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_qr_tags_tenant_tag_ci
    ON asset_qr_tags (tenant_id, lower(asset_tag));

CREATE INDEX IF NOT EXISTS idx_qr_tags_tenant_last_scan
    ON asset_qr_tags (tenant_id, last_scan DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS qr_scan_events (
    id             BIGSERIAL    PRIMARY KEY,
    tenant_id      UUID         NOT NULL,
    asset_tag      TEXT         NOT NULL,
    atlas_user_id  INTEGER,
    scanned_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    user_agent     TEXT,
    scan_id        UUID         NOT NULL DEFAULT gen_random_uuid(),
    chat_id        TEXT
);

CREATE INDEX IF NOT EXISTS idx_scan_events_tenant_asset_time
    ON qr_scan_events (tenant_id, asset_tag, scanned_at DESC);

CREATE INDEX IF NOT EXISTS idx_scan_events_tenant_time
    ON qr_scan_events (tenant_id, scanned_at DESC);

CREATE INDEX IF NOT EXISTS idx_scan_events_scan_id
    ON qr_scan_events (scan_id);

COMMIT;
