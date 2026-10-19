#!/usr/bin/env bun
/**
 * Re-extract (decode) garbled notebook chunks already in knowledge_entries
 * (2026-10-17 prod-test TQ-05 / TQ-06 — the PLC-5 manual ingested before the
 * +29 repair existed in node-knowledge-ingest.ts).
 *
 * DRY RUN by default: prints the rows it would rewrite (id, page, a short
 * before/after) and exits. It writes ONLY when BOTH are true:
 *   NOTEBOOK_GARBLE_REEXTRACT=1   (the flag the owner flips on purpose)
 *   --apply                       (the explicit intent on the command line)
 *
 * Usage:
 *   bun run scripts/repair-garbled-chunks.ts --tenant-id <uuid> [--doc-id <uuid>] [--apply]
 *   (--apply additionally REQUIRES --doc-id: writes are scoped to one document)
 *
 * Env required: NEON_DATABASE_URL. Rewrites `content` in place and stamps
 * `metadata.text_repair = 'shift29'`. Reversal is approximate, not exact: the
 * decoder runs block by block, so `encodeShift29` over a whole repaired row
 * would re-encode any block that was left alone. Recover from a backup or
 * re-ingest the document rather than trusting a round trip. Never
 * touches a row that already carries a completed text_repair marker (a
 * 'shift29_partial' row — part decoded, cipher remaining — stays eligible so a
 * later pass can finish it), never touches
 * shared-OEM rows (node_attachment / v2 only), and re-runs are no-ops.
 */

import pool from "@/lib/db";
import { planChunkRepairs } from "@/capabilities/garbled-text";

function parseArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? (process.argv[idx + 1] ?? null) : null;
}

const tenantId = parseArg("--tenant-id");
const docId = parseArg("--doc-id");
const apply = process.argv.includes("--apply") && process.env.NOTEBOOK_GARBLE_REEXTRACT === "1";

if (!tenantId) {
  console.error("Usage: bun run scripts/repair-garbled-chunks.ts --tenant-id <uuid> [--doc-id <uuid>] [--apply]");
  process.exit(1);
}
if (!process.env.NEON_DATABASE_URL) {
  console.error("Error: NEON_DATABASE_URL is required");
  process.exit(1);
}
if (process.argv.includes("--apply") && !apply) {
  console.error("--apply ignored: NOTEBOOK_GARBLE_REEXTRACT=1 is required to write (dry run only)");
}
if (apply && !docId) {
  // Round-2 review: without --doc-id the write covers every v2 chunk in the
  // tenant. One document per apply, so a wrong call is bounded and reversible.
  console.error("--apply requires --doc-id: an apply is scoped to ONE document (dry-run across the tenant is fine)");
  process.exit(1);
}

console.log(`[repair-garbled-chunks] tenant=${tenantId} doc=${docId ?? "*"} mode=${apply ? "APPLY" : "dry-run"}`);

const params: unknown[] = [tenantId];
let docClause = "";
if (docId) {
  params.push(docId);
  docClause = "AND doc_id = $2::uuid";
}
const { rows } = await pool.query<{ id: string; content: string; source_page: number | null; source_url: string }>(
  `SELECT id::text AS id, content, source_page, source_url
     FROM knowledge_entries
    WHERE tenant_id = $1
      AND ingest_route = 'v2'
      AND source_type = 'node_attachment'
      AND ((metadata->>'text_repair') IS NULL OR (metadata->>'text_repair') = 'shift29_partial')
      ${docClause}
    ORDER BY source_url, source_page NULLS LAST, (metadata->>'chunk_index')::int NULLS LAST`,
  params,
);
const plan = planChunkRepairs(rows);
console.log(`[repair-garbled-chunks] scanned=${rows.length} garbled(shift29)=${plan.length}`);
const byId = new Map(rows.map((r) => [r.id, r]));
for (const p of plan.slice(0, 20)) {
  const r = byId.get(p.id)!;
  console.log(`  ${r.source_url} p.${r.source_page ?? "?"} ${p.id}\n    before: ${r.content.slice(0, 60).replace(/\s+/g, " ")}\n    after:  ${p.content.slice(0, 60).replace(/\s+/g, " ")}`);
}
if (plan.length > 20) console.log(`  … ${plan.length - 20} more`);

if (!apply) {
  console.log("[repair-garbled-chunks] dry run — nothing written");
  await pool.end();
  process.exit(0);
}

let written = 0;
for (const p of plan) {
  const res = await pool.query(
    `UPDATE knowledge_entries
        SET content = $2,
            -- The old vector was computed from the cipher text; drop it so the
            -- embed-retry sweep (embedding IS NULL) re-embeds the decoded row.
            -- Without this, BM25 found the repaired row while the vector lane
            -- still ranked it as noise (Codex round 1 on #4486).
            embedding = NULL,
            metadata = metadata || jsonb_build_object('text_repair', $4::text)
      WHERE id = $1::uuid AND tenant_id = $3
        AND ((metadata->>'text_repair') IS NULL OR (metadata->>'text_repair') = 'shift29_partial')`,
    [p.id, p.content, tenantId, p.repair],
  );
  written += res.rowCount ?? 0;
}
console.log(`[repair-garbled-chunks] written=${written}/${plan.length}`);
await pool.end();
process.exit(0);
