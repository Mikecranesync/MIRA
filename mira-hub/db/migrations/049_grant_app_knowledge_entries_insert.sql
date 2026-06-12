-- 049_grant_app_knowledge_entries_insert.sql
-- Fix folder=brain upload door HTTP 500: "permission denied for table knowledge_entries".
--
-- Root cause: PR #1592 (folder = brain) added lib/node-knowledge-ingest.ts, which
-- INSERTs document chunks into knowledge_entries under withTenantContext — i.e. the
-- limited `factorylm_app` role (so RLS is enforced). But 011_grant_app_kb_access.sql
-- granted that role only SELECT on knowledge_entries, never INSERT. So every
-- node-attachment upload 500s at the chunk INSERT (Postgres aclcheck_error) and no
-- uploaded manual ever becomes citable — the exact upload→retrieval gap the beta
-- release gate (tests/beta/) exists to catch.
--
-- Verified end-to-end 2026-06-09 against the dev Neon branch: real minted-session
-- auth + the real POST /api/namespace/node/<id>/files/ door + unpdf chunking → the
-- INSERT failed with "permission denied for table knowledge_entries". Granting INSERT
-- is the single missing privilege.
--
-- Tenant isolation on insert is preserved: the RLS policy installed in 011
-- (`knowledge_entries_tenant`, AS PERMISSIVE FOR ALL) has no explicit WITH CHECK, so
-- Postgres reuses its USING expression (tenant_id = app.tenant_id) as the INSERT
-- WITH CHECK. A row can only be inserted for the caller's own tenant.
--
-- The chunk id is generated app-side (randomUUID) and content_tsv is a GENERATED
-- column, so no sequence/identity USAGE grant is required.
--
-- Safe to re-run.

BEGIN;

GRANT INSERT ON knowledge_entries TO factorylm_app;

COMMIT;
