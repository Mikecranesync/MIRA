-- 079_grant_app_knowledge_entries_update.sql
--
-- NUMBERING: this is 079, not 078, deliberately. 078 is taken TWICE on unmerged
-- branches -- 078_decision_traces_provider_usage.sql (mira-1000/p0003-connected-caller
-- and p0004-implementation-map) and 078_channel_workflow.sql. main's highest is 077.
-- Duplicate prefixes are cosmetic to the runner (schema_migrations keys on the full
-- basename, see .claude/rules/mira-hub-migrations.md 7), but a third 078 is
-- gratuitous ambiguity at integration time, so this takes the next free integer.
-- Fix silently-dark embeddings: every node_attachment chunk stays `embedding IS NULL`
-- forever, so the KB VECTOR ranker is blind and notebook retrieval is BM25-only.
--
-- Root cause: the same missing-GRANT class as 011 (SELECT) and 049 (INSERT), one
-- privilege further along. lib/node-knowledge-ingest.ts::embedPendingNodeChunks runs
-- the trailing embed pass under withTenantContext -- i.e. the limited `factorylm_app`
-- role -- and does:
--     UPDATE knowledge_entries SET embedding = $2::vector WHERE id = $1 AND embedding IS NULL
-- `factorylm_app` held only SELECT + INSERT, so that UPDATE raises
-- 42501 "permission denied for table knowledge_entries".
--
-- Why it was invisible: embedPendingNodeChunks wraps the loop in try/catch and
-- downgrades any failure to a console.warn ("a trailing embed failure must never
-- surface to the upload caller"). That fail-open is correct for a slow/absent
-- embedder, but it also swallows this permission error -- so the upload reports
-- success, the chunks are BM25-live, and the vector lane is permanently dark with no
-- user-visible signal. A silent failure and "not finished yet" look identical.
--
-- Verified against the dev Neon branch 2026-08-21, reproducing the app's exact
-- preamble (SET LOCAL ROLE factorylm_app + set_config app.tenant_id AND
-- app.current_tenant_id, per lib/tenant-context.ts):
--     SELECT ... embedding IS NULL  -> 16 rows        (works: 011 granted SELECT)
--     UPDATE ... SET embedding      -> 42501          (permission denied)
--   information_schema.role_table_grants for grantee 'factorylm_app' on
--   knowledge_entries returned exactly: INSERT, SELECT.
-- Observed impact on dev: two separate real manual uploads (746 + 625 chunks) both
-- landed with count(embedding) = 0 while Ollama was up and returning valid 768-dim
-- vectors for the same model the query path uses.
--
-- Tenant isolation on update is preserved: the RLS policy installed in 011
-- (`knowledge_entries_tenant`, AS PERMISSIVE FOR ALL) has no explicit WITH CHECK, so
-- Postgres reuses its USING expression (tenant_id = app.tenant_id) for both the row
-- selection and the UPDATE WITH CHECK. A caller can only update its own tenant's rows
-- and cannot move a row to another tenant.
--
-- Scope is deliberately UPDATE only -- no DELETE. Nothing in the Hub write path
-- deletes knowledge_entries under the app role.
--
-- Safe to re-run.

BEGIN;

GRANT UPDATE ON knowledge_entries TO factorylm_app;

COMMIT;
