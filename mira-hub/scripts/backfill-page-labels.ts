#!/usr/bin/env bun
/**
 * Backfill `metadata.page_label` (the PDF's own printed page label) onto the
 * v2 chunks of ONE already-ingested PDF upload (#4508). Uploads made before
 * node-knowledge-ingest.ts stored labels have none, and the Safety chapter
 * reader returns no chapter without them.
 *
 * The upload bytes are deleted after parsing, so the labels come from a LOCAL
 * copy of the PDF. The script refuses the document unless that copy provably
 * is the uploaded file: its sha256 must equal hub_uploads.content_sha256 when
 * one is recorded, and every stored row's text must be on its recorded page of
 * the local PDF (planPageLabelBackfill). Rows that already carry a label are
 * never changed.
 *
 * DRY RUN by default. It writes ONLY when BOTH are true:
 *   PAGE_LABEL_BACKFILL=1   (the flag the owner sets on purpose)
 *   --apply                 (the explicit intent on the command line)
 *
 * Usage:
 *   bun run scripts/backfill-page-labels.ts --tenant-id <uuid> --doc-id <upload uuid> --pdf <path> [--apply]
 *
 * Env required: NEON_DATABASE_URL. Writes metadata only (never content or
 * embedding), in one transaction that rolls back unless every planned row was
 * written. Reverse with:
 *   UPDATE knowledge_entries SET metadata = metadata - 'page_label'
 *    WHERE tenant_id = <tenant> AND doc_id = <doc>;
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";
import pool from "@/lib/db";
import { printedPageLabels } from "@/lib/node-knowledge-ingest";
import { planPageLabelBackfill, type BackfillRow } from "@/capabilities/page-label-backfill";

function parseArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? (process.argv[idx + 1] ?? null) : null;
}

const tenantId = parseArg("--tenant-id");
const docId = parseArg("--doc-id");
const pdfPath = parseArg("--pdf");
const apply = process.argv.includes("--apply") && process.env.PAGE_LABEL_BACKFILL === "1";

if (!tenantId || !docId || !pdfPath) {
  console.error("Usage: bun run scripts/backfill-page-labels.ts --tenant-id <uuid> --doc-id <upload uuid> --pdf <path> [--apply]");
  process.exit(1);
}
if (!process.env.NEON_DATABASE_URL) {
  console.error("Error: NEON_DATABASE_URL is required");
  process.exit(1);
}
if (process.argv.includes("--apply") && !apply) {
  console.error("--apply ignored: PAGE_LABEL_BACKFILL=1 is required to write (dry run only)");
}

const tag = "[backfill-page-labels]";
console.log(`${tag} tenant=${tenantId} doc=${docId} mode=${apply ? "APPLY" : "dry-run"}`);

const bytes = readFileSync(pdfPath);
const localSha = createHash("sha256").update(bytes).digest("hex");
const up = await pool.query<{ content_sha256: string | null }>(
  `SELECT content_sha256 FROM hub_uploads WHERE id = $1::uuid AND tenant_id = $2 LIMIT 1`,
  [docId, tenantId],
);
if (up.rows.length === 0) {
  console.error(`${tag} REFUSED: no hub_uploads row for this tenant and doc`);
  await pool.end();
  process.exit(2);
}
const storedSha = up.rows[0].content_sha256;
if (storedSha && storedSha !== localSha) {
  console.error(`${tag} REFUSED: local sha256 ${localSha} does not match the upload's ${storedSha}`);
  await pool.end();
  process.exit(2);
}
console.log(`${tag} sha256 ${storedSha ? "matches the upload" : "not recorded on the upload (content proof only)"}`);

const pdf = await getDocumentProxy(new Uint8Array(bytes));
const { text } = await extractText(pdf, { mergePages: false });
const pages: string[] = Array.isArray(text) ? text : [text];
const labels = await printedPageLabels(pdf, pages.length, pdfPath);

const { rows } = await pool.query<{
  id: string;
  source_page: number | null;
  content: string;
  page_label: string | null;
  text_repair: string | null;
}>(
  `SELECT id::text AS id,
          source_page, content,
          NULLIF(BTRIM(metadata->>'page_label'), '') AS page_label,
          metadata->>'text_repair' AS text_repair
     FROM knowledge_entries
    WHERE tenant_id = $1
      AND doc_id = $2::uuid
      AND ingest_route = 'v2'
      AND source_type = 'node_attachment'
    ORDER BY source_page NULLS LAST, id`,
  [tenantId, docId],
);
const backfillRows: BackfillRow[] = rows.map((r) => ({
  id: r.id,
  sourcePage: r.source_page,
  content: r.content,
  pageLabel: r.page_label,
  textRepair: r.text_repair,
}));

const plan = planPageLabelBackfill(backfillRows, pages, labels);
console.log(`${tag} pdf_pages=${pages.length} labels=${labels ? "present" : "none"} stored_rows=${rows.length}`);
if (!plan.ok) {
  console.error(`${tag} REFUSED: ${plan.reason}`);
  await pool.end();
  process.exit(2);
}
console.log(`${tag} planned=${plan.updates.length} unchanged=${plan.unchanged}`);
const byId = new Map(backfillRows.map((r) => [r.id, r]));
for (const u of plan.updates.slice(0, 10)) {
  console.log(`  pdf p.${byId.get(u.id)?.sourcePage} -> printed ${u.label}  (${u.id})`);
}
if (plan.updates.length > 10) console.log(`  ... ${plan.updates.length - 10} more`);

if (!apply) {
  console.log(`${tag} dry run, nothing written`);
  await pool.end();
  process.exit(0);
}

const client = await pool.connect();
let written = 0;
try {
  await client.query("BEGIN");
  for (const u of plan.updates) {
    const res = await client.query(
      `UPDATE knowledge_entries
          SET metadata = metadata || jsonb_build_object('page_label', $3::text)
        WHERE id = $1::uuid AND tenant_id = $2
          AND NULLIF(BTRIM(metadata->>'page_label'), '') IS NULL`,
      [u.id, tenantId, u.label],
    );
    written += res.rowCount ?? 0;
  }
  if (written !== plan.updates.length) throw new Error(`wrote ${written} of ${plan.updates.length} planned rows`);
  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK");
  console.error(`${tag} ROLLED BACK:`, err);
  client.release();
  await pool.end();
  process.exit(3);
}
client.release();
console.log(`${tag} written=${written}/${plan.updates.length}`);
await pool.end();
process.exit(0);
