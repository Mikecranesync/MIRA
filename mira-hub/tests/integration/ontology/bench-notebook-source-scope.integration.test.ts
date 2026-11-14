// Bench runtime context contract — WHICH DOCUMENTS MAY ENTER A PILOT ANSWER.
//
// WHAT THIS IS: the real `validateChatSources` (the equipment-notebook chat's scope
// boundary), `listSources`, `getSourceResolution` and `originFileIdsByDoc`, run against a
// real PostgreSQL built from the Hub migrations. Clauses exercised on the PILOT path:
//   - explicit approval   (only a human-confirmed, enabled source may be cited)
//   - rejected evidence   (never citable)
//   - corrected/superseded reading absent from the current answer scope, kept in history
//   - tenant isolation
//
// WHAT THIS IS NOT: it does not run the chat route or retrieval. That the route hands
// retrieval exactly the validator's returned ids (not the client's) is proven with a
// mocked validator by src/app/api/equipment-notebooks/__tests__/chat-approved-source-scope.test.ts.
// The two together are the chain; neither alone is the route on a real database.
//
// NOTE ON AN EXISTING TEST: src/lib/__tests__/provenance-canonical-evidence.integration.test.ts
// still asserts that asking for a superseded reading is REFUSED. Since #3442 the validator
// instead RENAMES a proven-superseded reading to its visible successor. That older
// assertion is stale against intended behaviour (it is in no CI job, so nothing flagged
// it). The property that matters — the old reading's id is not in the returned scope —
// is asserted here.
//
// Nothing here is CI-enforced. Same disposable database as the graph contract.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));

import {
  getSourceResolution,
  listSources,
  originFileIdsByDoc,
  validateChatSources,
} from "@/lib/equipment-notebooks";

const TENANT = "5c09e000-0000-4000-8000-000000000001";
const OTHER_TENANT = "5c09e000-0000-4000-8000-0000000000ff";
const NODE = "5c09e000-0000-4000-8000-00000000000e";
const NB = "5c09e000-3333-4000-8000-000000000031";
const OTHER_NB = "5c09e000-3333-4000-8000-0000000000f1";

const PHOTO = "5c09e000-1111-4000-8000-000000000010"; // nameplate photo, read twice
const PHOTO_ORPHAN = "5c09e000-1111-4000-8000-000000000011"; // photo whose only reading was retired
const PHOTO_WEAK = "5c09e000-1111-4000-8000-000000000012"; // photo whose newer reading nobody confirmed

const OLD = "5c09e000-2222-4000-8000-000000000021"; // first reading — superseded
const NEW = "5c09e000-2222-4000-8000-000000000022"; // corrected reading — current
const MANUAL = "5c09e000-2222-4000-8000-000000000023"; // ordinary confirmed manual
const REJECTED = "5c09e000-2222-4000-8000-000000000024";
const CANDIDATE = "5c09e000-2222-4000-8000-000000000025"; // suggested, never confirmed
const DISABLED = "5c09e000-2222-4000-8000-000000000026";
const ORPHAN = "5c09e000-2222-4000-8000-000000000027"; // superseded, no successor at all
const WEAK_OLD = "5c09e000-2222-4000-8000-000000000028"; // superseded; successor is only a candidate
const WEAK_NEW = "5c09e000-2222-4000-8000-000000000029";
const FOREIGN = "5c09e000-2222-4000-8000-0000000000f2"; // other tenant's confirmed source

type Src = {
  doc: string;
  state?: string;
  enabled?: boolean;
  origin?: string | null;
  superseded?: boolean;
  age: number; // minutes ago
};

const SOURCES: Src[] = [
  { doc: OLD, origin: PHOTO, superseded: true, age: 60 },
  { doc: NEW, origin: PHOTO, age: 10 },
  { doc: MANUAL, age: 50 },
  { doc: REJECTED, state: "rejected", age: 40 },
  { doc: CANDIDATE, state: "candidate", age: 30 },
  { doc: DISABLED, enabled: false, age: 20 },
  { doc: ORPHAN, origin: PHOTO_ORPHAN, superseded: true, age: 55 },
  { doc: WEAK_OLD, origin: PHOTO_WEAK, superseded: true, age: 45 },
  { doc: WEAK_NEW, origin: PHOTO_WEAK, state: "candidate", age: 5 },
];

