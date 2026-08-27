// Commodity PRD Phase 2 — canonical-evidence provenance contracts (085).
//
// Requires a disposable Postgres. From mira-hub/ (PowerShell):
//
//   docker run -d --name mira-prov-pg -e POSTGRES_PASSWORD=testpw `
//     -e POSTGRES_DB=mira_test -p 5599:5432 postgres:16
//   $env:TEST_DATABASE_URL="postgres://postgres:testpw@127.0.0.1:5599/mira_test"
//   $env:MIRA_TEST_DB_CONFIRM="DISPOSABLE"
//   $env:MIRA_INTEGRATION_MIGRATIONS="001_knowledge_graph.sql,010_kg_uns_path.sql," +
//     "026_kg_entities_dedupe_and_constraint.sql,027_ai_suggestions.sql," +
//     "029_kg_approval_state.sql,055_contextualization.sql," +
//     "056_contextualization_intake.sql,067_ctx_import_batches_approval_cols.sql," +
//     "027_namespace_direct_uploads.sql,059_namespace_filing_cabinet.sql," +
//     "068_hub_uploads.sql,072_hub_uploads_content_sha256.sql," +
//     "073_equipment_notebooks.sql,075_workspace_file_links.sql," +
//     "076_namespace_uploads_source_reconcile.sql,077_ingest_claim.sql," +
//     "082_namespace_uploads_node_nullable.sql,084_notebook_turn_basis_and_source_origin.sql"
//   npm run db:integration:setup
//   npx vitest run --config vitest.integration.config.ts src/lib/__tests__/provenance-canonical-evidence
//
// Migration 085 is deliberately NOT in the setup list: this suite seeds
// legacy-shaped rows (origin_file_id IS NULL, duplicate derived docs) FIRST and
// then executes 085 itself, so the backfill + duplicate-collapse DML runs
// against exactly the data shape it will meet in production.
//
// WHY INTEGRATION: every invariant here lives in SQL — the 085 backfill's
// provable-only join, the duplicate collapse's window ranking, the superseded
// filters on listing/scope, and the include-superseded citation-origin
// resolution. A mocked withTenantContext proves none of that (the same lesson
// as the #3396 sibling-suite note and the 23505 episode).

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Pool } from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";

const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));

import {
  findVisibleOriginSource,
  getSourceResolution,
  listSources,
  listTurns,
  originFileIdsByDoc,
  supersedePriorOriginSources,
  validateChatSources,
} from "../equipment-notebooks";

const TENANT = "e5000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "e5000000-0000-4000-8000-0000000000ff";
const NODE = "e5000000-0000-4000-8000-00000000000e";

// The one canonical photograph, plus a cross-tenant decoy photo whose id
// appears in a filename but must never be adopted across the tenant boundary.
const PHOTO = "e5000000-1111-4000-8000-000000000010";
const FOREIGN_PHOTO = "e5000000-1111-4000-8000-0000000000f0";

// Derived nameplate docs D1 (oldest) … D3 (newest) over PHOTO, plus decoys.
const D1 = "e5000000-2222-4000-8000-000000000021";
const D2 = "e5000000-2222-4000-8000-000000000022";
const D3 = "e5000000-2222-4000-8000-000000000023";
const D_MANUAL = "e5000000-2222-4000-8000-0000000000a1"; // ordinary PDF — origin must stay NULL
const D_FOREIGN = "e5000000-2222-4000-8000-0000000000a2"; // names a photo the tenant doesn't have
const D4 = "e5000000-2222-4000-8000-000000000024"; // post-085 new reading (supersede test)

const NB = "e5000000-3333-4000-8000-000000000031";

const nameplateName = `nameplate-${PHOTO}.txt`;

