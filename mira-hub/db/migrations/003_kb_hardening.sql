-- 003_kb_hardening.sql
-- KB / KG dedup protection, RLS on knowledge_entries, missing indexes.
-- Safe to re-run: all DDL uses IF NOT EXISTS / IF EXISTS guards.
-- Author: data-hardening audit 2026-04-29

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. kg_relationships — add UNIQUE constraint so ON CONFLICT works
-- ─────────────────────────────────────────────────────────────

-- Remove any existing duplicates before adding the constraint
DELETE FROM kg_relationships
WHERE id IN (
    SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY tenant_id, source_id, target_id, relationship_type
                   ORDER BY id
               ) AS rn
        FROM kg_relationships
    ) ranked
    WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kg_rel_dedup
ON kg_relationships(tenant_id, source_id, target_id, relationship_type);

-- ─────────────────────────────────────────────────────────────
-- 2. knowledge_entries — functional UNIQUE index on chunk dedup key
--    (tenant_id, source_url, chunk_index extracted from JSONB metadata)
--    This promotes the app-level chunk_exists() SELECT to a DB guarantee.
-- ─────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_ke_chunk_dedup
ON knowledge_entries(
    tenant_id,
    source_url,
    ((metadata->>'chunk_index')::int)
)
WHERE metadata->>'chunk_index' IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 3. knowledge_entries — enable RLS + tenant isolation policy
--    Note: neondb_owner bypasses RLS by design (Postgres superuser).
--    This policy protects application-layer connections (non-owner roles).
-- ─────────────────────────────────────────────────────────────

ALTER TABLE knowledge_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_entries_tenant ON knowledge_entries;
CREATE POLICY knowledge_entries_tenant ON knowledge_entries
    AS PERMISSIVE FOR ALL
    USING (tenant_id = (current_setting('app.current_tenant_id', TRUE))::uuid);

-- ─────────────────────────────────────────────────────────────
-- 4. Missing indexes on frequently-queried columns
-- ─────────────────────────────────────────────────────────────

-- knowledge_entries — source_type filter (used by analytics queries)
CREATE INDEX IF NOT EXISTS idx_ke_source_type
ON knowledge_entries(source_type);

-- knowledge_entries — created_at for freshness queries / pagination
CREATE INDEX IF NOT EXISTS idx_ke_created_at
ON knowledge_entries(created_at DESC);

-- kg_triples_log — subject + predicate for triple lookups
CREATE INDEX IF NOT EXISTS idx_kg_triples_subject
ON kg_triples_log(tenant_id, subject);

CREATE INDEX IF NOT EXISTS idx_kg_triples_source
ON kg_triples_log(source);

-- ─────────────────────────────────────────────────────────────
-- 5. kg_relationships — add tenant_id index (missing, hurts JOIN perf)
-- ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_kg_rel_tenant
ON kg_relationships(tenant_id);

COMMIT;
