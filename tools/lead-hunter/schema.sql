-- MIRA Lead Hunter — NeonDB schema
-- Apply: doppler run --project factorylm --config prd -- psql $NEON_DATABASE_URL -f tools/lead-hunter/schema.sql

CREATE TABLE IF NOT EXISTS prospect_facilities (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    address         TEXT,
    city            TEXT,
    state           TEXT DEFAULT 'FL',
    zip             TEXT,
    phone           TEXT,
    website         TEXT,
    category        TEXT,
    rating          FLOAT,
    review_count    INT,
    distance_miles  FLOAT,
    icp_score       INT DEFAULT 0,
    status          TEXT DEFAULT 'discovered',
    notes           TEXT,
    discovered_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(name, city)
);

CREATE TABLE IF NOT EXISTS prospect_contacts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id     UUID REFERENCES prospect_facilities(id) ON DELETE CASCADE,
    name            TEXT,
    title           TEXT,
    email           TEXT,
    phone           TEXT,
    linkedin_url    TEXT,
    source          TEXT,
    confidence      TEXT DEFAULT 'low',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure UNIQUE constraint exists even if table was created without it
CREATE UNIQUE INDEX IF NOT EXISTS idx_prospects_name_city ON prospect_facilities(name, city);

CREATE INDEX IF NOT EXISTS idx_prospects_city      ON prospect_facilities(city);
CREATE INDEX IF NOT EXISTS idx_prospects_icp_score ON prospect_facilities(icp_score DESC);
CREATE INDEX IF NOT EXISTS idx_prospects_status    ON prospect_facilities(status);
CREATE INDEX IF NOT EXISTS idx_contacts_facility   ON prospect_contacts(facility_id);
