/** Real HTTP + canonical POST + restricted PostgreSQL. Auth is injected; the
 * built password/browser journey is qualified separately. Every external URL
 * is refused so a failed guard cannot spend provider budget. */
import { AsyncLocalStorage } from "node:async_hooks";
import { createServer, type Server } from "node:http";
import { randomUUID as uuid } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { Pool } from "pg";

const db = await vi.hoisted(async () => {
  const { recoveryTestDatabaseUrl } = await import("../../../scripts/recovery-test-database.mjs");
  const { Pool: PgPool } = await import("pg");
  const connectionString = recoveryTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.MIRA_TEST_DB_CONFIRM, process.env.MIRA_TEST_PROFILE);
  return { pool: new PgPool({ connectionString, max: 5 }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: db.pool }));
const auth = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AsyncLocalStorage: Storage } = require("node:async_hooks");
  return new Storage() as AsyncLocalStorage<{ tenantId: string; userId: string } | null>;
});
vi.mock("@/lib/session", () => ({ sessionOr401: async () => auth.getStore() ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }));
import * as notebooks from "@/lib/equipment-notebooks";
import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";

import { notebookIdentitySnapshot, type AcceptedTurnContext } from "./accepted-context";
import { acceptNotebookTurnContext } from "@/lib/equipment-notebooks";
import { recordLookObservation, loadVisualEvidenceForPhoto } from "@/lib/visual-evidence-context";
import { withTenantContext } from "@/lib/tenant-context";
const acceptedFixture = (equipmentEntityId: string | null): AcceptedTurnContext => ({
  version: 1, target: { equipmentEntityId, notebookIdentity: notebookIdentitySnapshot({ identityStatus: "unknown" }),
    manualIdentity: { identity: { manufacturer: null, model: null }, catalogNumber: null, identityStatus: "unknown" } },
  component: null, history: [], selectionTurnIds: null, subjectQueries: [], subjectOutOfReach: false,
  priorLookRows: [], currentLookRow: null, priorLookFileIds: [], priorReportContext: { content: "", turnIds: [], truncated: false, coverage: "not_requested" },
});

