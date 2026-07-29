-- Regression fixture for tools/seeds/backfill_oem_crawler_chunks.sql
--
-- Run recipe: see the "Regression fixture" block in that seed's header.
--
-- The seed's selector is narrow ON PURPOSE (source_type + manufacturer, NOT the
-- metadata->>'source' marker, which the shared write library stamps on every
-- crawler-adjacent writer). This fixture is the guard on that narrowness: the
-- negative rows below are exactly the population a marker-keyed selector would
-- have wrongly promoted into the cross-tenant shared pool as verified=true.
--
-- I3 / type-agnosticism: run once with the default (tenant_id uuid) and once with
--   -v tid_type=text
-- The seed must produce IDENTICAL assertion output on both.
--
-- Assertion (expect every row PASS):
--   SELECT * FROM backfill_fixture_assert ORDER BY label;
--
-- == THIS IS A LOCAL TEST FIXTURE, NOT A SEED ================================
-- It DROPs and recreates knowledge_entries against whatever database it is
-- pointed at. It is deliberately kept OUTSIDE tools/seeds/ (see the "Regression
-- fixture" block in the seed's header for why) so that production-capable
-- workflows (apply-seeds.yml, apply-tag-scaling.yml, apply-approved-tags.yml)
-- cannot resolve it by name. It must NEVER be added to any seed-applying
-- workflow, and must never be pointed at a real (dev/staging/prod) database —
-- only a throwaway container like the one in the run recipe above.
--
-- As defence-in-depth against the unsanitized-path-traversal weakness in those
-- workflows (tracked separately — do not fix it here), this fixture refuses to
-- run unless the caller explicitly opts in with
--   -v allow_destructive_fixture=1
-- which no workflow ever passes.

\if :{?allow_destructive_fixture}
\else
\echo ''
\echo '*** REFUSING TO RUN ***'
\echo 'This fixture DROPs and recreates knowledge_entries. It is a local test'
\echo 'fixture, never a seed. If you reached this from a deploy workflow, STOP.'
\echo 'To run it deliberately against a throwaway database:'
\echo '    psql ... -v allow_destructive_fixture=1 -f <this file>'
\echo ''
DO $$ BEGIN RAISE EXCEPTION 'destructive fixture refused: allow_destructive_fixture not set'; END $$;
\quit
\endif

\if :{?tid_type}
\else
  \set tid_type uuid
\endif

\echo === fixture: knowledge_entries.tenant_id column type = :tid_type ===

DROP VIEW  IF EXISTS backfill_fixture_assert;
DROP TABLE IF EXISTS backfill_fixture_expected;
DROP TABLE IF EXISTS knowledge_entries;

-- Minimal shape of docs/migrations/001_knowledge_entries.sql (no pgvector needed —
-- the seed touches neither embedding column).
CREATE TABLE knowledge_entries (
    id             uuid PRIMARY KEY,
    tenant_id      :tid_type NOT NULL,
    source_type    text,
    manufacturer   text,
    model_number   text,
    content        text NOT NULL,
    source_url     text,
    source_page    integer,
    metadata       jsonb,
    is_private     boolean DEFAULT false,
    verified       boolean DEFAULT false,
    chunk_type     text,
    created_at     timestamp DEFAULT now()
);

-- content doubles as the row label the assertion joins on.
INSERT INTO knowledge_entries
    (id, tenant_id, source_type, manufacturer, model_number, content, source_url, metadata, verified)
VALUES
-- ── POSITIVE: a real OEM manual chunk orphaned under the garage tenant → MOVES ──
 (gen_random_uuid(), 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe', 'equipment_manual',
  'Rockwell Automation', 'PowerFlex 525', 'oem manual chunk (moves)',
  'https://oem.example/move.pdf', '{"source":"mira_crawler","chunk_index":0}', false),

-- ── COLLISION: the shared pool already holds (source_url, chunk_index) → STAYS ──
 (gen_random_uuid(), 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe', 'equipment_manual',
  'Rockwell Automation', 'PowerFlex 525', 'garage duplicate (collision-skipped)',
  'https://oem.example/collide.pdf', '{"source":"mira_crawler","chunk_index":0}', false),
 (gen_random_uuid(), '78917b56-f85f-43bb-9a08-1bb98a6cd6c3', 'equipment_manual',
  'Rockwell Automation', 'PowerFlex 525', 'shared original (pre-existing)',
  'https://oem.example/collide.pdf', '{"source":"mira_crawler","chunk_index":0}', true),

-- ── GARAGE-NATIVE: not a crawler row at all → UNTOUCHED ──
 (gen_random_uuid(), 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe', 'machine_memory',
  'Automation Direct', 'GS10', 'cv-101 machine memory (garage native)',
  'https://garage.example/cv101', '{"source":"ignition","chunk_index":0}', false),

-- ── NEGATIVE: all carry metadata.source=mira_crawler under the garage tenant, i.e.
--    exactly what the old marker-keyed selector swept. NONE may move. ──
 (gen_random_uuid(), 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe', 'forum_post',
  '', '', 'reddit forum post (must not move)',
  'https://reddit.example/x', '{"source":"mira_crawler","chunk_index":0}', false),
 (gen_random_uuid(), 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe', 'video_transcript',
  '', '', 'youtube transcript (must not move)',
  'https://youtube.example/x', '{"source":"mira_crawler","chunk_index":0}', false),
 (gen_random_uuid(), 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe', 'patent',
  '', '', 'patent text (must not move)',
  'https://patents.example/x', '{"source":"mira_crawler","chunk_index":0}', false),
 (gen_random_uuid(), 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe', 'knowledge_article',
  '', '', 'playwright knowledge article (must not move)',
  'https://blog.example/x', '{"source":"mira_crawler","chunk_index":0}', false),
 (gen_random_uuid(), 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe', 'curriculum',
  '', '', 'curriculum lesson (must not move)',
  'https://curriculum.example/x', '{"source":"mira_crawler","chunk_index":0}', false),
-- manufacturer is set on PURPOSE: the customer's own equipment photos carry
-- result['make'], so source_type — not manufacturer — is what excludes them.
 (gen_random_uuid(), 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe', 'equipment_photo',
  'Rockwell Automation', 'PowerFlex 525', 'customer equipment photo (must not move)',
  'https://photos.example/x', '{"source":"mira_crawler","chunk_index":0}', false),
-- equipment_manual but no manufacturer: the link-scraped playwright ingest_url path.
 (gen_random_uuid(), 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe', 'equipment_manual',
  '', '', 'link-scraped manual, empty manufacturer (must not move)',
  'https://scrape.example/x', '{"source":"mira_crawler","chunk_index":0}', false),
-- NULL-safety of `manufacturer <> ''`.
 (gen_random_uuid(), 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe', 'equipment_manual',
  NULL, NULL, 'null manufacturer (must not move)',
  'https://nullmfr.example/x', '{"source":"mira_crawler","chunk_index":0}', false);

CREATE TABLE backfill_fixture_expected (
    label             text PRIMARY KEY,
    expected_tenant   text    NOT NULL,
    expected_verified boolean NOT NULL,
    expected_moved    boolean NOT NULL
);

INSERT INTO backfill_fixture_expected VALUES
 ('oem manual chunk (moves)',                            '78917b56-f85f-43bb-9a08-1bb98a6cd6c3', true,  true),
 ('garage duplicate (collision-skipped)',                'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe', false, false),
 ('shared original (pre-existing)',                      '78917b56-f85f-43bb-9a08-1bb98a6cd6c3', true,  false),
 ('cv-101 machine memory (garage native)',               'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe', false, false),
 ('reddit forum post (must not move)',                   'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe', false, false),
 ('youtube transcript (must not move)',                  'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe', false, false),
 ('patent text (must not move)',                         'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe', false, false),
 ('playwright knowledge article (must not move)',        'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe', false, false),
 ('curriculum lesson (must not move)',                   'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe', false, false),
 ('customer equipment photo (must not move)',            'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe', false, false),
 ('link-scraped manual, empty manufacturer (must not move)', 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe', false, false),
 ('null manufacturer (must not move)',                   'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe', false, false);

-- FULL OUTER JOIN so a disappeared row or an unexpected extra row also FAILs.
CREATE VIEW backfill_fixture_assert AS
SELECT coalesce(e.label, k.content)                        AS label,
       e.expected_tenant,
       k.tenant_id::text                                   AS actual_tenant,
       e.expected_verified,
       k.verified                                          AS actual_verified,
       e.expected_moved,
       (k.metadata->>'backfilled_from' IS NOT NULL)        AS actual_moved,
       CASE
         WHEN e.label   IS NULL THEN 'FAIL (unexpected row)'
         WHEN k.content IS NULL THEN 'FAIL (row disappeared)'
         WHEN k.tenant_id::text = e.expected_tenant
          AND k.verified        = e.expected_verified
          AND (k.metadata->>'backfilled_from' IS NOT NULL) = e.expected_moved
              THEN 'PASS'
         ELSE 'FAIL'
       END                                                 AS verdict
  FROM backfill_fixture_expected e
  FULL OUTER JOIN knowledge_entries k ON k.content = e.label;
