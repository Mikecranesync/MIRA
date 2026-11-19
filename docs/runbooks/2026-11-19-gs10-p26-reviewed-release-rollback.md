# GS10 page 26 reviewed release: disable, re-index and rollback

Scope: the owner-approved table release for GS10 page 26 (PR #5646, pilot #5232) on the two
approved files (SHA-256 `090aa1b3…dc5e4` and `90fa490a…1fab`). Every step below that touches
staging or production is the owner's decision; nothing here is automatic.

## How the release works (what each step relies on)

- The approval lives in `mira-hub/src/capabilities/table-rule-pins.json`: the page 26 pin of each
  approved file carries `reviewed` (the rows digest `d570e81e…91d5`) and `release`. Only
  `"release": "enabled"` releases; anything else (`"disabled"`, missing, malformed) does not.
- Indexing under an enabled approval stamps each released row with
  `metadata.table_reviewed` + `metadata.table_reviewed_sha` (file SHA). Indexing the approved page
  while the approval is NOT enabled marks every row of that page with `metadata.table_held` +
  `metadata.table_held_sha`.
- Every Hub answer query carries `activeReleaseSql()`: a stamped or held row is served only while
  its exact (file SHA, page, digest) approval is enabled in the deployed pin file. Routes covered:
  node document chat (all lanes), the manual library, model-specific chat and its cited-page
  read, the safety chapter, the work-packet document text, and asset enrichment (vector + text).
- Python readers (bot recall, ingest recall, PM extraction, the Open WebUI part lookup) cannot read
  the pin file, so they never serve a stamped or held row, enabled or not.
- Rows are never deleted or rewritten by disabling: the text and the stamp stay as the historical
  record.

## 1. Disable the approval (the supported rollback, no data change)

1. Set `"release": "disabled"` on the page 26 pin of the file(s) to withdraw. Keep `reviewed`.
2. Deploy the Hub through the normal promotion path (staging first).
3. Verify, per tenant that holds an approved upload:
   - Model-specific chat for GS11N-20P2 input current no longer cites page 26 / 5.1 A.
   - Document chat on that upload returns no page 26 table line.
   - The record of what is withdrawn is still queryable (read-only):

     ```sql
     SELECT k.doc_id::text, count(*) FILTER (WHERE k.metadata ? 'table_reviewed') AS stamped,
            count(*) FILTER (WHERE k.metadata ? 'table_held') AS held
       FROM knowledge_entries k
      WHERE k.source_type = 'node_attachment' AND k.tenant_id = '<tenant uuid>'::uuid
        AND (k.metadata ? 'table_reviewed' OR k.metadata ? 'table_held')
      GROUP BY 1;
     ```

Re-enable by setting `"release": "enabled"` and deploying. Stamped rows answer again at once.

## 2. Re-index coordination

- **In-flight writers of the previous build.** A worker that is still running the previous build
  may commit stamped rows after the switch is off. They are inert: the guard admits a stamp only
  while its approval is enabled. No drain is needed for disable.
- **Indexing while disabled.** A fresh upload or reprocess of an approved file while disabled
  writes held rows. They answer nowhere while disabled. When the approval is enabled again they are
  served as ordinary unreviewed document text (as on main), never as a model release; a forced
  reprocess under the enabled build releases them.
- **Rollout (enable for rows stored before this build).** An ordinary reprocess is a no-op at the
  same extraction version. Force a scoped reprocess of each upload that owns chunks of an approved
  file: `npx tsx scripts/reprocess-node-doc.ts --tenant-id <uuid> --doc-id <upload uuid> --force`,
  dry run first, then `--apply` with `NODE_DOC_REPROCESS=1`. An upload whose bytes are gone is
  refused `no_bytes` and stays withheld (the safe direction).

## 3. Retiring the read check (a full revert of PR #5646)

A build without `activeReleaseSql()` would serve stamped rows as released. So it may ship only
after the fence reads zero:

1. Disable the approval (step 1) and deploy.
2. Drain node-document ingest still running the previous build (no reprocess or upload job of the
   old build in flight), so no new stamped row can land.
3. Force-reprocess every upload the query below lists, under the disabled build. Its page 26 rows
   are rewritten as held rows.
4. Fence: this must return zero for every tenant before the revert deploys.

   ```sql
   SELECT count(*) FROM knowledge_entries k
    WHERE k.source_type = 'node_attachment' AND k.metadata->>'table_reviewed' IS NOT NULL;
   ```

An upload refused `no_bytes` keeps its stamps, so the fence stays closed and the revert must not
ship until that upload is removed by the owner or re-uploaded. After a full revert, held rows are
served as main serves any withheld page: unreviewed document text, never a model-scoped release.

## Evidence

`mira-hub/src/lib/__tests__/gs10-p26-reviewed-rollout.integration.test.ts` (real disposable
Postgres) covers each step: disable/enable without reprocess, per-file withdrawal, withdrawal with
no original file and the closed fence, rollout by forced reprocess, the late writer of the previous
build, and indexing while disabled. Python exclusions:
`mira-bots/tests/test_recall_excludes_hub_released_rows.py` and
`mira-core/mira-ingest/tests/test_recall_excludes_hub_rows.py`.
