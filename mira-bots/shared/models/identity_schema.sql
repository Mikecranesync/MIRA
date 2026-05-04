-- NeonDB schema: unified cross-platform identity
-- Apply with: doppler run -p factorylm -c prd -- psql $NEON_DATABASE_URL -f identity_schema.sql

CREATE TABLE IF NOT EXISTS mira_users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           TEXT NOT NULL,
    display_name        TEXT NOT NULL DEFAULT '',
    email               TEXT NOT NULL DEFAULT '',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS mira_users_email_tenant
    ON mira_users (tenant_id, email)
    WHERE email <> '';

CREATE TABLE IF NOT EXISTS identity_links (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mira_user_id        UUID NOT NULL REFERENCES mira_users(id) ON DELETE CASCADE,
    platform            TEXT NOT NULL,
    external_user_id    TEXT NOT NULL,
    tenant_id           TEXT NOT NULL,
    linked_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (platform, external_user_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS identity_links_user_idx ON identity_links (mira_user_id);