describe("recovered chat acceptance HTTP/PostgreSQL", () => {
  const tenant = uuid(), foreignTenant = uuid(), notebook = uuid(), owner = "chat-recovery-owner", thread = "chat-recovery";
  const nativeFetch = globalThis.fetch;
  let server: Server, base: string, externalCalls = 0;
  const post = (body: object, actor = "owner") => nativeFetch(base, { method: "POST", headers: { "content-type": "application/json", authorization: actor }, body: JSON.stringify(body) });
  const payload = (id: string) => ({ clientRequestId: id, message: "What fuse?", threadId: thread, expectedEquipmentEntityId: "machine-A", mode: "general", sourceDocIds: [], history: [] });

  beforeAll(async () => {
    vi.stubGlobal("fetch", ((input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith("http://127.0.0.1:")) { externalCalls++; throw new Error("External request forbidden in recovery fixture"); }
      return nativeFetch(input, init);
    }) as typeof fetch);
    await db.pool.query("INSERT INTO tenants(id,slug,name) VALUES($1,$1::uuid::text,'chat recovery'),($2,$2::uuid::text,'foreign chat')", [tenant, foreignTenant]);
    await db.pool.query("INSERT INTO equipment_notebooks(id,tenant_id,node_id,display_name,equipment_entity_id) VALUES($1,$2,$3,'Recovery chat','machine-A')", [notebook, tenant, uuid()]);
    await db.pool.query("INSERT INTO kg_entities(tenant_id,entity_type,entity_id,name,approval_state,uns_path) VALUES($1,'equipment','machine-B','B','verified','factory.machineB'::ltree)", [tenant]);
    server = createServer(async (incoming, outgoing) => {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const actor = incoming.headers.authorization === "owner" ? { tenantId: tenant, userId: owner }
        : incoming.headers.authorization === "foreign" ? { tenantId: foreignTenant, userId: owner } : null;
      await auth.run(actor, async () => {
        try {
          const response = await POST(new NextRequest("http://localhost/chat", { method: "POST", body: Buffer.concat(chunks).toString(), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ id: notebook }) });
          outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(await response.text());
        } catch (error) { outgoing.writeHead(500); outgoing.end(String(error)); }
      });
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/chat`;
  });
  afterAll(async () => { await new Promise<void>(r => server.close(() => r())); await db.pool.end(); vi.unstubAllGlobals(); });

  it("refuses a changed machine before inference and leaves no accepted turn", async () => {
    const id = uuid(), response = await post({ ...payload(id), expectedEquipmentEntityId: "machine-B" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "equipment_binding_changed" });
    expect((await db.pool.query("SELECT count(*)::int AS n FROM equipment_notebook_turns WHERE client_request_id=$1", [id])).rows[0].n).toBe(0);
    expect(externalCalls).toBe(0);
  });

  it("follows a live original request instead of accepting a second execution", async () => {
    const id = uuid(), body = payload(id);
    await notebooks.claimNotebookTurnRequest(tenant, notebook, { ownerUserId: owner, clientRequestId: id, question: body.message, threadId: thread, requestPayload: body });
    const response = await post({ retryRequestId: id, threadId: thread });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "request_in_progress" });
    expect(externalCalls).toBe(0);
  });

  it("refuses foreign, unauthenticated and payload-replacing recovery envelopes", async () => {
    const id = uuid();
    expect((await post({ retryRequestId: id, threadId: thread }, "foreign")).status).toBe(404);
    expect((await post({ retryRequestId: id, threadId: thread }, "anonymous")).status).toBe(401);
    expect((await post({ retryRequestId: id, threadId: thread, message: "different question" })).status).toBe(400);
    expect(externalCalls).toBe(0);
  });

  it("refuses a rebind between acceptance and the actual inference snapshot", async () => {
    const actualRead = notebooks.resolveBoundAsset;
    const captured = vi.spyOn(notebooks, "resolveBoundAsset").mockImplementationOnce(async (...args) => {
      await db.pool.query("UPDATE equipment_notebooks SET equipment_entity_id='machine-B' WHERE id=$1", [notebook]);
      return actualRead(...args);
    });
    try {
      const response = await post(payload(uuid()));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: "equipment_binding_changed" });
      expect(captured).toHaveBeenCalledTimes(1);
      expect(externalCalls).toBe(0);
    } finally { captured.mockRestore(); await db.pool.query("UPDATE equipment_notebooks SET equipment_entity_id='machine-A' WHERE id=$1", [notebook]); }
  });

  it("refuses a missing original photo and keeps the original failed exchange", async () => {
    const id = uuid(), photo = uuid(), body = { ...payload(id), visualEvidence: { fileId: photo } };
    const claim = await notebooks.claimNotebookTurnRequest(tenant, notebook, { ownerUserId: owner, clientRequestId: id, question: body.message, threadId: thread, requestPayload: body });
    if (claim.status !== "claimed") throw new Error("claim failed");
    expect(await acceptNotebookTurnContext(tenant, notebook, owner, id, claim.claimToken, acceptedFixture("machine-A"))).toBe(true);
    const evidence = [{ kind: "visual_observation", fileId: photo }];
    await notebooks.recordTurn(tenant, notebook, { question: body.message, answerStatus: "error", answerText: null, enabledSourceDocIds: [], evidence, model: null, ownerUserId: owner,
      threadId: thread, clientRequestId: id, claimToken: claim.claimToken, equipmentEntityId: "machine-A" });
    const response = await post({ retryRequestId: id, threadId: thread });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "retry_photo_unavailable" });
    expect((await notebooks.listTurns(tenant, notebook, 50, { viewerUserId: owner, threadId: thread })).find(row => row.clientRequestId === id)).toMatchObject({ answerStatus: "error", evidence });
    expect(externalCalls).toBe(0);
  });

  it("replays a completed original response without re-evaluating a newer machine binding", async () => {
    const id = uuid(), body = payload(id);
    const claim = await notebooks.claimNotebookTurnRequest(tenant, notebook, { ownerUserId: owner, clientRequestId: id, question: body.message, threadId: thread, requestPayload: body });
    if (claim.status !== "claimed") throw new Error("claim failed");
    await notebooks.recordTurn(tenant, notebook, { question: body.message, answerStatus: "answered", answerText: "Original machine A answer", enabledSourceDocIds: [], evidence: [], model: null,
      ownerUserId: owner, threadId: thread, clientRequestId: id, claimToken: claim.claimToken, equipmentEntityId: "machine-A" });
    await db.pool.query("UPDATE equipment_notebooks SET equipment_entity_id='machine-B' WHERE id=$1", [notebook]);
    try {
      const response = await post({ retryRequestId: id, threadId: thread });
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("Original machine A answer");
      expect(externalCalls).toBe(0);
    } finally { await db.pool.query("UPDATE equipment_notebooks SET equipment_entity_id='machine-A' WHERE id=$1", [notebook]); }
  });

  it("native round4 F1: a detached manual does not hide the original photo's warning (real HTTP/PostgreSQL)", async () => {
    const detachedManual = uuid();
    // The accepted machine must still resolve, so the manual is the only thing that changed.
    await db.pool.query("INSERT INTO kg_entities(tenant_id,entity_type,entity_id,name,approval_state,uns_path) VALUES($1,'equipment','machine-A','A','verified','factory.machineA'::ltree)", [tenant]);
    try {
    const accept = async (hazards: { code: string; confidence: number }[]) => {
      const photo = uuid();
      await db.pool.query("INSERT INTO namespace_direct_uploads (id, tenant_id, filename, mime_type) VALUES ($1,$2,'cabinet.jpg','image/jpeg')", [photo, tenant]);
      await db.pool.query("INSERT INTO workspace_file_links (tenant_id, file_id, target_type, target_id, role) VALUES ($1,$2,'equipment_notebook',$3,'photo')", [tenant, photo, notebook]);
      await recordLookObservation({ tenantId: tenant, fileId: photo, photoHash: uuid(), text: "Cabinet interior", model: "fixture",
        hazards: hazards as never, capturedAt: new Date().toISOString(), notebookId: notebook, threadId: thread, createdBy: owner });
      const id = uuid(), body = { ...payload(id), mode: "grounded", sourceDocIds: [detachedManual], visualEvidence: { fileId: photo } };
      const claim = await notebooks.claimNotebookTurnRequest(tenant, notebook, { ownerUserId: owner, clientRequestId: id, question: body.message, threadId: thread, requestPayload: body });
      if (claim.status !== "claimed") throw new Error("claim failed");
      const look = await withTenantContext(tenant, c => loadVisualEvidenceForPhoto(c, tenant, photo));
      expect(look).not.toBeNull();
      expect(await acceptNotebookTurnContext(tenant, notebook, owner, id, claim.claimToken, { ...acceptedFixture("machine-A"), currentLookRow: look })).toBe(true);
      await notebooks.recordTurn(tenant, notebook, { question: body.message, answerStatus: "error", answerText: null, enabledSourceDocIds: [detachedManual], evidence: [{ kind: "visual_observation", fileId: photo }], model: null,
        ownerUserId: owner, threadId: thread, clientRequestId: id, claimToken: claim.claimToken, equipmentEntityId: "machine-A" });
      return id;
    };
    const stored = async (id: string) => (await notebooks.listTurns(tenant, notebook, 50, { viewerUserId: owner, threadId: thread })).find(row => row.clientRequestId === id);
    // Hazardous photo, manual detached: the independent warning is delivered and the original row is untouched.
    const hazardous = await accept([{ code: "smoke", confidence: 0.99 }]);
    const original = await stored(hazardous);
    expect(original).toMatchObject({ answerStatus: "error" });
    const direct = await post({ retryRequestId: hazardous, threadId: thread });
    const directBody = await direct.json();
    expect(direct.status).toBe(403); expect(directBody.code).toBe("source_not_in_notebook"); expect(directBody.safetyWarning).toContain("⚠️");
    expect(await stored(hazardous)).toEqual(original);
    // Nonhazardous photo: a plain refusal with no warning.
    const plain = await accept([]);
    const plainResponse = await post({ retryRequestId: plain, threadId: thread });
    expect(plainResponse.status).toBe(403); expect(await plainResponse.json()).toEqual({ error: "source_not_in_notebook" });
    expect(externalCalls).toBe(0);
    } finally { await db.pool.query("DELETE FROM kg_entities WHERE tenant_id=$1 AND entity_id='machine-A'", [tenant]); }
  });
});
