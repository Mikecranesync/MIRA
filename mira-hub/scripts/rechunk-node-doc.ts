#!/usr/bin/env bun
/**
 * One-off re-chunk of an existing node document through the A2 writer
 * (#4859, authorized 2026-10-27). Modeled on repair-garbled-chunks.ts.
 *
 * DRY RUN by default: loads the canonical file bytes, runs the current
 * writePdfChunksForNode / writeChunkRowsForNode path in memory, prints
 * old vs new chunk counts, and checks that at least one new chunk contains
 * both 'F005' and 'Extend the decel'. It writes ONLY when ALL are true:
 *   NOTEBOOK_RECHUNK_APPLY=1   (the flag the owner flips on purpose)
 *   --apply                    (the explicit intent on the command line)
 *   --doc-id                   (writes are scoped to one document)
 *
 * Usage:
 *   bun run scripts/rechunk-node-doc.ts --tenant-id <uuid> --doc-id <uuid> [--apply]
 *
 * Apply (ONE transaction): DELETE knowledge_entries for that tenant_id +
 * doc_id only, re-insert via writeChunkRowsForNode, COMMIT, then
 * embedPendingNodeChunks. Never calls the orphan-ingest deleter (it drops
 * hub_uploads). Never touches hub_uploads, attachments, or the uploadId.
 *
 * Env required: NEON_DATABASE_URL. Do not run against prod from a code
 * session — Mike applies via BRAVO after a dry run.
 *
 * Fixture:
 *   doc      b28a0960-476c-4485-8482-ca7a35cab80b
 *   node     e57c47cd-49a6-49f8-95a2-1f8cc519bafc
 *   notebook 1417666e-2bd7-4fa4-aff7-6f306252e3f0
 */

import { runRechunkCli } from "@/lib/rechunk-node-doc";

process.exit(
  await runRechunkCli(process.argv, {
    NOTEBOOK_RECHUNK_APPLY: process.env.NOTEBOOK_RECHUNK_APPLY,
    NEON_DATABASE_URL: process.env.NEON_DATABASE_URL,
  }),
);
