-- Migration 006: tenant_invites table
-- Purpose: store deep-link invite tokens for Telegram (and future) onboarding.
-- Tokens are 32-char base64url strings, well within Telegram's 64-char start
-- parameter limit. See docs/superpowers/specs/2026-04-26-mira-multi-tenant-design.md.

CREATE TABLE IF NOT EXISTS tenant_invites (
    token        TEXT PRIMARY KEY,
    tenant_id    TEXT NOT NULL REFERENCES plg_tenants(id),
    email        TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    minted_by    TEXT NOT NULL,
    minted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    consumed_at  TIMESTAMPTZ,
    consumed_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_tenant_invites_unconsumed
    ON tenant_invites (tenant_id)
    WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tenant_invites_email
    ON tenant_invites (tenant_id, email);
