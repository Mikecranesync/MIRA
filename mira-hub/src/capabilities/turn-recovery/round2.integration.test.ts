/** Actual HTTP, canonical POST, real claim/selection stores and restricted
 * PostgreSQL. Auth is injected; provider bytes are controlled and all other
 * external URLs are refused. Password/JWT checks run against the built app. */
import { AsyncLocalStorage } from "node:async_hooks";
import { createServer, type Server } from "node:http";
import { randomUUID as uuid } from "node:crypto";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
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
const provider = vi.hoisted(() => ({ bodies: [] as unknown[], calls: 0 }));
vi.mock("@/lib/inference/canonical-cascade", () => ({
  canonicalSeamEnabled: () => true,
  canonicalProviders: () => [{ name: "groq", url: "https://controlled-provider.invalid", key: "fixture", model: "fixture" }],
  buildRequestBody: (_provider: unknown, messages: unknown) => { provider.bodies.push(messages); return {}; },
  maxOutputTokens: () => 1000, routeReasonFor: () => "fixture", exhaustedUsage: () => ({ status: "error" }),
  usageFrame: () => ({ kind: "usage", provider: "groq" }), usageFromRaw: () => ({ status: "ok" }),
  logTurnUsage: () => {}, DEFAULT_MAX_OUTPUT_TOKENS: 4000,
}));
vi.mock("@/lib/inference/persist-usage", () => ({ persistTurnUsage: async () => undefined }));
import * as notebooks from "@/lib/equipment-notebooks";
import { notebookIdentitySnapshot, type AcceptedTurnContext } from "./accepted-context";
import { notebookManualIdentity } from "@/capabilities/notebook-manual-identity";
import { readTurnRetry, readTurnRecovery } from "./store";
import { addComponent, getSelection, reviseComponent, setSelection } from "@/capabilities/bench-components/store";
import { readRevisionInput } from "@/capabilities/bench-components/validate";
import { withTenantContext } from "@/lib/tenant-context";
import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";