async function cleanup() {
  const both = [TENANT, OTHER_TENANT];
  await testPool.query(`DELETE FROM equipment_notebook_sources WHERE tenant_id = ANY($1::uuid[])`, [both]);
  await testPool.query(`DELETE FROM equipment_notebooks WHERE tenant_id = ANY($1::uuid[])`, [both]);
  await testPool.query(`DELETE FROM knowledge_entries WHERE tenant_id = ANY($1::uuid[])`, [both]);
  await testPool.query(`DELETE FROM namespace_direct_uploads WHERE tenant_id = ANY($1::uuid[])`, [both]);
  await testPool.query(`DELETE FROM hub_uploads WHERE tenant_id = ANY($1::text[])`, [both]);
}

async function seed() {
  const c = testPool;
  await c.query(
    `INSERT INTO equipment_notebooks (id, tenant_id, display_name, node_id)
     VALUES ($1::uuid, $2::uuid, 'Bench drive (contract)', $5::uuid),
            ($3::uuid, $4::uuid, 'Other tenant drive (contract)', $5::uuid)`,
    [NB, TENANT, OTHER_NB, OTHER_TENANT, NODE],
  );
  for (const photo of [PHOTO, PHOTO_ORPHAN, PHOTO_WEAK]) {
    await c.query(
      `INSERT INTO namespace_direct_uploads (id, tenant_id, filename, mime_type, source)
       VALUES ($1::uuid, $2::uuid, 'plate.jpg', 'image/jpeg', 'nameplate_photo')`,
      [photo, TENANT],
    );
  }
  for (const s of SOURCES) {
    await c.query(
      `INSERT INTO hub_uploads (id, tenant_id, filename, status, provider)
       VALUES ($1::uuid, $2, $3, 'parsed', 'itest')`,
      [s.doc, TENANT, `doc-${s.doc.slice(-2)}.txt`],
    );
    await c.query(
      `INSERT INTO equipment_notebook_sources
         (notebook_id, doc_id, tenant_id, enabled_by_default, match_state, origin_file_id,
          superseded_at, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid,
               CASE WHEN $7 THEN now() ELSE NULL END, now() - make_interval(mins => $8))`,
      [NB, s.doc, TENANT, s.enabled ?? true, s.state ?? "user_confirmed", s.origin ?? null, s.superseded ?? false, s.age],
    );
  }
  await c.query(
    `INSERT INTO hub_uploads (id, tenant_id, filename, status, provider)
     VALUES ($1::uuid, $2, 'foreign.pdf', 'parsed', 'itest')`,
    [FOREIGN, OTHER_TENANT],
  );
  await c.query(
    `INSERT INTO equipment_notebook_sources (notebook_id, doc_id, tenant_id, enabled_by_default, match_state)
     VALUES ($1::uuid, $2::uuid, $3::uuid, true, 'user_confirmed')`,
    [OTHER_NB, FOREIGN, OTHER_TENANT],
  );
  // listSources counts chunks on columns that live in the docs/migrations set, which the
  // Hub fixture does not apply — additive stub, same as the provenance suite.
  await c.query(
    `ALTER TABLE knowledge_entries
       ADD COLUMN IF NOT EXISTS doc_id uuid,
       ADD COLUMN IF NOT EXISTS embedding text`,
  );
}

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required.");
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

