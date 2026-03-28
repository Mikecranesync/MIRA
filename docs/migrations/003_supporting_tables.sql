-- Migration 003: Supporting tables (ingest tracking + tenants)
-- Status: ALREADY EXISTS in NeonDB (created ad-hoc)
-- Inferred from: mira-core/mira-ingest/db/neon.py

-- Tenant registry
CREATE TABLE IF NOT EXISTS tenants (
    id      TEXT PRIMARY KEY,
    tier    TEXT NOT NULL DEFAULT 'free',
    name    TEXT,
    created_at TIMESTAMP DEFAULT now()
);

-- Per-tier rate limits
CREATE TABLE IF NOT EXISTS tier_limits (
    tier            TEXT PRIMARY KEY,
    daily_requests  INTEGER
);

-- URL discovery queue (populated by discover_manuals.py)
CREATE TABLE IF NOT EXISTS manual_cache (
    id              SERIAL PRIMARY KEY,
    manufacturer    TEXT,
    model           TEXT,
    manual_url      TEXT UNIQUE,
    manual_title    TEXT,
    pdf_stored      BOOLEAN DEFAULT false,
    source          TEXT DEFAULT 'apify',
    confidence      REAL DEFAULT 0.8,
    created_at      TIMESTAMP DEFAULT now()
);

-- Crawled URL tracking
CREATE TABLE IF NOT EXISTS source_fingerprints (
    id              SERIAL PRIMARY KEY,
    url             TEXT NOT NULL,
    source_type     TEXT,
    atoms_created   INTEGER DEFAULT 0,
    created_at      TIMESTAMP DEFAULT now()
);

-- Verified manual registry
CREATE TABLE IF NOT EXISTS manuals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_url        TEXT,
    manufacturer    TEXT,
    model_number    TEXT,
    title           TEXT,
    is_verified     BOOLEAN DEFAULT false,
    access_count    INTEGER DEFAULT 0,
    created_at      TIMESTAMP DEFAULT now()
);