async function seed() {
  const c = testPool;
  await c.query(
    `INSERT INTO equipment_notebooks (id, tenant_id, display_name, node_id)
     VALUES ($1::uuid, $2::uuid, 'Harrington UMS3-0335 (itest)', $3::uuid)`,
    [NB, TENANT, NODE],
  );
  // canonical photo + its foreign-tenant decoy
  await c.query(
    `INSERT INTO namespace_direct_uploads (id, tenant_id, filename, mime_type, source)
     VALUES ($1::uuid, $2::uuid, 'IMG_nameplate.jpg', 'image/jpeg', 'nameplate_photo'),
            ($3::uuid, $4::uuid, 'IMG_foreign.jpg',   'image/jpeg', 'nameplate_photo')`,
    [PHOTO, TENANT, FOREIGN_PHOTO, OTHER_TENANT],
  );
  // derived docs (hub_uploads.tenant_id is TEXT) + their parked txt files
  for (const [doc, filename] of [
    [D1, nameplateName],
    [D2, nameplateName],
    [D3, nameplateName],
    [D_MANUAL, "gsacfuse_manual.pdf"],
    [D_FOREIGN, `nameplate-${FOREIGN_PHOTO}.txt`],
    [D4, nameplateName],
  ] as const) {
    await c.query(
      `INSERT INTO hub_uploads (id, tenant_id, filename, status, provider)
       VALUES ($1::uuid, $2, $3, 'parsed', 'itest')`,
      [doc, TENANT, filename],
    );
    await c.query(
      `INSERT INTO namespace_direct_uploads (tenant_id, filename, mime_type, source, upload_id)
       VALUES ($1::uuid, $2, 'text/plain', 'nameplate_text', $3::uuid)`,
      [TENANT, filename, doc],
    );
  }
  // legacy source rows: three duplicate derived readings, origin NULL (the
  // pre-#3421 shape), created oldest→newest; plus the decoys. D4 is NOT yet
  // attached — it arrives post-085 in the supersede test.
  let t = 0;
  for (const [doc, role] of [
    [D1, null],
    [D2, "photo"],
    [D3, "photo"],
    [D_MANUAL, "manual"],
    [D_FOREIGN, null],
  ] as const) {
    t += 1;
    await c.query(
      `INSERT INTO equipment_notebook_sources
         (notebook_id, doc_id, tenant_id, enabled_by_default, match_state, source_role, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, true, 'user_confirmed', $4,
               now() - interval '1 hour' + make_interval(mins => $5))`,
      [NB, doc, TENANT, role, t],
    );
  }
  // knowledge_entries columns listSources counts (doc_id/embedding live in the
  // docs/migrations set, which the hub setup fixture doesn't apply) — additive
  // stub, mirroring the prod columns this suite touches.
  await c.query(
    `ALTER TABLE knowledge_entries
       ADD COLUMN IF NOT EXISTS doc_id uuid,
       ADD COLUMN IF NOT EXISTS embedding text`,
  );
  await c.query(
    `INSERT INTO knowledge_entries (tenant_id, doc_id, content, source_page)
     SELECT $1::uuid, d::uuid, 'Serial number 49849', 1
       FROM unnest($2::uuid[]) AS d`,
    [TENANT, [D1, D2, D3, D_MANUAL, D4]],
  );
  // a persisted turn citing the OLDEST duplicate (pre-085 evidence JSONB — no
  // originFileId), for the read-time enrichment contract.
  await c.query(
    `INSERT INTO equipment_notebook_turns (notebook_id, tenant_id, question, answer_text, evidence)
     VALUES ($1::uuid, $2::uuid, 'what is the serial number', 'Serial number 49849 [1].',
             $3::jsonb)`,
    [
      NB,
      TENANT,
      JSON.stringify([
        { citationId: "1", docId: D1, sourceTitle: nameplateName, page: 1, fileId: null, quote: "49849" },
      ]),
    ],
  );
}

async function cleanup() {
  const c = testPool;
  await c.query(`DELETE FROM equipment_notebook_turns   WHERE tenant_id = $1::uuid`, [TENANT]);
  await c.query(`DELETE FROM equipment_notebook_sources WHERE tenant_id = $1::uuid`, [TENANT]);
  await c.query(`DELETE FROM equipment_notebooks        WHERE tenant_id = $1::uuid`, [TENANT]);
  await c.query(`DELETE FROM knowledge_entries          WHERE tenant_id = $1::uuid`, [TENANT]);
  await c.query(`DELETE FROM namespace_direct_uploads   WHERE tenant_id IN ($1::uuid, $2::uuid)`, [
    TENANT,
    OTHER_TENANT,
  ]);
  await c.query(`DELETE FROM hub_uploads WHERE tenant_id = $1`, [TENANT]);
}

const MIG_085 = readFileSync(
  path.join(__dirname, "..", "..", "..", "db", "migrations", "085_notebook_source_canonical_provenance.sql"),
  "utf8",
);

type SourceRow = {
  doc_id: string;
  origin_file_id: string | null;
  source_role: string | null;
  superseded_at: Date | null;
};

async function sourceRows(): Promise<SourceRow[]> {
  const res = await testPool.query(
    `SELECT doc_id::text AS doc_id, origin_file_id::text AS origin_file_id,
            source_role, superseded_at
       FROM equipment_notebook_sources
      WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid
      ORDER BY created_at`,
    [TENANT, NB],
  );
  return res.rows as SourceRow[];
}

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL is required — see the header recipe.");
  }
  if (process.env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE") {
    throw new Error("Refusing to run against a non-disposable database.");
  }
  await cleanup();
  await seed();
});

afterAll(async () => {
  await cleanup();
  await testPool.end();
});

