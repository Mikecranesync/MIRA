-- Migration 011: intent_signals
-- Stores buying-intent + pain signals harvested from Reddit/YouTube/LinkedIn
-- by the mira-crawler intent monitor pipeline. See docs/specs/intent-monitor-spec.md.

CREATE TABLE IF NOT EXISTS intent_signals (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    source TEXT NOT NULL,
    platform_id TEXT NOT NULL,
    author TEXT,
    author_profile_url TEXT,
    company TEXT,
    url TEXT NOT NULL,
    title TEXT,
    content TEXT,
    intent_score INTEGER,
    intent_category TEXT,
    suggested_reply TEXT,
    status TEXT DEFAULT 'new',
    hubspot_contact_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    contacted_at TIMESTAMPTZ,
    UNIQUE (source, platform_id)
);

CREATE INDEX IF NOT EXISTS idx_intent_signals_created_at
    ON intent_signals (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_intent_signals_status
    ON intent_signals (status);

CREATE INDEX IF NOT EXISTS idx_intent_signals_score
    ON intent_signals (intent_score DESC);

CREATE INDEX IF NOT EXISTS idx_intent_signals_source_created
    ON intent_signals (source, created_at DESC);
