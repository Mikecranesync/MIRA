BEGIN;

-- Migration 045: protect per-tenant uploads in knowledge_entries (is_private).
--
-- Issue : #1833 (tenant-scope drift on /api/documents)
-- Law   : .claude/rules/knowledge-entries-tenant-scoping.md
-- Prior : #1761 (knowledge_entries is the universal OEM corpus for aggregate
--         views) + #1592 (folder=brain wired per-tenant uploads INTO
--         knowledge_entries under a real UUID tenant_id).
--
-- Why:
--   knowledge_entries is a HYBRID corpus. The shared OEM corpus (~83.5k chunks)
--   is tagged with a legacy non-UUID slug ('mike') and is intentionally
--   universal — every tenant sees it (#1761). But post-#1592, per-tenant
--   uploads also live here, tagged with the owning tenant's UUID. They were
--   inserted with is_private = false (the column default; the ingest write
--   paths never set it), so a universal read (/api/documents) surfaced one
--   tenant's uploaded manual to another — the leak #1833 reports.
--
--   The canonical read filter is `(is_private = false OR tenant_id = $caller)`.
--   For that to actually isolate uploads, existing per-tenant upload rows must
--   carry is_private = true. Going forward the write paths set it (the Hub
--   /api/documents/upload route does so as of #1833; the folder=brain ingest
--   write path is the tracked follow-up — see the law doc's rollout section).
--
-- What this does:
--   Flip is_private = true for every row whose tenant_id is a real UUID tenant.
--   The shared OEM corpus uses a non-UUID slug, so it is untouched and stays
--   universally visible. UUID-tagged rows are, by construction, per-tenant
--   content (uploads + demo-seed docs); marking them private is the safe
--   default — visible to the owning tenant (tenant_id = $caller), hidden from
--   everyone else. No row is made MORE visible by this migration.
--
-- Posture: idempotent (only flips false→true; re-run is a no-op). Reversible:
--   `UPDATE knowledge_entries SET is_private = false WHERE ...` with the same
--   predicate. Apply dev → staging → prod via apply-migrations.yml (dry-run
--   first) per docs/environments.md.

UPDATE knowledge_entries
   SET is_private = true
 WHERE is_private = false
   AND tenant_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

COMMIT;
