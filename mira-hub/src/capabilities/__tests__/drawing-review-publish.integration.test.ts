// Codex #5204 F3 (HIGH): two technicians review the SAME unconfirmed drawing reading at once.
// Before the fix the review route published its replacement and superseded the predecessor in two
// separate transactions, so review A could hide B's replacement and B could then hide A's —
// both 200, no visible reading left. `attachSource({ replacesCurrent })` now publishes and
// supersedes in ONE transaction under the notebook row lock, and only while the reviewed doc is
// still current; the loser gets `stale_source` (route → 409).
//
// WHY THIS IS AN INTEGRATION TEST: the guarantee is Postgres's row lock serializing two real
// connections; the route unit test (drawing-photos-review-route.test.ts) can only assert the
// call shape. Also covers the F6 loader policy against real rows. FICTIONAL rows only.
//
// Requires a disposable Postgres. From mira-hub/ :
//
//   docker run -d --name wp5204-pg -e POSTGRES_PASSWORD=testpw -e POSTGRES_DB=mira_test \
//     -p 127.0.0.1:55672:5432 pgvector/pgvector:pg16
//   export TEST_DATABASE_URL="postgres://postgres:testpw@127.0.0.1:55672/mira_test"
//   export MIRA_TEST_DB_CONFIRM=DISPOSABLE
//   node scripts/setup-integration-db.mjs
//   npx vitest run --config vitest.integration.config.ts \
//     src/capabilities/__tests__/drawing-review-publish.integration.test.ts
//
// NOTE: like its sibling notebook-identity-confirm.integration.test.ts, CI does not run this file
// yet (the CI integration job lists its files by name and `.github/workflows/**` is guarded).

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { Pool } from "pg";

const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL, max: 8 }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));

import { attachSource, setSourceState } from "@/lib/equipment-notebooks";
import { loadNotebookDocTexts, withoutDrawingCandidates } from "@/capabilities/work-packet/document-text";

const TENANT = "5204beef-0000-4000-8000-000000000001";
const NODE_ID = "5204beef-0000-4000-8000-000000000002";

let notebookId: string;
let originFileId: string;

async function upload(name: string): Promise<string> {
  const res = await testPool.query<{ id: string }>(
    `INSERT INTO hub_uploads (tenant_id, provider, filename, status) VALUES ($1, 'test', $2, 'done') RETURNING id::text AS id`,
    [TENANT, name],
  );
  return res.rows[0].id;
}

async function visible(): Promise<string[]> {
  const res = await testPool.query<{ doc_id: string }>(
    `SELECT doc_id::text AS doc_id FROM equipment_notebook_sources
      WHERE notebook_id = $1::uuid AND origin_file_id = $2::uuid AND superseded_at IS NULL
      ORDER BY doc_id`,
    [notebookId, originFileId],
  );
  return res.rows.map((r) => r.doc_id);
}

async function wipe() {
  await testPool.query(`DELETE FROM equipment_notebook_sources WHERE tenant_id = $1::uuid`, [TENANT]);
  await testPool.query(`DELETE FROM equipment_notebooks WHERE tenant_id = $1::uuid`, [TENANT]);
  await testPool.query(`DELETE FROM namespace_direct_uploads WHERE tenant_id = $1::uuid`, [TENANT]);
  await testPool.query(`DELETE FROM hub_uploads WHERE tenant_id = $1`, [TENANT]);
}

beforeAll(async () => {
  // The harness's base knowledge_entries table predates the embedding column `listSources`'
  // readiness count reads (same shim as provenance-canonical-evidence.integration.test.ts).
  await testPool.query(`ALTER TABLE knowledge_entries ADD COLUMN IF NOT EXISTS embedding text`);
  await wipe();
});
afterAll(async () => {
  await wipe();
  await testPool.end();
});