describe("migration 085 — backfill + duplicate collapse (Test E / Test F data shape)", () => {
  it("backfills origin ONLY where provable, collapses duplicates to the newest, and is idempotent", async () => {
    await testPool.query(MIG_085);
    const rows = await sourceRows();
    const byDoc = new Map(rows.map((r) => [r.doc_id, r]));

    // Provable rows adopted the photo + normalized role.
    for (const d of [D1, D2, D3]) {
      expect(byDoc.get(d)?.origin_file_id).toBe(PHOTO);
      expect(byDoc.get(d)?.source_role).toBe("photo");
    }
    // Ordinary manual: untouched (its own file IS the original).
    expect(byDoc.get(D_MANUAL)?.origin_file_id).toBeNull();
    expect(byDoc.get(D_MANUAL)?.superseded_at).toBeNull();
    // Filename naming a photo the tenant does NOT own: never guessed.
    expect(byDoc.get(D_FOREIGN)?.origin_file_id).toBeNull();

    // Duplicate collapse: newest (D3) stays visible; D1/D2 superseded.
    expect(byDoc.get(D3)?.superseded_at).toBeNull();
    expect(byDoc.get(D1)?.superseded_at).not.toBeNull();
    expect(byDoc.get(D2)?.superseded_at).not.toBeNull();

    // Idempotency: a re-run changes nothing (Invariant 4 at the repair layer).
    const before = JSON.stringify(rows);
    await testPool.query(MIG_085);
    expect(JSON.stringify(await sourceRows())).toBe(before);
  });
});

describe("one visible source per photograph (Invariants 1 + 4)", () => {
  it("listSources hides superseded readings — the technician sees ONE nameplate source", async () => {
    const sources = await listSources(TENANT, NB);
    const nameplates = sources.filter((s) => s.filename === nameplateName);
    expect(nameplates.map((s) => s.docId)).toEqual([D3]);
    expect(nameplates[0].originFileId).toBe(PHOTO);
    // the ordinary manual is unaffected
    expect(sources.some((s) => s.docId === D_MANUAL)).toBe(true);
  });

  it("supersedePriorOriginSources retires prior readings when a NEW derived doc arrives", async () => {
    await testPool.query(
      `INSERT INTO equipment_notebook_sources
         (notebook_id, doc_id, tenant_id, enabled_by_default, match_state, source_role,
          origin_file_id, match_evidence)
       VALUES ($1::uuid, $2::uuid, $3::uuid, true, 'user_confirmed', 'photo', $4::uuid,
               '{"confirm_client_key":"ck-new"}'::jsonb)`,
      [NB, D4, TENANT, PHOTO],
    );
    const superseded = await supersedePriorOriginSources(TENANT, NB, PHOTO, D4);
    expect(superseded).toEqual([D3]); // D1/D2 were already superseded by 085
    const visible = (await listSources(TENANT, NB)).filter((s) => s.filename === nameplateName);
    expect(visible.map((s) => s.docId)).toEqual([D4]);
  });

  it("findVisibleOriginSource anchors idempotency on (notebook, photo) and carries the clientKey", async () => {
    const found = await findVisibleOriginSource(TENANT, NB, PHOTO);
    expect(found?.docId).toBe(D4);
    expect((found?.matchEvidence as { confirm_client_key?: string }).confirm_client_key).toBe(
      "ck-new",
    );
  });

  it("validateChatSources rejects a superseded doc — retired readings cannot re-enter scope", async () => {
    const ok = await validateChatSources(TENANT, NB, [D4]);
    expect(ok.ok).toBe(true);
    const stale = await validateChatSources(TENANT, NB, [D3]);
    expect(stale.ok).toBe(false);
  });
});

describe("citation → canonical original stays resolvable (Invariant 3, Tests A/F/G shape)", () => {
  it("originFileIdsByDoc resolves origin for SUPERSEDED docs too — historical citations keep their photograph", async () => {
    const map = await originFileIdsByDoc(TENANT, NB, [D1, D2, D3, D4, D_MANUAL]);
    for (const d of [D1, D2, D3, D4]) expect(map.get(d)).toBe(PHOTO);
    expect(map.has(D_MANUAL)).toBe(false); // ordinary docs carry no origin
  });

  it("listTurns enriches pre-085 persisted evidence with the canonical origin at read time", async () => {
    const turns = await listTurns(TENANT, NB);
    expect(turns.length).toBe(1);
    const cite = turns[0].evidence[0] as { docId: string; originFileId?: string };
    expect(cite.docId).toBe(D1); // cited the oldest duplicate…
    expect(cite.originFileId).toBe(PHOTO); // …and still reaches the photograph
  });

  it("getSourceResolution serves superseded docs with their origin (web viewer contract, Test H shape)", async () => {
    const gone = await getSourceResolution(TENANT, NB, D1);
    expect(gone).not.toBeNull();
    expect(gone?.superseded).toBe(true);
    expect(gone?.originFileId).toBe(PHOTO);
    const current = await getSourceResolution(TENANT, NB, D_MANUAL);
    expect(current?.superseded).toBe(false);
    expect(current?.originFileId).toBeNull();
    expect(await getSourceResolution(TENANT, NB, PHOTO)).toBeNull(); // never a source itself
  });
});
