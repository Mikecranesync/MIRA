-- NeonDB schema: personalized briefing profiles
-- Apply with: psycopg2 or doppler run -p factorylm -c prd -- psql $NEON_DATABASE_URL -f briefing_schema.sql

CREATE TABLE IF NOT EXISTS briefing_profiles (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             TEXT NOT NULL,
    tenant_id           TEXT NOT NULL DEFAULT 'default',
    role                TEXT NOT NULL DEFAULT 'technician'
                            CHECK (role IN ('technician', 'supervisor', 'manager')),
    assigned_assets     TEXT[] NOT NULL DEFAULT '{}',
    shift               TEXT NOT NULL DEFAULT 'day'
                            CHECK (shift IN ('day', 'evening', 'night', 'all')),
    preferred_channel   TEXT NOT NULL DEFAULT 'push'
                            CHECK (preferred_channel IN ('push', 'email', 'telegram', 'slack')),
    preferred_time      TEXT NOT NULL DEFAULT '06:00',
    email               TEXT NOT NULL DEFAULT '',
    language            TEXT NOT NULL DEFAULT 'en',
    include_kpis        BOOLEAN NOT NULL DEFAULT FALSE,
    include_open_wos    BOOLEAN NOT NULL DEFAULT TRUE,
    include_team_activity BOOLEAN NOT NULL DEFAULT FALSE,
    digest_length       TEXT NOT NULL DEFAULT 'short'
                            CHECK (digest_length IN ('short', 'detailed')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, tenant_id)
);

-- Seed: Mike Harper — manager, all shifts, push + email, KPIs enabled
INSERT INTO briefing_profiles (
    user_id, tenant_id, role, assigned_assets, shift,
    preferred_channel, preferred_time, email,
    include_kpis, include_open_wos, include_team_activity, digest_length
) VALUES (
    'mike-harper', 'factorylm', 'manager', '{}', 'all',
    'push', '06:00', 'mike@cranesync.com',
    TRUE, TRUE, TRUE, 'detailed'
) ON CONFLICT (user_id, tenant_id) DO NOTHING;