describe("pilot path: only an explicitly approved source may enter an answer", () => {
  it("positive control: a confirmed, enabled source is accepted unchanged", async () => {
    expect(await validateChatSources(TENANT, NB, [MANUAL, NEW])).toEqual({
      ok: true,
      docIds: [MANUAL, NEW],
      nodeId: NODE,
    });
  });

  it.each([
    ["rejected evidence", REJECTED],
    ["a suggestion nobody confirmed", CANDIDATE],
    ["a source the user switched off", DISABLED],
  ])("%s is refused, and takes the whole request down with it", async (_label, doc) => {
    expect(await validateChatSources(TENANT, NB, [doc])).toEqual({ ok: false, error: "source_not_in_notebook" });
    expect(await validateChatSources(TENANT, NB, [MANUAL, doc])).toEqual({
      ok: false,
      error: "source_not_in_notebook",
    });
  });
});

describe("pilot path: a superseded reading is absent from the current answer scope", () => {
  it("asking for the old reading yields the corrected one — the old id is not in scope", async () => {
    const res = await validateChatSources(TENANT, NB, [OLD]);
    expect(res).toEqual({ ok: true, docIds: [NEW], nodeId: NODE, remapped: { [OLD]: NEW } });
  });

  it("asking for both old and corrected yields the corrected one once", async () => {
    const res = await validateChatSources(TENANT, NB, [OLD, NEW, MANUAL]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.docIds).toEqual([NEW, MANUAL]);
    expect(res.docIds).not.toContain(OLD);
  });

  it("a superseded reading with no successor is refused, not silently kept", async () => {
    expect(await validateChatSources(TENANT, NB, [ORPHAN])).toEqual({
      ok: false,
      error: "source_not_in_notebook",
    });
  });

  it("a superseded reading whose only successor was never confirmed is refused", async () => {
    expect(await validateChatSources(TENANT, NB, [WEAK_OLD])).toEqual({
      ok: false,
      error: "source_not_in_notebook",
    });
  });

  it("the source list shows the corrected reading and not the old one", async () => {
    const shown = (await listSources(TENANT, NB)).map((s) => s.docId);
    expect(shown).toContain(NEW);
    expect(shown).toContain(MANUAL);
    for (const gone of [OLD, ORPHAN, WEAK_OLD]) expect(shown).not.toContain(gone);
  });
});

describe("pilot path: the superseded reading is retained in history", () => {
  it("it still resolves, marked superseded, with the photograph it came from", async () => {
    const old = await getSourceResolution(TENANT, NB, OLD);
    expect(old?.superseded).toBe(true);
    expect(old?.originFileId).toBe(PHOTO);
    expect((await getSourceResolution(TENANT, NB, NEW))?.superseded).toBe(false);
  });

  it("a citation to the old reading still reaches its photograph", async () => {
    const map = await originFileIdsByDoc(TENANT, NB, [OLD, NEW, ORPHAN]);
    expect(map.get(OLD)).toBe(PHOTO);
    expect(map.get(NEW)).toBe(PHOTO);
    expect(map.get(ORPHAN)).toBe(PHOTO_ORPHAN);
  });
});

describe("pilot path: another tenant's notebook and sources are out of reach", () => {
  it("another tenant cannot open this notebook's scope", async () => {
    expect(await validateChatSources(OTHER_TENANT, NB, [NEW])).toEqual({ ok: false, error: "notebook_not_found" });
  });

  it("this tenant cannot pull another tenant's confirmed source into its notebook", async () => {
    expect(await validateChatSources(TENANT, NB, [FOREIGN])).toEqual({ ok: false, error: "source_not_in_notebook" });
    expect(await validateChatSources(TENANT, OTHER_NB, [FOREIGN])).toEqual({ ok: false, error: "notebook_not_found" });
  });

  it("positive control: the other tenant can use its own source in its own notebook", async () => {
    expect(await validateChatSources(OTHER_TENANT, OTHER_NB, [FOREIGN])).toEqual({
      ok: true,
      docIds: [FOREIGN],
      nodeId: NODE,
    });
  });

  it("history lookups do not cross the tenant line", async () => {
    expect(await getSourceResolution(OTHER_TENANT, NB, OLD)).toBeNull();
    expect((await originFileIdsByDoc(OTHER_TENANT, NB, [OLD])).size).toBe(0);
    expect(await listSources(OTHER_TENANT, NB)).toEqual([]);
  });
});
