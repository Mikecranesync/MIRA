BEGIN;

-- Migration 036: current_tag_state — EXTEND live_signal_cache with freshness.
--
-- Master plan: docs/plans/2026-06-01-mira-master-architecture-plan.md Phase 1
--   + Phase 4. Gap-closure plan: docs/plans/current-state-gap-closure-plan.md
--   §2.3 (Store, current_tag_state row) + §4.2 (Reuse-Before-Build decision).
--
-- WHY A COLUMN-ADD, NOT A NEW TABLE
--   The gap-closure task asks for a `current_tag_state` table: latest value
--   per tag, with freshness + provenance. live_signal_cache (Hub 020) ALREADY
--   IS that table — PRIMARY KEY (tenant_id, plc_tag), last_value_text/numeric/
--   bool, last_seen_at, last_changed_at, prev_value_*, simulated. Creating a
--   parallel current_tag_state would duplicate the latest-value store and
--   split the write path. Per CLAUDE.md "Reuse Before Build", we EXTEND the
--   existing table with the four columns it lacks:
--
--     uns_path        : resolved UNS location (Phase 4 reads freshness by
--                       subtree; live_signal_cache had no UNS column)
--     source_system   : ignition|plc_bridge|relay|simulator (provenance —
--                       never silently mix sources)
--     latest_quality  : good|bad|stale|uncertain (was buried in properties)
--     freshness_status : the Command Center's new "live" semantics
--                        (live|stale|unknown|simulated)
--
--   plc_tag remains the per-tag identifier; latest_event_timestamp maps to
--   the existing last_seen_at; latest_value maps to last_value_*; metadata
--   maps to the existing properties JSONB. No PK change, no data migration.
--
-- FRESHNESS SEMANTICS (Phase 4 owns the computation; this stores the result):
--     live      : last_seen_at within expected_freshness_seconds window
--     stale     : no update beyond the window
--     unknown   : no mapped/approved tags for the asset (set by the reader)
--     simulated : only simulated=true data present
--   expected_freshness_seconds is the per-tag window; NULL falls back to a
--   reader/config default. The Phase-2 ingest upsert sets freshness_status
--   ='live'/'simulated'; a freshness sweep (or read-time compute) flips it to
--   'stale' when the window lapses.
--
-- IDEMPOTENT — ADD COLUMN IF NOT EXISTS only. RLS + grants already on the
--   table from migration 020; unchanged here.

CREATE EXTENSION IF NOT EXISTS ltree;

ALTER TABLE live_signal_cache
    ADD COLUMN IF NOT EXISTS uns_path LTREE;

ALTER TABLE live_signal_cache
    ADD COLUMN IF NOT EXISTS source_system TEXT;

ALTER TABLE live_signal_cache
    ADD COLUMN IF NOT EXISTS latest_quality TEXT;

ALTER TABLE live_signal_cache
    ADD COLUMN IF NOT EXISTS freshness_status TEXT
        DEFAULT 'unknown';

-- Per-tag freshness window. NULL → reader/config default.
ALTER TABLE live_signal_cache
    ADD COLUMN IF NOT EXISTS expected_freshness_seconds INTEGER;

-- Subtree freshness queries ("freshness of every tag under <line>") — what
-- the Command Center tree route will run in Phase 4.
CREATE INDEX IF NOT EXISTS live_signal_cache_uns_path_gist
    ON live_signal_cache USING GIST (uns_path)
    WHERE uns_path IS NOT NULL;

-- "Show me stale tags for this tenant" — the Command Center status sweep.
CREATE INDEX IF NOT EXISTS live_signal_cache_freshness_idx
    ON live_signal_cache (tenant_id, freshness_status);

COMMIT;

-- ─── Rollback ─────────────────────────────────────────────────────────
-- BEGIN;
-- DROP INDEX IF EXISTS live_signal_cache_freshness_idx;
-- DROP INDEX IF EXISTS live_signal_cache_uns_path_gist;
-- ALTER TABLE live_signal_cache
--   DROP COLUMN IF EXISTS expected_freshness_seconds,
--   DROP COLUMN IF EXISTS freshness_status,
--   DROP COLUMN IF EXISTS latest_quality,
--   DROP COLUMN IF EXISTS source_system,
--   DROP COLUMN IF EXISTS uns_path;
-- COMMIT;
