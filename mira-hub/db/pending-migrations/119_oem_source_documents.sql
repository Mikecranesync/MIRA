-- 119_oem_source_documents.sql — #6119: a manufacturer manual opens at the cited page.
--
-- PENDING: this file lives in db/pending-migrations/ on purpose. migration-verify.yml
-- applies every file under db/migrations/ to the persistent staging Neon branch on any
-- pull request, drafts included, and a migration file is immutable once applied
-- (.claude/rules/mira-hub-migrations.md §8). It moves to db/migrations/ unchanged only
-- after Mike approves the staging migration; until then it is tested on a disposable
-- Postgres only (src/capabilities/__tests__/oem-source-bytes.integration.test.ts).
--
-- A server-side copy of a PUBLIC manufacturer manual (knowledge_entries.is_private = false
-- with an http(s) source_url), fetched once from an allowlisted vendor host so the Hub's
-- cited-page viewer can draw the page on Android, where a cross-origin PDF cannot open.
--
-- Shared, not tenant-scoped, and no RLS: it only ever holds bytes of publicly downloadable
-- vendor documents, keyed by their URL. The only reader is GET /api/oem-sources/{entryId},
-- which resolves the URL from a non-private knowledge_entries row on the server; nothing a
-- client sends is ever fetched or looked up here. A customer upload never lands in this
-- table (those are is_private = true and served by /api/namespace/files/).
BEGIN;

CREATE TABLE IF NOT EXISTS oem_source_documents (
  url_sha256     TEXT PRIMARY KEY,          -- sha256 (hex) of the exact source_url
  source_url     TEXT NOT NULL UNIQUE,
  status         TEXT NOT NULL CHECK (status IN ('ok', 'fetch_failed', 'host_refused', 'not_pdf', 'too_large')),
  http_status    INT,
  content        BYTEA,                     -- present only when status = 'ok'
  content_sha256 TEXT,                      -- sha256 of content; the recall key
  content_type   TEXT,
  byte_length    BIGINT,
  page_count     INT,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  retry_after    TIMESTAMPTZ,               -- negative-cache window for a failure
  CONSTRAINT oem_source_documents_ok_has_bytes CHECK ((status = 'ok') = (content IS NOT NULL))
);

GRANT SELECT, INSERT, UPDATE ON oem_source_documents TO factorylm_app;

COMMIT;
