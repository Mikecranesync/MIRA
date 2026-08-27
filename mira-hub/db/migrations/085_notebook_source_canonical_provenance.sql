-- 085: canonical-evidence provenance for notebook sources (Commodity PRD Phase 2).
--
-- Root cause being repaired (docs/architecture/provenance-investigation-2026-08-26.md):
-- the derived nameplate text's identity was a content-sha over bytes embedding
-- technician-edited fields + nondeterministic vision output, so every
-- edit-and-resubmit minted a NEW doc and a NEW source row for the SAME
-- photograph, and pre-#3421 rows carry origin_file_id IS NULL with no backfill.
--
-- Three parts, all idempotent, one transaction:
--
-- 1. superseded_at — a photo-derived source row replaced by a newer derived
--    reading of the SAME origin photo. Superseded rows are hidden from source
--    lists and excluded from chat scope/retrieval, but RETAINED so historical
--    citations that reference their doc_id can still resolve the canonical
--    origin, and so the repair is auditable and reversible (set NULL to
--    un-supersede). Nothing is deleted.
--
-- 2. origin_file_id backfill — deterministic and provable only: a row whose
--    doc's filename is exactly `nameplate-<uuid>.txt` derives, by construction
--    of the confirm route, from the photo file with that uuid. The origin is
--    set ONLY where that photo file actually exists in the same tenant.
--    Anything else stays NULL (ambiguous data is surfaced, never guessed).
--    source_role is normalized to 'photo' on the same provable rows.
--
-- 3. duplicate collapse — within each (notebook_id, origin_file_id) group of
--    photo-derived rows, the NEWEST row (created_at DESC, doc_id DESC as the
--    deterministic tiebreak) stays visible; older siblings get superseded_at.
--
-- INSPECTION (read-only; run via db-inspect BEFORE apply, and again after):
--   -- candidate rows missing provenance
--   SELECT count(*) FROM equipment_notebook_sources s
--     JOIN hub_uploads u ON u.id = s.doc_id AND u.tenant_id = s.tenant_id::text
--    WHERE s.origin_file_id IS NULL
--      AND u.filename ~ '^nameplate-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.txt$';
--   -- of those, provable (photo exists in-tenant)  → will be backfilled
--   SELECT count(*) FROM equipment_notebook_sources s
--     JOIN hub_uploads u ON u.id = s.doc_id AND u.tenant_id = s.tenant_id::text
--     JOIN namespace_direct_uploads f
--       ON f.id = substring(u.filename FROM '^nameplate-([0-9a-f-]{36})\.txt$')::uuid
--      AND f.tenant_id = s.tenant_id
--    WHERE s.origin_file_id IS NULL;
--   -- duplicate logical-evidence groups that will collapse
--   SELECT notebook_id, origin_file_id, count(*) FROM equipment_notebook_sources
--    WHERE origin_file_id IS NOT NULL AND source_role = 'photo'
--    GROUP BY 1, 2 HAVING count(*) > 1;

BEGIN;

-- (1) supersede marker
ALTER TABLE equipment_notebook_sources
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN equipment_notebook_sources.superseded_at IS
  'Set when a newer derived reading of the same origin_file_id replaced this row (085). Hidden from lists/scope; retained for citation origin resolution + audit. Never deleted by the system.';

-- (2) provable origin backfill. The filename pattern is the confirm route''s
-- own construction (`nameplate-${photoFileId}.txt`); the parsed uuid must
-- resolve to a real same-tenant file or the row is left untouched.
UPDATE equipment_notebook_sources s
   SET origin_file_id = f.id,
       source_role    = COALESCE(s.source_role, 'photo')
  FROM hub_uploads u
  JOIN namespace_direct_uploads f
    ON f.id = substring(u.filename FROM '^nameplate-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.txt$')::uuid
 WHERE u.id = s.doc_id
   AND u.tenant_id = s.tenant_id::text
   AND f.tenant_id = s.tenant_id
   AND s.origin_file_id IS NULL;

-- (3) collapse duplicates: newest visible row per (notebook, origin) wins.
-- Deterministic (created_at DESC, doc_id DESC), idempotent (only fills NULLs,
-- and the winner of a group never gains superseded_at on a re-run because it
-- is still ranked first).
WITH ranked AS (
  SELECT notebook_id, doc_id,
         row_number() OVER (
           PARTITION BY notebook_id, origin_file_id
           ORDER BY created_at DESC, doc_id DESC
         ) AS rn
    FROM equipment_notebook_sources
   WHERE origin_file_id IS NOT NULL
     AND source_role = 'photo'
     AND superseded_at IS NULL
)
UPDATE equipment_notebook_sources s
   SET superseded_at = now()
  FROM ranked r
 WHERE s.notebook_id = r.notebook_id
   AND s.doc_id      = r.doc_id
   AND r.rn > 1
   AND s.superseded_at IS NULL;

COMMIT;
