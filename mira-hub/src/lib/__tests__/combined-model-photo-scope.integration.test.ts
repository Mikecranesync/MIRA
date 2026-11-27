/**
 * Combined model-correctness release: which photo reading may decide a conversation's retrieval,
 * on the REAL visual-evidence tables (migrations 063 + 069) and the REAL reads the chat route makes
 * (`loadVisualEvidenceForPhoto` with the notebook/owner/thread scope, `loadRecentLookObservations`).
 * No mock of the SQL, the tenant context or the scope. Ownership negatives: other tenant, other
 * owner, other notebook, other thread, a legacy (thread-less) reading, rejected, superseded,
 * detached. Controls: the owner's own reading is read; the file-wide read (hazard stop) still sees
 * every active reading.
 *
 * Run: TEST_DATABASE_URL=… MIRA_TEST_DB_CONFIRM=DISPOSABLE npx vitest run --config vitest.integration.config.ts src/lib/__tests__/combined-model-photo-scope
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TENANT_A = "c0b10000-0000-4000-8000-0000000000a1";
const TENANT_B = "c0b10000-0000-4000-8000-0000000000b2";
const NB = "c0b10000-0000-4000-8000-0000000000c3";
const OTHER_NB = "c0b10000-0000-4000-8000-0000000000c4";

// Hoisted above every import so the module under test gets this pool (the pattern of
// visual-evidence-context.integration.test.ts).
const { pool } = await vi.hoisted(async () => {
  const pg = await import("pg");
  return { pool: new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL }) };
});
vi.mock("@/lib/db", () => ({ default: pool }));

import { loadRecentLookObservations, loadVisualEvidenceForPhoto, recordLookObservation, type LookConversationScope } from "../visual-evidence-context";
import { withTenantContext } from "../tenant-context";

const run = process.env.TEST_DATABASE_URL && process.env.MIRA_TEST_DB_CONFIRM === "DISPOSABLE" ? describe : describe.skip;
const q = (sql: string, values: unknown[] = []) => pool.query(sql, values);
const FILE = "c0b10000-0000-4000-8000-0000000000f1";
const read = (tenant: string, fileId: string, scope?: LookConversationScope) =>
  withTenantContext(tenant, (c) => loadVisualEvidenceForPhoto(c, tenant, fileId, scope));

const record = (over: Partial<Parameters<typeof recordLookObservation>[0]> = {}) =>
  recordLookObservation({
    tenantId: TENANT_A, fileId: FILE, photoHash: "scope-bytes", text: 'Plate reads "GS20-23P0".', model: "fixture",
    capturedAt: "2026-11-26T12:00:00Z", createdBy: "tech-a", notebookId: NB, threadId: "thread-a", ...over,
  });

run("which reading decides a conversation (real Postgres)", () => {
  beforeAll(async () => {
    await q("INSERT INTO namespace_direct_uploads (id, tenant_id, filename, mime_type) VALUES ($1, $2, 'scope.jpg', 'image/jpeg') ON CONFLICT DO NOTHING", [FILE, TENANT_A]);
  });
  afterAll(async () => {
    for (const t of [TENANT_A, TENANT_B]) {
      await q("DELETE FROM observation WHERE tenant_id = $1", [t]);
      await q("DELETE FROM evidence_item WHERE tenant_id = $1", [t]);
      await q("DELETE FROM visual_session WHERE tenant_id = $1", [t]);
    }
    await q("DELETE FROM workspace_file_links WHERE file_id = $1", [FILE]);
    await q("DELETE FROM namespace_direct_uploads WHERE id = $1", [FILE]);
    await pool.end();
  });

  const SCOPE = { notebookId: NB, ownerUserId: "tech-a", threadId: "thread-a" };

  it("control: the owner's own reading, by exact notebook + owner + thread, is the one read", async () => {
    const own = await record();
    expect(own).not.toBeNull();
    const got = await read(TENANT_A, FILE, SCOPE);
    expect(got?.observationId).toBe(own!.observationId);
    expect(got?.text).toContain("GS20-23P0");
  });

  it("another owner, another thread, another notebook, another tenant, and a legacy reading never decide it", async () => {
    // Readings of the SAME photo made in other conversations: each with a distinguishable text.
    await record({ createdBy: "tech-b", text: 'owner B reading "GS20-21P0"' });
    await record({ threadId: "thread-b", text: 'thread B reading "GS20-21P0"' });
    await record({ notebookId: OTHER_NB, text: 'other notebook reading "GS20-21P0"' });
    await record({ threadId: null, text: 'legacy reading "GS20-21P0"' });
    await record({ tenantId: TENANT_B, text: 'tenant B reading "GS20-21P0"' });
    const got = await read(TENANT_A, FILE, SCOPE);
    expect(got?.text).toContain("GS20-23P0");
    expect(got?.text).not.toContain("21P0");
    // Scoped to a conversation that never read this photo: nothing, not another conversation's reading.
    expect(await read(TENANT_A, FILE, { notebookId: NB, ownerUserId: "tech-a", threadId: "thread-never" })).toBeNull();
    expect(await read(TENANT_A, FILE, { notebookId: NB, ownerUserId: "tech-c", threadId: "thread-a" })).toBeNull();
    // The other tenant reads only ITS OWN reading of that file id, never tenant A's.
    const b = await read(TENANT_B, FILE, { notebookId: NB, ownerUserId: "tech-a", threadId: "thread-a" });
    expect(b?.text).toContain("tenant B reading");
    expect(b?.text).not.toContain("GS20-23P0");
  });

  it("the file-wide read (the hazard stop's) still sees a reading, whoever made it", async () => {
    expect(await read(TENANT_A, FILE)).not.toBeNull();
    expect(await read(TENANT_A, "c0b10000-0000-4000-8000-0000000000ff")).toBeNull();
  });

  it("rejected and superseded readings are not read; the next active one is", async () => {
    const scope = { notebookId: NB, ownerUserId: "tech-r", threadId: "thread-r" };
    const first = await record({ createdBy: "tech-r", threadId: "thread-r", text: 'first reading "GS20-23P0"' });
    const second = await record({ createdBy: "tech-r", threadId: "thread-r", text: 'second reading "GS20-21P0"' });
    expect((await read(TENANT_A, FILE, scope))?.observationId).toBe(second!.observationId);
    await q("UPDATE observation SET review_state = 'rejected' WHERE observation_id = $1::uuid", [second!.observationId]);
    expect((await read(TENANT_A, FILE, scope))?.observationId).toBe(first!.observationId);
    await q("UPDATE observation SET superseded_by = $2::uuid WHERE observation_id = $1::uuid", [first!.observationId, second!.observationId]);
    expect(await read(TENANT_A, FILE, scope)).toBeNull();
  });

  it("a standalone LOOK is carried only while its photo is still linked to the notebook", async () => {
    const scope = { notebookId: NB, ownerUserId: "tech-a", threadId: "thread-a" };
    expect(await withTenantContext(TENANT_A, (c) => loadRecentLookObservations(c, TENANT_A, scope))).toEqual([]);
    await q("INSERT INTO workspace_file_links (tenant_id, file_id, target_type, target_id, role) VALUES ($1, $2, 'equipment_notebook', $3, 'photo')", [TENANT_A, FILE, NB]);
    const linked = await withTenantContext(TENANT_A, (c) => loadRecentLookObservations(c, TENANT_A, scope));
    expect(linked.map((r) => r.fileId)).toEqual([FILE]);
    await q("DELETE FROM workspace_file_links WHERE file_id = $1", [FILE]);
    expect(await withTenantContext(TENANT_A, (c) => loadRecentLookObservations(c, TENANT_A, scope))).toEqual([]);
  });
});