describe("round2 recovery real storage regressions", () => {
  const tenant = uuid(), foreign = uuid(), owner = "round2-owner";
  const nativeFetch = globalThis.fetch;
  let server: Server, base: string;
  const post = (notebook: string, body: unknown) => nativeFetch(`${base}/${notebook}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const bodyFor = (id: string) => ({ clientRequestId: id, message: "What about the other one?", threadId: "round2", mode: "general", sourceDocIds: [] as string[], history: [],
    expectedEquipmentEntityId: null, componentSelection: { threadId: "round2", componentId: null as string | null, selectionVersion: null as number | null } });
  async function notebook() {
    const id = uuid();
    await db.pool.query(`INSERT INTO equipment_notebooks(id,tenant_id,node_id,display_name,manufacturer,model,catalog_number,identity_status)
      VALUES($1,$2,$3,'Round2','AutomationDirect','GS10','GS11N-10P2','user_confirmed')`, [id, tenant, uuid()]);
    return id;
  }
  async function context(id: string): Promise<AcceptedTurnContext> {
    const nb = await notebooks.getNotebook(tenant, id);
    return { version: 1, target: { equipmentEntityId: nb?.asset?.entityId ?? null, notebookIdentity: notebookIdentitySnapshot(nb), manualIdentity: notebookManualIdentity(nb, await notebooks.resolveBoundAsset(tenant, id)) },
      component: null, history: [{ role: "user", content: "Discuss ORIGINAL-PART" }, { role: "assistant", content: "The original part context" }],
      selectionTurnIds: [], subjectQueries: ["ORIGINAL-PART"], subjectOutOfReach: false,
      priorLookRows: [], currentLookRow: null, priorLookFileIds: [], priorReportContext: { content: "ORIGINAL-REPORT", turnIds: [], truncated: false, coverage: "available" } };
  }
  async function acceptedFailure(id: string, body: ReturnType<typeof bodyFor>, accepted: AcceptedTurnContext) {
    const claim = await notebooks.claimNotebookTurnRequest(tenant, id, { ownerUserId: owner, clientRequestId: body.clientRequestId, question: body.message, threadId: body.threadId, requestPayload: body });
    if (claim.status !== "claimed") throw new Error("fixture claim failed");
    expect(await notebooks.acceptNotebookTurnContext(tenant, id, owner, body.clientRequestId, claim.claimToken, accepted)).toBe(true);
    if (accepted.component) expect(await notebooks.stampClaimedTurnComponent(tenant, id, owner, body.clientRequestId, claim.claimToken, accepted.component.componentId, accepted.component.revision)).toBe(true);
    await notebooks.recordTurn(tenant, id, { question: body.message, answerStatus: "error", answerText: null, evidence: [{ kind: "original_fixture", value: "ORIGINAL-EVIDENCE" }],
      enabledSourceDocIds: [], model: null, equipmentEntityId: accepted.target.equipmentEntityId, ownerUserId: owner, threadId: body.threadId, clientRequestId: body.clientRequestId, claimToken: claim.claimToken });
    return claim;
  }
  const row = async (requestId: string) => (await db.pool.query("SELECT to_jsonb(t) AS row FROM equipment_notebook_turns t WHERE client_request_id=$1", [requestId])).rows[0]?.row;

  beforeAll(async () => {
    process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
    vi.stubGlobal("fetch", (async (input) => {
      if (String(input) !== "https://controlled-provider.invalid") throw new Error("External request forbidden");
      provider.calls++;
      return new Response('data: {"choices":[{"delta":{"content":"The original part remains the question."}}]}\n\ndata: [DONE]\n\n');
    }) as typeof fetch);
    await db.pool.query("INSERT INTO tenants(id,slug,name) VALUES($1,$1::uuid::text,'round2'),($2,$2::uuid::text,'round2 foreign')", [tenant, foreign]);
    server = createServer(async (incoming, outgoing) => {
      const chunks: Buffer[] = [];
      for await (const c of incoming) chunks.push(Buffer.from(c));
      await auth.run({ tenantId: tenant, userId: owner }, async () => {
        try {
          const res = await POST(new NextRequest("http://localhost/chat", { method: "POST", body: Buffer.concat(chunks).toString() }), { params: Promise.resolve({ id: incoming.url!.slice(1) }) });
          outgoing.writeHead(res.status, Object.fromEntries(res.headers)); outgoing.end(await res.text());
        } catch (e) { outgoing.writeHead(500); outgoing.end(String(e)); }
      });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  beforeEach(() => { provider.calls = 0; provider.bodies.length = 0; });
  afterAll(async () => { await new Promise<void>(r => server.close(() => r())); await db.pool.end(); vi.unstubAllGlobals(); });

  it("F2 refuses model A→B with null bindings, preserves the failed exchange, and spends no provider work", async () => {
    const nb = await notebook(), body = bodyFor(uuid());
    await acceptedFailure(nb, body, await context(nb));
    const original = await row(body.clientRequestId);
    await db.pool.query("UPDATE equipment_notebooks SET model='MLC',catalog_number='MLC-SAFETY' WHERE id=$1", [nb]);
    const response = await post(nb, { retryRequestId: body.clientRequestId, threadId: body.threadId });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "notebook_identity_changed" });
    const after = await row(body.clientRequestId);
    for (const key of ["question", "answer_text", "evidence", "component_id", "component_revision", "equipment_entity_id", "client_request_payload", "created_at"]) expect(after[key]).toEqual(original[key]);
    expect(after.client_request_state).toBe("complete");
    expect(provider.calls).toBe(0);
    const direct = await post(nb, body);
    expect(direct.status).toBe(409);
    expect(await direct.json()).toMatchObject({ error: "notebook_identity_changed" });
    expect(provider.calls).toBe(0);
  });

  it.each(["full-body", "envelope"])("round3 F2 fences the server-accepted instance for legacy %s retries, including explicit null", async transport => {
    for (const unbound of [false, true]) {
      const nb = await notebook(), a = uuid(), b = uuid();
      await db.pool.query(`INSERT INTO kg_entities(tenant_id,entity_type,entity_id,name,approval_state,uns_path)
        VALUES($1,'equipment',$2,'GS10 drive A ' || $2,'verified','factory.driveA'::ltree),($1,'equipment',$3,'GS10 drive B ' || $3,'verified','factory.driveB'::ltree)`, [tenant, a, b]);
      if (!unbound) await db.pool.query("UPDATE equipment_notebooks SET equipment_entity_id=$2,asset_confirmed_at=now(),asset_selected_via='asset_picker' WHERE id=$1", [nb, a]);
      const originalBody = bodyFor(uuid());
      const body = Object.fromEntries(Object.entries(originalBody).filter(([key]) => key !== "expectedEquipmentEntityId")) as Omit<typeof originalBody, "expectedEquipmentEntityId">;
      await acceptedFailure(nb, body as ReturnType<typeof bodyFor>, await context(nb));
      const original = await row(body.clientRequestId);
      await db.pool.query("UPDATE equipment_notebooks SET equipment_entity_id=$2,asset_confirmed_at=now(),asset_selected_via='asset_picker' WHERE id=$1", [nb, b]);
      const response = await post(nb, transport === "full-body" ? body : { retryRequestId: body.clientRequestId, threadId: body.threadId });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: "equipment_binding_changed" });
      const after = await row(body.clientRequestId);
      for (const key of ["question", "answer_text", "evidence", "component_id", "component_revision", "equipment_entity_id", "client_request_payload", "created_at"]) expect(after[key]).toEqual(original[key]);
      expect(await readTurnRecovery(tenant, nb, owner, body.threadId, body.clientRequestId)).toMatchObject({ target: { kind: "known", equipmentEntityId: unbound ? null : a }, currentEquipmentEntityId: b });
      expect(provider.calls).toBe(0);
    }
  });

  it("round3 F1/F3 delivers smoke after an exact component is reselected while retaining original attribution and evidence", async () => {
    const nb = await notebook();
    const revision = readRevisionInput({ rawLabel: "Drive", inputKind: "typed", manufacturer: "AutomationDirect", family: "GS10", catalogNumber: "GS11N-10P2" }, true);
    if ("error" in revision) throw new Error(revision.error);
    const added = await addComponent(tenant, nb, owner, { clientRequestId: uuid(), kind: "drive", origin: "technician", position: null, revision });
    if (!("component" in added)) throw new Error("fixture component failed");
    const picked = await setSelection(tenant, nb, owner, "round2", { componentId: added.component.id, via: "picker", expectedVersion: null, expectedRevision: 1, clientRequestId: uuid() });
    if (!("selection" in picked) || !picked.selection) throw new Error("fixture pick failed");
    const body = { ...bodyFor(uuid()), mode: "grounded", message: "There is smoke coming from the drive panel", componentSelection: { threadId: "round2", componentId: added.component.id, selectionVersion: picked.selection.version } };
    const accepted = await context(nb); accepted.component = { componentId: added.component.id, revision: 1, selection: picked.selection };
    await acceptedFailure(nb, body, accepted);
    const original = await row(body.clientRequestId);
    const pickedAgain = await setSelection(tenant, nb, owner, "round2", { componentId: added.component.id, via: "return", expectedVersion: picked.selection.version, expectedRevision: 1, clientRequestId: uuid() });
    if (!("selection" in pickedAgain)) throw new Error("fixture reselect failed");
    const response = await post(nb, { retryRequestId: body.clientRequestId, threadId: "round2" });
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("⚠️");
    const after = await row(body.clientRequestId);
    for (const key of ["question", "answer_text", "answer_status", "evidence", "component_id", "component_revision", "equipment_entity_id", "client_request_payload", "created_at"]) expect(after[key]).toEqual(original[key]);
    expect(await getSelection(tenant, nb, owner, "round2")).toEqual(pickedAgain.selection);
    expect(provider.calls).toBe(0);
  });

  it("captures server-filtered context on a real first POST and ignores client envelope lookalikes", async () => {
    const nb = await notebook();
    await db.pool.query("UPDATE equipment_notebooks SET manufacturer=NULL,model=NULL,catalog_number=NULL,identity_status='unknown' WHERE id=$1", [nb]);
    await notebooks.recordTurn(tenant, nb, { question: "SERVER-ORIGINAL", answerStatus: "answered", answerText: "Stored original context", evidence: [], enabledSourceDocIds: [], model: null, ownerUserId: owner, threadId: "round2" });
    const body = { ...bodyFor(uuid()), history: [{ role: "user", content: "UNTRUSTED-CLIENT-TOPIC" }],
      format: "notebook-turn/v1", request: { message: "SPOOFED" }, acceptedContext: { history: ["SPOOFED-CONTEXT"] } };
    const response = await post(nb, body);
    expect(response.status).toBe(200);
    await response.text();
    const saved = await row(body.clientRequestId);
    expect(saved.client_request_payload.request).toEqual(body);
    const accepted = saved.client_request_payload.acceptedContext;
    expect(JSON.stringify(accepted.history)).toContain("SERVER-ORIGINAL");
    expect(JSON.stringify(accepted)).not.toMatch(/UNTRUSTED-CLIENT-TOPIC|SPOOFED/);
    const replay = await post(nb, body);
    expect(replay.status).toBe(200);
    await replay.text();
    expect(provider.calls).toBe(1);
  });

  it("F1 persists an equipment-independent smoke warning through an unresolved binding", async () => {
    const nb = await notebook(), body = { ...bodyFor(uuid()), message: "There is smoke coming from the drive panel", expectedEquipmentEntityId: "missing-round2-machine" };
    await db.pool.query("UPDATE equipment_notebooks SET equipment_entity_id=$2 WHERE id=$1", [nb, body.expectedEquipmentEntityId]);
    const response = await post(nb, body);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("⚠️");
    const saved = await row(body.clientRequestId);
    expect(saved.equipment_entity_id).toBeNull();
    expect(saved.answer_text).toContain("⚠️");
    expect(provider.calls).toBe(0);
  });

  it("F6 retries the unchanged target with frozen history/subject/reports after more than fifty later turns", async () => {
    const nb = await notebook(), body = bodyFor(uuid());
    await db.pool.query("UPDATE equipment_notebooks SET manufacturer=NULL,model=NULL,catalog_number=NULL,identity_status='unknown' WHERE id=$1", [nb]);
    await acceptedFailure(nb, body, await context(nb));
    for (let i = 0; i < 55; i++) await notebooks.recordTurn(tenant, nb, { question: `LATER-TOPIC-${i}`, answerStatus: "answered", answerText: "LATER-ANSWER", evidence: [], enabledSourceDocIds: [], model: null, ownerUserId: owner, threadId: body.threadId });
    const saved = await readTurnRetry(tenant, nb, owner, body.threadId, body.clientRequestId);
    expect(saved).toMatchObject({ body, acceptedContext: { subjectQueries: ["ORIGINAL-PART"] } });
    const response = await post(nb, { retryRequestId: body.clientRequestId, threadId: body.threadId });
    expect(response.status).toBe(200);
    const stream = await response.text();
    expect(stream).toContain("original part");
    expect(provider.calls).toBe(1);
    const inputs = JSON.stringify(provider.bodies);
    expect(inputs).toContain("ORIGINAL-PART");
    expect(inputs).toContain("ORIGINAL-REPORT");
    expect(inputs).not.toMatch(/LATER-TOPIC|LATER-ANSWER/);
    const before = await notebooks.listTurns(tenant, nb, 1, { viewerUserId: owner, threadId: body.threadId, beforeRequestId: body.clientRequestId });
    expect(before).toEqual([]);
    expect((await db.pool.query("SELECT count(*)::int AS n FROM equipment_notebook_turns WHERE client_request_id=$1", [body.clientRequestId])).rows[0].n).toBe(1);
  });

  it("holds legacy failed context but replays legacy successful responses after identity changes", async () => {
    const nb = await notebook();
    for (const success of [false, true]) {
      const body = bodyFor(uuid()), claim = await notebooks.claimNotebookTurnRequest(tenant, nb, { ownerUserId: owner, clientRequestId: body.clientRequestId, question: body.message, threadId: body.threadId, requestPayload: body });
      if (claim.status !== "claimed") throw new Error("fixture claim failed");
      await notebooks.recordTurn(tenant, nb, { question: body.message, answerStatus: success ? "answered" : "error", answerText: success ? "Original successful answer" : null, evidence: [], enabledSourceDocIds: [], model: null, ownerUserId: owner, threadId: body.threadId, clientRequestId: body.clientRequestId, claimToken: claim.claimToken });
      // Real pre-envelope record, including a client-authored envelope lookalike.
      await db.pool.query("UPDATE equipment_notebook_turns SET client_request_payload=$2::jsonb WHERE client_request_id=$1", [body.clientRequestId, JSON.stringify({ ...body, format: "notebook-turn/v1", request: body, acceptedContext: await context(nb) })]);
      const response = await post(nb, { retryRequestId: body.clientRequestId, threadId: body.threadId });
      expect(response.status).toBe(success ? 200 : 409);
      expect(await response.text()).toContain(success ? "Original successful answer" : "retry_context_unknown");
    }
    expect(provider.calls).toBe(0);
  });

  it("F5 refuses revision 1→2 without moving the selection or relabelling original evidence", async () => {
    const nb = await notebook(), input = { rawLabel: "Drive", inputKind: "typed", manufacturer: "AutomationDirect", family: "GS10", catalogNumber: "GS11N-10P2" };
    const revision = readRevisionInput(input, true);
    if ("error" in revision) throw new Error(revision.error);
    const added = await addComponent(tenant, nb, owner, { clientRequestId: uuid(), kind: "drive", origin: "technician", position: null, revision });
    if (!("component" in added)) throw new Error("component fixture failed");
    const picked = await setSelection(tenant, nb, owner, "round2", { componentId: added.component.id, via: "picker", expectedVersion: null, expectedRevision: 1, clientRequestId: uuid() });
    if (!("selection" in picked) || !picked.selection) throw new Error("selection fixture failed");
    const body = { ...bodyFor(uuid()), mode: "grounded", sourceDocIds: [uuid()], componentSelection: { threadId: "round2", componentId: added.component.id, selectionVersion: picked.selection.version } };
    const accepted = await context(nb); accepted.component = { componentId: added.component.id, revision: 1, selection: picked.selection };
    await acceptedFailure(nb, body, accepted);
    const original = await row(body.clientRequestId), selection = await getSelection(tenant, nb, owner, "round2");
    await reviseComponent(tenant, nb, added.component.id, owner, { clientRequestId: uuid(), expectedRevision: 1, revision: { ...revision, catalogNumber: "GS11N-20P2" } });
    const response = await post(nb, { retryRequestId: body.clientRequestId, threadId: "round2" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "component_revision_changed" });
    const after = await row(body.clientRequestId);
    expect(after.component_revision).toBe(1);
    expect(after.evidence).toEqual(original.evidence);
    expect(await getSelection(tenant, nb, owner, "round2")).toEqual(selection);
    expect(provider.calls).toBe(0);
  });

  it("fences context/attribution writes by owner, tenant and current lease, and never replaces accepted context", async () => {
    const nb = await notebook(), body = bodyFor(uuid()), accepted = await context(nb);
    const first = await acceptedFailure(nb, body, accepted);
    const second = await notebooks.claimNotebookTurnRequest(tenant, nb, { ownerUserId: owner, clientRequestId: body.clientRequestId, question: body.message, threadId: body.threadId, requestPayload: body });
    if (second.status !== "claimed") throw new Error("reclaim failed");
    expect(second.acceptedContext).toEqual(accepted);
    for (const [t, o, token] of [[tenant, owner, first.claimToken], [foreign, owner, second.claimToken], [tenant, "foreign-owner", second.claimToken], [tenant, owner, second.claimToken]]) {
      expect(await notebooks.acceptNotebookTurnContext(t, nb, o, body.clientRequestId, token, { ...accepted, subjectQueries: ["REPLACEMENT"] })).toBe(false);
      if (token !== second.claimToken || o !== owner || t !== tenant) expect(await notebooks.stampClaimedTurnComponent(t, nb, o, body.clientRequestId, token, uuid(), 2)).toBe(false);
    }
    expect(await withTenantContext(tenant, async c => (await c.query("SELECT current_user AS role")).rows[0].role)).toBe("factorylm_app");
    expect(await readTurnRecovery(foreign, nb, owner, body.threadId, body.clientRequestId)).toBeNull();
    expect(await readTurnRecovery(tenant, nb, "foreign-owner", body.threadId, body.clientRequestId)).toBeNull();
  });

  it.each(["partial", "provider_failure"])("full-body duplicates preserve a terminal %s failure without a new execution", async kind => {
    const nb = await notebook(), body = bodyFor(uuid());
    await acceptedFailure(nb, body, await context(nb));
    await db.pool.query("UPDATE equipment_notebook_turns SET answer_text=$2,evidence=$3::jsonb WHERE client_request_id=$1", [body.clientRequestId,
      kind === "partial" ? "Original partial answer" : null, JSON.stringify(kind === "provider_failure" ? [{ kind: "provider_failure", reason: "bounded_provider_refusal" }] : [])]);
    const original = await row(body.clientRequestId);
    const response = await post(nb, body);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-idempotent-replay")).toBe("true");
    await response.text();
    expect(await row(body.clientRequestId)).toEqual(original);
    expect(provider.calls).toBe(0);
  });
});
