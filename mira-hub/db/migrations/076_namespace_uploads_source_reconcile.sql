BEGIN;

-- Migration 076: reconcile namespace_direct_uploads.source drift.
--
-- Migration 027 DECLARES `source TEXT NOT NULL DEFAULT 'user_upload'`, but the
-- deployed table on staging does not have it: the Beta Gate failed on this PR
-- with
--     column "source" of relation "namespace_direct_uploads" does not exist
-- (Postgres 42703) on the upload path.
--
-- Why the declaration and the deployment disagree: 027 is a
-- `CREATE TABLE IF NOT EXISTS`, and the table already existed (the routes had
-- been inserting into it since Phase 2 Slice 1 — 059's header records the same
-- story for the `content` column, which 027 also never defined). When the table
-- is already present the CREATE is skipped WHOLESALE, so every column 027
-- declared that the hand-made table lacked stayed missing while the ledger
-- reported 027 applied. 059 reconciled `content`; `source` was missed because
-- nothing wrote to it — the old upload door omitted it from its INSERT and let
-- the (non-existent) default apply.
--
-- What surfaced it: the canonical Files service (075 / workspace-files.ts) names
-- `source` explicitly in its INSERT so a discovered manual can be told apart
-- from a technician upload — see `source: "nameplate_photo"` on the nameplate
-- recognize route. That is the provenance the spec asks us to preserve, so the
-- right fix is to make the deployed schema match the declared one, not to stop
-- recording provenance.
--
-- Why this is a NEW migration rather than an edit to 075: 075 has already been
-- applied to the persistent staging branch by migration-verify.yml. The ledger
-- keys on filename, so a rewritten 075 would be SKIPPED there and the drift
-- would survive — silently, which is exactly the failure mode
-- .claude/rules/mira-hub-migrations.md §8 exists to prevent. An applied
-- migration is immutable; corrections are additive.
--
-- DEPLOY ORDER: this must be applied BEFORE the Hub image that contains
-- workspace-files.ts reaches an environment, or that environment's upload door
-- 500s. dev → staging → prod via apply-migrations.yml, as usual.
--
-- Idempotent, additive-only, single transaction.

ALTER TABLE namespace_direct_uploads
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'user_upload';

COMMIT;

-- ─── Rollback ────────────────────────────────────────────────────────────────
-- Intentionally none: `source` is declared by 027 and is load-bearing for file
-- provenance. Dropping it would re-open the drift this migration closes.
