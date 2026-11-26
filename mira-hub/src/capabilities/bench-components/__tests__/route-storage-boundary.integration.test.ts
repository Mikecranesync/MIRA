/**
 * #5764 r3 F5 / F6 at the route's STORAGE boundary, on real Postgres (no mocked store, no mocked ledger):
 *   F6  an explicit whole-machine question reads, for its open subject, only the turns saved as whole-machine
 *       (real listSelectionTurns over real equipment_notebook_turns, real component stamp);
 *   F5  the newest standalone LOOK is carried even when a NEWER reading of a photo that was sent with a turn
 *       sits in front of it (real recordLookObservation + real loadRecentLookObservations over the real
 *       visual tables and workspace_file_links).
 * The route composes exactly these calls with the pure helpers `wholeMachineTurns` and `standaloneLook`
 * (route.ts); the HTTP handler itself is covered by route-mock tests (chat-route.test.ts,
 * photo-model-mismatch.route.test.ts), not here.
 *
 * Run: TEST_DATABASE_URL=… MIRA_TEST_DB_CONFIRM=DISPOSABLE npx vitest run --config vitest.integration.config.ts src/capabilities/bench-components/__tests__/route-storage-boundary
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID as uuid } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL, max: 6 }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));

import { addComponent, listSelectionTurns, stampTurnComponent } from "../store";
import { readRevisionInput } from "../validate";
import { wholeMachineTurns } from "../selection";
import { readSubject, standaloneLook } from "../../conversation-subject";
import { loadRecentLookObservations, recordLookObservation } from "@/lib/visual-evidence-context";
import { withTenantContext } from "@/lib/tenant-context";

const MIGRATION = path.resolve(__dirname, "../../../../db/migrations/115_bench_components.sql");
const USER = "user-boundary";
const run = process.env.TEST_DATABASE_URL && process.env.MIRA_TEST_DB_CONFIRM === "DISPOSABLE" ? describe : describe.skip;

run("route storage boundary (real Postgres)", () => {
  const tenant = uuid();
  let notebook: string;
  const photoSent = uuid();
  const photoStandalone = uuid();
  const photoComponent = uuid();

  const turn = async (question: string, evidenceFileId: string | null) => {
    const id = uuid();
    await testPool.query(
      `INSERT INTO equipment_notebook_turns (notebook_id, tenant_id, question, answer_status, owner_user_id, thread_id, client_request_id, client_request_state, evidence)
       VALUES ($1::uuid, $2::uuid, $3, 'insufficient_evidence', $4, NULL, $5::uuid, 'complete', $6::jsonb)`,
      [notebook, tenant, question, USER, id, JSON.stringify(evidenceFileId ? [{ kind: "visual_observation", fileId: evidenceFileId, capturedAt: "2026-11-26T12:00:00Z", provenance: "phone_photo" }] : [])],
    );
    return id;
  };

  beforeAll(async () => {
    const sql = readFileSync(MIGRATION, "utf8");
    await testPool.query(sql);
    const nb = await testPool.query<{ id: string }>(
      `INSERT INTO equipment_notebooks (tenant_id, node_id, display_name) VALUES ($1::uuid, $2::uuid, 'boundary') RETURNING id::text AS id`,
      [tenant, uuid()],
    );
    notebook = nb.rows[0]!.id;
  });
  afterAll(async () => {
    await testPool.end();
  });

  it("F6: only whole-machine turns reach an explicit whole-machine question's subject (a component's open photo question does not)", async () => {
    const revision = readRevisionInput({ rawLabel: "GS11N-20P2", inputKind: "typed", manufacturer: "AutomationDirect", family: "GS10", catalogNumber: "GS11N-20P2", localTag: "VFD1" }, false);
    if ("error" in revision) throw new Error(revision.error);
    const added = await addComponent(tenant, notebook, USER, { clientRequestId: uuid(), kind: "drive", origin: "inventory", position: null, revision });
    if (added.status !== "created") throw new Error(added.status);
    const componentTurn = await turn("component question about the plate photo", photoComponent);
    expect(await stampTurnComponent(tenant, notebook, USER, componentTurn, added.component.id, 1)).toBe(true);
    await turn("whole machine question about the conveyor", null);

    const saved = await listSelectionTurns(tenant, notebook, USER, null, 50, { withAnswers: true });
    expect(saved).toHaveLength(2);
    expect(saved.map((t) => t.componentId !== null).sort()).toEqual([false, true]);

    const whole = wholeMachineTurns(saved, null);
    expect(whole.map((t) => t.question)).toEqual(["whole machine question about the conveyor"]);
    const subject = readSubject(whole, 50, false).questions.join("\n");
    expect(subject).toContain("conveyor");
    expect(subject).not.toContain("component question");
    // Control (the failure this guards): without the whole-machine filter the component's turn is in the subject.
    expect(readSubject(saved, 50, false).questions.join("\n")).toContain("component question");
    // The retried request itself is never read either.
    const retried = saved.find((t) => t.componentId === null)!;
    expect(wholeMachineTurns(saved, retried.clientRequestId)).toHaveLength(0);
  });

  it("F5: a newer reading of a SENT photo does not hide the newest standalone LOOK (real ledger + links)", async () => {
    const look = (fileId: string, text: string) =>
      recordLookObservation({ tenantId: tenant, fileId, photoHash: `h-${fileId}`, text, model: "fixture", capturedAt: "2026-11-26T12:00:00Z", createdBy: USER, notebookId: notebook, threadId: "legacy-thread" });
    for (const f of [photoSent, photoStandalone]) {
      await testPool.query("INSERT INTO namespace_direct_uploads (id, tenant_id, filename, mime_type) VALUES ($1, $2, 'b.jpg', 'image/jpeg')", [f, tenant]);
      await testPool.query("INSERT INTO workspace_file_links (tenant_id, file_id, target_type, target_id, role) VALUES ($1, $2, 'equipment_notebook', $3, 'photo')", [tenant, f, notebook]);
    }
    await look(photoStandalone, 'Plate reads "GS20-21P0".');
    await look(photoSent, 'Plate reads "GS20-23P0".');
    await look(photoSent, 'Plate reads "GS20-23P0" (corrected).'); // newest of all, on the photo a turn already sent
    await turn("What about the GS11N-20P5?", photoSent);

    const looks = await withTenantContext(tenant, (c) => loadRecentLookObservations(c, tenant, { notebookId: notebook, ownerUserId: USER, threadId: "legacy-thread" }));
    expect(looks.map((l) => l.fileId)).toEqual([photoSent, photoStandalone]); // newest first: the sent photo's correction is in front
    const saved = await listSelectionTurns(tenant, notebook, USER, null, 50, { withAnswers: true });
    expect(saved.map((t) => t.question)).toContain("What about the GS11N-20P5?");
    const sent = new Set(saved.flatMap((t) => t.evidence.flatMap((e) => (typeof e === "object" && e !== null && (e as { kind?: string }).kind === "visual_observation" ? [String((e as { fileId: string }).fileId)] : []))));
    expect(sent.has(photoSent)).toBe(true);
    const picked = standaloneLook(looks, sent);
    expect(picked?.fileId).toBe(photoStandalone);
    expect(picked?.text).toContain("GS20-21P0");
    // Control: with nothing sent, the newest LOOK is the one carried.
    expect(standaloneLook(looks, new Set())?.fileId).toBe(photoSent);
  });
});
