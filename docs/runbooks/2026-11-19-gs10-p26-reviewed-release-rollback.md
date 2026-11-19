# GS10 page 26 reviewed release: deploy order, disable, re-index and rollback

Scope: the owner-approved table release for GS10 page 26 (PR #5646, pilot #5232) on the two
approved files (SHA-256 `090aa1b3…dc5e4` and `90fa490a…1fab`). Every step below that touches
staging or production is the owner's decision; nothing here is automatic.

**The supported rollback is the switch** (step 1). It needs no data change, no reprocess and no
original file. A code rollback must keep the reader filters (step 3).

## How the release works (what each step relies on)

- The approval lives in `mira-hub/src/capabilities/table-rule-pins.json`: the page 26 pin of each
  approved file carries `reviewed` (the rows digest `d570e81e…91d5`), `models` (the catalog numbers
  the page prints: GS11N-20P2, GS11N-20P5, GS11N-21P0, GS11N-22P0, GS11N-23P0) and `release`. Only
  `"release": "enabled"` releases; anything else (`"disabled"`, missing, malformed) does not.
- **Writer.** Every PDF row the Hub node writer stores carries `metadata.file_sha256`, the SHA-256
  of the bytes it was read from. Every row of an approved file's page 26 is marked, in **either**
  switch state and **whatever** the page's extraction reads now (drifted values, an unrecognised
  table, an unreadable layout, a repaired page): rows released under the exact reviewed digest
  carry `metadata.table_reviewed` + `table_reviewed_sha`, every other row of the page carries
  `metadata.table_held` + `table_held_sha`. Release still needs the exact reviewed rows.
- **Hub readers.** Every Hub answer query carries `activeReleaseSql()`. A marked row answers only
  while its exact (file SHA, page, digest) approval is enabled. While an approval of page 26 is
  disabled, these are withheld as well:
  - any row whose `file_sha256` and page are that approval's file and page;
  - a row stored before this build (a node attachment with no mark and no file hash) on page 26 of
    a document whose own page 26 names one of the page's catalog numbers.
  Routes covered: node document chat (all lanes), the manual library, model-specific chat and its
  cited-page read, the safety chapter, the work-packet document text, asset enrichment (vector and
  text) and a saved enrichment report, whose stored passages are re-checked on every fetch. A
  second check inside model-specific chat (`admit()`) drops released rows only.
- **Python readers** (bot recall, ingest recall, PM extraction, the Open WebUI part lookup) cannot
  read the pin file, so they never serve a row of an approved page in either switch state: marked,
  identified by file hash, or recognised by page (`mira-bots/shared/hub_release.py`, copied into
  `mira-core/mira-ingest/db/neon.py` and `tools/owui_tools/lookup_part.py`, pinned equal by test).
  Bots therefore never cite page 26 of an approved GS10 node upload; the Hub alone serves it.
- **Costs of recognising old rows by page.** A row stored before this build carries no file
  identity, so while either approval of page 26 is disabled the Hub withholds page 26 of every such
  node upload whose page 26 names those catalog numbers, including the other approved file's old
  rows and any other GS10 revision with that table on page 26. Rows of other pages and documents
  are untouched.
- **Out of scope.** The shared OEM corpus and every non-node ingest path never carried this
  approval and are unchanged. Conversation history that already contains an earlier answer is not
  rewritten. The crawler's blog and component-template tasks read only the shared tenant and run on
  queues no production worker consumes (`docker-compose.saas.yml`).
- Rows are never deleted or rewritten by disabling: the text and the marks stay as the historical
  record.

## 0. Deploy order: every reader before any release-enabled write

The exclusions live in each reader's own image. A reader still on an earlier image serves page 26
of an approved upload as ordinary text, and keeps doing so after the switch is off. So no build
that can write released rows (the Hub with an enabled pin) may run until every reader sharing the
database runs this change.

1. **Readers first.** Dispatch `deploy-vps.yml` at the release SHA with
   `services="mira-pipeline mira-bot-telegram mira-bot-slack mira-ask mira-ingest"` (staging first).
   The production default (`mira-hub mira-web mira-ask`) does NOT cover them. Confirm in the run
   summary that the image identity of every named service is the release SHA.
2. **Open WebUI tools.** Production has no Open WebUI (`docker-compose.saas.yml`). Wherever one
   runs, reinstall `tools/owui_tools/lookup_part.py` from the release before step 3.
3. **Then the Hub.** Deploy `mira-hub` at the same SHA. Uploads of an approved file are released
   from then on.
4. **Rollout of rows stored before this build** (they stay withheld, never released, until
   re-written): force a scoped reprocess of each upload the inventory lists,
   `npx tsx scripts/reprocess-node-doc.ts --tenant-id <uuid> --doc-id <upload uuid> --force`, dry
   run first, then `--apply` with `NODE_DOC_REPROCESS=1`. An upload whose bytes are gone is refused
   `no_bytes` and stays withheld (the safe direction). The inventory matches the hash on the upload
   row or on its parked file, and lists only uploads that own node chunks, so a duplicate record
   with no chunks is never indexed by the forced pass:

   ```sql
   -- runbook: rollout-inventory
   SELECT u.tenant_id, u.id::text AS upload_id
     FROM hub_uploads u
     LEFT JOIN namespace_direct_uploads d ON d.upload_id = u.id AND d.tenant_id::text = u.tenant_id
    WHERE (u.content_sha256 IN ('090aa1b36250be11e1da33526a4b995492593c6fc35aa82ad18115e411dcc5e4', '90fa490a572558d799c8e8a53ba5f074f36182330c636015a473fd0e43bd1fab')
           OR d.content_sha256 IN ('090aa1b36250be11e1da33526a4b995492593c6fc35aa82ad18115e411dcc5e4', '90fa490a572558d799c8e8a53ba5f074f36182330c636015a473fd0e43bd1fab'))
      AND EXISTS (SELECT 1 FROM knowledge_entries k
                   WHERE k.doc_id = u.id AND k.tenant_id::text = u.tenant_id
                     AND k.source_type = 'node_attachment' AND k.ingest_route = 'v2')
    GROUP BY u.tenant_id, u.id
    ORDER BY u.tenant_id, u.id;
   ```

