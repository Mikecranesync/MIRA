#!/usr/bin/env node
/**
 * Reprocess ONE already-stored node document through the current extraction
 * (garage pilot PR-6, plan row 16-A): re-parse it with the upload's own parse
 * (table rows, printed page labels, garble repair, unmapped-glyph flag), swap
 * its knowledge_entries chunks in one transaction, await the embed pass, and
 * record the new chunk count. Idempotent on `metadata.extraction_version`:
 * a document whose chunks all carry the current stamp is left alone unless
 * `--force` (reason `recomputed_human_requested`).
 *
 * The upload bytes are NOT kept after parsing, so they come from:
 *   --pdf <path>   a local copy, used ONLY when its sha256 equals
 *                  hub_uploads.content_sha256 (an upload with no recorded hash
 *                  is refused — a local file cannot prove it is the upload);
 *   otherwise      the parked original in namespace_direct_uploads (the file
 *                  the viewer serves), when the upload has one;
 *   otherwise      REFUSED, with the reason. Never "best effort".
 *
 * DRY RUN by default: prints the version counts, where the bytes would come
 * from, and the planned delete/insert. It writes ONLY when BOTH are true:
 *   NODE_DOC_REPROCESS=1   (the flag the owner sets on purpose)
 *   --apply                (the explicit intent on the command line)
 *
 * Usage:
 *   npx tsx scripts/reprocess-node-doc.ts --tenant-id <uuid> --doc-id <upload uuid> [--pdf <path>] [--apply] [--force]
 *
 * One document per run — never a startup job over all documents (the parse
 * of a 33 MB manual is the memory peak the ingest slot exists to serialize).
 * Runs under Node only: printed page labels are read in a heap-limited worker
 * (pdf-page-label-reader.ts), and Bun does not enforce worker heap limits.
 *
 * Env required: NEON_DATABASE_URL (the owner pool — the DELETE needs it;
 * factorylm_app has no DELETE grant on knowledge_entries). Reverse: there is
 * no reverse — the old rows are gone after COMMIT. Run the dry run first and
 * read its counts; the staging gate is a read-back of the stored table
 * passage afterwards, not this script's exit code.
 */

import { readFileSync } from "node:fs";
import pool from "@/lib/db";
import { EXTRACTION_VERSION, reprocessNodeDocument } from "@/lib/node-knowledge-ingest";

function parseArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? (process.argv[idx + 1] ?? null) : null;
}

async function main(): Promise<void> {
  const tenantId = parseArg("--tenant-id");
  const docId = parseArg("--doc-id");
  const pdfPath = parseArg("--pdf");
  const force = process.argv.includes("--force");
  const apply = process.argv.includes("--apply") && process.env.NODE_DOC_REPROCESS === "1";

  if (!tenantId || !docId) {
    console.error("Usage: npx tsx scripts/reprocess-node-doc.ts --tenant-id <uuid> --doc-id <upload uuid> [--pdf <path>] [--apply] [--force]");
    process.exit(1);
  }
  if (!process.env.NEON_DATABASE_URL) {
    console.error("Error: NEON_DATABASE_URL is required");
    process.exit(1);
  }
  if (process.argv.includes("--apply") && !apply) {
    console.error("Refusing to write: --apply requires NODE_DOC_REPROCESS=1 in the environment.");
    process.exit(1);
  }

  const bytes = pdfPath ? new Uint8Array(readFileSync(pdfPath)) : null;
  console.log(`${apply ? "APPLY" : "DRY RUN"}: tenant=${tenantId} doc=${docId} bytes=${pdfPath ? `local ${pdfPath}` : "parked original"} force=${force} target=v${EXTRACTION_VERSION}`);

  const result = await reprocessNodeDocument({ tenantId, uploadId: docId, bytes, force, dryRun: !apply });
  switch (result.action) {
    case "refused":
      console.error(`REFUSED: ${result.reason}`);
      process.exitCode = 2;
      break;
    case "noop":
      console.log(
        `NOOP: all ${result.chunkCount} chunks already at v${result.version} (pass --force to recompute anyway)${
          result.countRepairPending ? " — kb_chunk_count is stale; re-run with --apply to repair it" : ""
        }`,
      );
      break;
    case "plan":
      console.log(
        `PLAN: would delete ${result.chunkCount} rows (${result.from === null ? "unstamped" : `v${result.from}`}), re-parse from ${result.bytesFrom}, insert at v${result.to}, reason=${result.reason}. Re-run with --apply and NODE_DOC_REPROCESS=1 to write.`,
      );
      break;
    case "reprocessed":
      console.log(
        `REPROCESSED: ${result.deleted} rows → ${result.inserted} rows, ${result.from === null ? "unstamped" : `v${result.from}`} → v${result.to}, reason=${result.reason}, embed=${result.embed.state} (${result.embed.embedded} embedded${result.embed.code ? `, ${result.embed.code}` : ""})`,
      );
      if (result.embed.state === "degraded") process.exitCode = 3;
      break;
  }
}

main()
  .catch((err) => {
    console.error("reprocess failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => void pool.end());
