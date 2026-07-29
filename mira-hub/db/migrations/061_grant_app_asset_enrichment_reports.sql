-- 061_grant_app_asset_enrichment_reports.sql
-- Fix HTTP 500 on POST /api/assets/[id]/enrich ("permission denied for table
-- asset_enrichment_reports").
--
-- Root cause: same pattern as the 023 fix. Migration 004 created
-- asset_enrichment_reports with RLS enabled and a tenant_id policy, but never
-- granted SELECT/INSERT/UPDATE on that table to the factorylm_app role.
-- Hub routes run under SET LOCAL ROLE factorylm_app (via withTenantContext),
-- so every query against the table returns a Postgres ACL error before RLS
-- even runs.
--
-- Grant scope per route's actual usage:
--   asset_enrichment_reports  SELECT (getEnrichmentReport), INSERT (upsert
--                              enrichment result), UPDATE (ON CONFLICT clause
--                              in the upsert).
--
-- Safe to re-run.

BEGIN;

GRANT SELECT, INSERT, UPDATE ON asset_enrichment_reports TO factorylm_app;

COMMIT;