## 1. Disable the approval (the supported rollback, no data change)

1. Set `"release": "disabled"` on the page 26 pin of the file(s) to withdraw. Keep `reviewed` and
   `models`.
2. Deploy `mira-hub` through the normal promotion path (staging first). The Python readers need no
   change: they never serve these rows.
3. Verify, for each tenant the inventory below lists: model-specific chat for GS11N-20P2 input
   current no longer cites page 26 or 5.1 A, and document chat on that upload returns no page 26
   line. The inventory is the record of what the switch now withholds, grouped by tenant and upload
   and by how each row is recognised (read-only):

   ```sql
   -- runbook: bound-rows
   SELECT k.tenant_id::text AS tenant_id, k.doc_id::text AS upload_id,
          CASE WHEN k.metadata->>'table_reviewed' IS NOT NULL THEN 'released'
               WHEN k.metadata->>'table_held' IS NOT NULL THEN 'held'
               WHEN k.metadata->>'file_sha256' IS NOT NULL THEN 'file'
               ELSE 'before-this-build' END AS bound_by,
          count(*)::int AS rows
     FROM knowledge_entries k
    WHERE k.metadata->>'table_reviewed' IS NOT NULL
       OR k.metadata->>'table_held' IS NOT NULL
       OR (k.metadata->>'file_sha256', COALESCE(k.page_start, k.source_page, 0)::text) IN
          (('090aa1b36250be11e1da33526a4b995492593c6fc35aa82ad18115e411dcc5e4', '26'),
           ('90fa490a572558d799c8e8a53ba5f074f36182330c636015a473fd0e43bd1fab', '26'))
       OR (k.source_type = 'node_attachment' AND k.metadata->>'file_sha256' IS NULL
           AND COALESCE(k.page_start, k.source_page, 0) = 26
           AND EXISTS (SELECT 1 FROM knowledge_entries s
                        WHERE s.tenant_id = k.tenant_id AND s.doc_id = k.doc_id
                          AND s.source_type = 'node_attachment'
                          AND COALESCE(s.page_start, s.source_page) = 26
                          AND (strpos(s.content, 'GS11N-20P2') > 0 OR strpos(s.content, 'GS11N-20P5') > 0
                               OR strpos(s.content, 'GS11N-21P0') > 0 OR strpos(s.content, 'GS11N-22P0') > 0
                               OR strpos(s.content, 'GS11N-23P0') > 0)))
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3;
   ```

Re-enable by setting `"release": "enabled"` and deploying `mira-hub`. Released rows answer again at
once; rows held under an enabled approval answer as ordinary withheld text, never as a release.

## 2. Re-index coordination

- **In-flight writers.** A worker still running the previous build may commit rows after the
  switch is off. A writer of this build marks them, and a writer of the merge-base build stores rows
  the readers recognise by page; either way they are withheld while the approval is disabled. No
  drain is needed for disable.
- **Indexing while disabled.** A fresh upload or reprocess of an approved file while disabled
  stores every page 26 row held, so it answers nowhere while disabled. After re-enabling, a forced
  reprocess under the enabled build releases it.
- **Drift.** A page whose extraction no longer reads exactly as reviewed is not released, but its
  rows are still bound to the approval, so the switch withdraws them too.

## 3. Code rollback keeps the reader filters

The switch is the rollback. A build that reverts this change must keep `activeReleaseSql()` on every
Hub answer query and the exclusions in every Python reader. A reader without them serves every row
the inventory above lists (released, held, identified by file hash or recognised by page) as
ordinary document text, after the approval was withdrawn.

The filters may be retired only when `bound-rows` returns no row for any tenant. Re-indexing cannot
get there: this writer marks page 26 again, and a writer without the marks stores rows the
inventory still recognises by page. It reaches zero only after the owner deletes the uploads it
lists, so in practice the filters stay as long as an approved GS10 file is indexed.

## Evidence

`mira-hub/src/lib/__tests__/gs10-p26-reviewed-rollout.integration.test.ts` (real disposable
Postgres) runs both SQL blocks above, read from this file, and covers each step: disable and
enable without reprocess, per-file withdrawal, withdrawal of rows the merge-base writer stored
(captured in `gs10-p26-base-writer-rows.json`) including a late base-build write after the switch
is off, drifted and unreadable page 26 re-indexed while disabled, a saved enrichment report,
withdrawal with no original file, rollout by forced reprocess, the inventories, and the fence:
non-zero for each kind of bound row, and those rows served by a reader without the filter. Python
exclusions: `mira-bots/tests/test_recall_excludes_hub_released_rows.py` and
`mira-core/mira-ingest/tests/test_recall_excludes_hub_rows.py`.
