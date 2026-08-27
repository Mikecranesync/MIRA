BEGIN;

-- Migration 082: reconcile namespace_direct_uploads.node_id nullability drift.
--
-- SYMPTOM (found 2026-08-23, live on BOTH staging and production): every upload
-- through the canonical Files door returns
--     HTTP 500 {"error":"Couldn't save this file."}
-- with or without targets. The workspace-files door — the one that parks bytes,
-- links them, resolves a node, indexes, and writes notebook source membership —
-- could not accept a single file.
--
-- CAUSE. `POST /api/files` parks FIRST and resolves a node afterwards, by
-- design: "the workspace never loses a file it accepted, even if the attach or
-- the indexing below fails" (route.ts). So `parkOrReuseFile` inserts with
-- node_id NULL. Migration 027 declares that column NULLABLE and says so in its
-- own header ("node_id is nullable ON DELETE SET NULL"), but the DEPLOYED table
-- has `node_id ... NOT NULL`, so the INSERT dies on a not-null violation and the
-- route's catch turns it into the generic 500.
--
-- WHY THE DECLARATION AND THE DEPLOYMENT DISAGREE — the same story migrations
-- 059 and 076 already tell about this exact table. 027 is a
-- `CREATE TABLE IF NOT EXISTS` and the table already existed (routes had been
-- inserting into it since Phase 2 Slice 1). When the table is present the CREATE
-- is skipped WHOLESALE, so the hand-made shape survives while the ledger reports
-- 027 applied. 059 reconciled `content`, 076 reconciled `source`; `node_id`'s
-- NOT NULL is the third symptom of that one event, and it stayed hidden because
-- every earlier upload door supplied a node.
--
-- WHY RELAX RATHER THAN MAKE THE ROUTE SUPPLY A NODE. A parked file legitimately
-- has no node: a technician can upload into the workspace and file it later, and
-- 075 moved filing to many-to-many links (`workspace_file_links`), leaving
-- `node_id` as the legacy single-node column that `parkOrReuseFile` itself
-- documents as "kept in sync for backward compat". Forcing a node back into the
-- park step would re-couple parking to filing and re-introduce the failure the
-- park-first design exists to prevent — losing an accepted file.
--
-- Idempotent: DROP NOT NULL on an already-nullable column is a no-op, so this is
-- safe on any environment whose table already matches 027.
--
-- Rollback: none is appropriate. Restoring NOT NULL would re-break the Files
-- door, and the column is nullable in the canonical declaration.

ALTER TABLE namespace_direct_uploads
  ALTER COLUMN node_id DROP NOT NULL;

COMMENT ON COLUMN namespace_direct_uploads.node_id IS
  'Legacy single-node filing column, NULLABLE by design (027). A file is parked before it is filed; real filing lives in workspace_file_links (075). Reconciled by 082 after the deployed NOT NULL broke every POST /api/files with a 500.';

COMMIT;