let candidate: string;
beforeEach(async () => {
  await wipe();
  notebookId = (
    await testPool.query<{ id: string }>(
      `INSERT INTO equipment_notebooks (tenant_id, node_id, display_name) VALUES ($1::uuid, $2::uuid, 'Drawing race bench') RETURNING id::text AS id`,
      [TENANT, NODE_ID],
    )
  ).rows[0].id;
  originFileId = (
    await testPool.query<{ id: string }>(
      `INSERT INTO namespace_direct_uploads (tenant_id, filename, source) VALUES ($1::uuid, 'drawing.jpg', 'drawing_photo') RETURNING id::text AS id`,
      [TENANT],
    )
  ).rows[0].id;
  candidate = await upload("Unconfirmed drawing reading.txt");
  const att = await attachSource(TENANT, notebookId, candidate, {
    matchState: "candidate",
    sourceRole: "drawing",
    originFileId,
    matchEvidence: { drawing_transcription: { reviewed: false } },
  });
  expect(att.ok).toBe(true);
  expect(await visible()).toEqual([candidate]);
});

const review = (docId: string) =>
  attachSource(TENANT, notebookId, docId, {
    matchState: "user_confirmed",
    sourceRole: "drawing",
    addedBy: "tech",
    originFileId,
    matchEvidence: { drawing_transcription: { reviewed: true } },
    replacesCurrent: candidate,
  });

describe("concurrent reviews of one drawing reading (Codex #5204 F3)", () => {
  it("exactly one publishes, the other is stale, and exactly one reading stays visible", async () => {
    const a = await upload("Review A.txt");
    const b = await upload("Review B.txt");
    const [ra, rb] = await Promise.all([review(a), review(b)]);

    const wins = [ra, rb].filter((r) => r.ok);
    const stale = [ra, rb].filter((r) => !r.ok);
    expect(wins).toHaveLength(1);
    expect(stale).toHaveLength(1);
    expect(stale[0].error).toBe("stale_source");

    const winner = ra.ok ? a : b;
    expect(await visible()).toEqual([winner]);
    expect(wins[0].supersededDocIds).toEqual([candidate]);
  });

  it("a slower review of an already-replaced reading writes nothing", async () => {
    const a = await upload("Review A.txt");
    expect((await review(a)).ok).toBe(true);
    const late = await upload("Late review.txt");
    const r = await review(late);
    expect(r).toMatchObject({ ok: false, error: "stale_source" });
    expect(await visible()).toEqual([a]);
    const lateRow = await testPool.query(`SELECT 1 FROM equipment_notebook_sources WHERE doc_id = $1::uuid`, [late]);
    expect(lateRow.rows).toHaveLength(0);
  });

  it("control: a single review of the current reading publishes and hides only its predecessor", async () => {
    const a = await upload("Review A.txt");
    const r = await review(a);
    expect(r).toMatchObject({ ok: true, docId: a, supersededDocIds: [candidate] });
    expect(await visible()).toEqual([a]);
  });
});

describe("unreviewed drawing candidates reach only the connection path (Codex #5204 F6)", () => {
  it("the default load excludes the disabled candidate; the connection load admits it, tagged", async () => {
    const plain = await loadNotebookDocTexts(TENANT, notebookId);
    expect(plain.map((d) => d.docId)).not.toContain(candidate);

    const conn = await loadNotebookDocTexts(TENANT, notebookId, { includeDrawingCandidates: true });
    const got = conn.find((d) => d.docId === candidate);
    expect(got).toMatchObject({ drawingCandidate: true, origin: { fileId: originFileId, drawing: { reviewed: false } } });
    expect(withoutDrawingCandidates(conn).map((d) => d.docId)).not.toContain(candidate);
  });

  it("a rejected candidate is never admitted", async () => {
    expect(await setSourceState(TENANT, notebookId, candidate, { matchState: "rejected" })).toBe(true);
    const conn = await loadNotebookDocTexts(TENANT, notebookId, { includeDrawingCandidates: true });
    expect(conn.map((d) => d.docId)).not.toContain(candidate);
  });
});
