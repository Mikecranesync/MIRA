/** Human photo requirement (#5669), against the REAL route, real claim/ownership stores and restricted PostgreSQL.
 *  Seeds actual file rows, file links and LOOK observations through the production write helper and reads them back
 *  through the production loader. Only auth and provider transport are fixtures (provider bytes are controlled and every
 *  other URL is refused). Nothing here names a port or database: the profile is env-derived (recovery-test-database.mjs).
 *
 *  Contract under test: when the ORIGINAL photo reading changed, Retry (1) says so in plain words and asks for a NEW
 *  question, (2) never takes the replacement's text or hazards, (3) still warns from the ORIGINAL accepted reading while
 *  the photo is authorized, (4) leaves the failed row byte-identical and spends no provider work. A NEW question uses the
 *  CURRENT authorized evidence and shows its hazard. File-wide hazards are sticky until the reading that carries them is
 *  rejected, so "current safe" is asserted only after the old reading is rejected. */
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
import { PHOTO_CHANGED_RETRY_NOTE } from "./contract";
import { bypassStopText } from "@/capabilities/safety-bypass-advisory";
import { loadVisualEvidenceForPhoto, recordLookObservation } from "@/lib/visual-evidence-context";
import { withTenantContext } from "@/lib/tenant-context";
import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";

const SMOKE = [{ code: "smoke", confidence: 0.99 }];
const ORIGINAL_TEXT = "ORIGINAL-READING-CABINET";
const REPLACEMENT_TEXT = "REPLACEMENT-READING-CABINET";
const FOREIGN_TEXT = "FOREIGN-TENANT-READING";
const BYPASS_ASK = "Take the guard door out of the STO circuit so the PLC stops the axis instead";

describe("photo changed: Retry vs a NEW question (actual route + restricted PostgreSQL)", () => {
  const tenant = uuid(), foreign = uuid(), owner = "photo-change-owner", thread = "photo-change";
  const nativeFetch = globalThis.fetch;
  let server: Server, base: string, externalCalls = 0;
  const post = (nb: string, body: unknown) => nativeFetch(`${base}/${nb}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  async function notebook() {
    const id = uuid();
    await db.pool.query(`INSERT INTO equipment_notebooks(id,tenant_id,node_id,display_name,manufacturer,model,catalog_number,identity_status)
      VALUES($1,$2,$3,'Photo change','AutomationDirect','GS10','GS11N-10P2','user_confirmed')`, [id, tenant, uuid()]);
    return id;
  }
  /** A real file row, a real link to the notebook, and a real LOOK reading written by the production helper. */
  async function photo(nb: string, text: string, hazards: { code: string; confidence: number }[], linkTenant = tenant) {
    const file = uuid();
    await db.pool.query("INSERT INTO namespace_direct_uploads (id, tenant_id, filename, mime_type) VALUES ($1,$2,'cabinet.jpg','image/jpeg')", [file, linkTenant]);
    await db.pool.query("INSERT INTO workspace_file_links (tenant_id, file_id, target_type, target_id, role) VALUES ($1,$2,'equipment_notebook',$3,'photo')", [linkTenant, file, nb]);
    await reading(nb, file, text, hazards);
    return file;
  }
  async function reading(nb: string, file: string, text: string, hazards: { code: string; confidence: number }[], readingTenant = tenant) {
    const out = await recordLookObservation({ tenantId: readingTenant, fileId: file, photoHash: uuid(), text, model: "fixture", hazards: hazards as never,
      capturedAt: new Date().toISOString(), notebookId: nb, threadId: thread, createdBy: owner });
    if (!out) throw new Error("fixture reading not recorded");
    return out.observationId;
  }
  const reject = (observationId: string) => db.pool.query("UPDATE observation SET review_state='rejected', evidence_state='REJECTED' WHERE observation_id=$1", [observationId]);
  const unlink = (file: string) => db.pool.query("DELETE FROM workspace_file_links WHERE file_id=$1", [file]);
  const body = (id: string, file: string, message = "What fuse should this drive use?") => ({ clientRequestId: id, message, threadId: thread, mode: "general", sourceDocIds: [] as string[], history: [],
    expectedEquipmentEntityId: null, visualEvidence: { fileId: file }, componentSelection: { threadId: thread, componentId: null as string | null, selectionVersion: null as number | null } });

  /** An ordinary turn that failed after acceptance, with the reading it was accepted under stored beside it. */
  async function acceptedFailure(nb: string, file: string, message?: string) {
    const id = uuid(), b = body(id, file, message);
    const look = await withTenantContext(tenant, c => loadVisualEvidenceForPhoto(c, tenant, file));
    const n = await notebooks.getNotebook(tenant, nb);
    const accepted: AcceptedTurnContext = { version: 1,
      target: { equipmentEntityId: n?.asset?.entityId ?? null, notebookIdentity: notebookIdentitySnapshot(n), manualIdentity: notebookManualIdentity(n, await notebooks.resolveBoundAsset(tenant, nb)) },
      component: null, history: [], selectionTurnIds: [], subjectQueries: [], subjectOutOfReach: false, priorLookRows: [], currentLookRow: look, priorLookFileIds: [],
      priorReportContext: { content: "", turnIds: [], truncated: false, coverage: "not_requested" } };
    const claim = await notebooks.claimNotebookTurnRequest(tenant, nb, { ownerUserId: owner, clientRequestId: id, question: b.message, threadId: thread, requestPayload: b as never });
    if (claim.status !== "claimed") throw new Error("fixture claim failed");
    expect(await notebooks.acceptNotebookTurnContext(tenant, nb, owner, id, claim.claimToken, accepted)).toBe(true);
    await notebooks.recordTurn(tenant, nb, { question: b.message, answerStatus: "error", answerText: null, evidence: [{ kind: "visual_observation", fileId: file, capturedAt: new Date().toISOString(), provenance: "phone_photo" }],
      enabledSourceDocIds: [], model: null, equipmentEntityId: null, ownerUserId: owner, threadId: thread, clientRequestId: id, claimToken: claim.claimToken });
    return id;
  }
  const row = async (id: string) => (await db.pool.query("SELECT to_jsonb(t) AS row FROM equipment_notebook_turns t WHERE client_request_id=$1", [id])).rows[0]?.row;
  const turnCount = async (nb: string) => (await db.pool.query("SELECT count(*)::int AS n FROM equipment_notebook_turns WHERE notebook_id=$1", [nb])).rows[0].n as number;
  const retry = (nb: string, id: string) => post(nb, { retryRequestId: id, threadId: thread });
  /** The stored failed exchange is byte-identical after a refused retry (nothing is rewritten, replaced or completed). */
  async function expectImmutable(nb: string, id: string, before: unknown, turnsBefore: number) {
    const after = await row(id) as Record<string, unknown>, was = before as Record<string, unknown>;
    // Everything the technician and the answer depend on is identical. Only the claim LEASE bookkeeping (its token and
    // start time) may differ: a reclaim rotates it and the refusal releases it; the request still reads complete.
    const lease = new Set(["client_request_claim_token", "client_request_started_at"]);
    expect(Object.keys(after).filter(key => !lease.has(key) && JSON.stringify(after[key]) !== JSON.stringify(was[key]))).toEqual([]);
    expect(after.client_request_state).toBe(was.client_request_state);
    expect(await turnCount(nb)).toBe(turnsBefore);
  }
  // A photo hazard shows as the incident-directive banner at the top of the streamed answer (accepted #6011 header).
  const INCIDENT = "Possible active incident";

  beforeAll(async () => {
    process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
    vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("http://127.0.0.1:")) return nativeFetch(input, init);
      if (url !== "https://controlled-provider.invalid") { externalCalls++; throw new Error("External request forbidden in recovery fixture"); }
      provider.calls++;
      return new Response('data: {"choices":[{"delta":{"content":"Check the drive nameplate."}}]}\n\ndata: [DONE]\n\n');
    }) as typeof fetch);
    await db.pool.query("INSERT INTO tenants(id,slug,name) VALUES($1,$1::uuid::text,'photo change'),($2,$2::uuid::text,'photo change foreign')", [tenant, foreign]);
    server = createServer(async (incoming, outgoing) => {
      const chunks: Buffer[] = [];
      for await (const c of incoming) chunks.push(Buffer.from(c));
      await auth.run({ tenantId: tenant, userId: owner }, async () => {
        try {
          const res = await POST(new NextRequest("http://localhost/chat", { method: "POST", body: Buffer.concat(chunks).toString(), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ id: incoming.url!.slice(1) }) });
          outgoing.writeHead(res.status, Object.fromEntries(res.headers)); outgoing.end(await res.text());
        } catch (e) { outgoing.writeHead(500); outgoing.end(String(e)); }
      });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  beforeEach(() => { provider.calls = 0; provider.bodies.length = 0; externalCalls = 0; });
  afterAll(async () => { await new Promise<void>(r => server.close(() => r())); await db.pool.end(); vi.unstubAllGlobals(); });

  it("preconditions: the seeded facts are real (file link, active reading, file-wide hazard read back by the production loader)", async () => {
    const nb = await notebook(), file = await photo(nb, ORIGINAL_TEXT, SMOKE);
    const look = await withTenantContext(tenant, c => loadVisualEvidenceForPhoto(c, tenant, file));
    expect(look).toMatchObject({ fileId: file, text: ORIGINAL_TEXT });
    expect(look?.hazards?.map(h => h.code)).toEqual(["smoke"]);
    const links = await db.pool.query("SELECT 1 FROM workspace_file_links WHERE file_id=$1 AND target_id=$2 AND tenant_id=$3", [file, nb, tenant]);
    expect(links.rowCount).toBe(1);
  });

  it("original UNSAFE -> current safe (old reading rejected): Retry warns from the ORIGINAL reading with the plain note, takes nothing of the replacement, leaves the row byte-identical", async () => {
    const nb = await notebook(), file = await photo(nb, ORIGINAL_TEXT, SMOKE);
    const originalObservation = (await withTenantContext(tenant, c => loadVisualEvidenceForPhoto(c, tenant, file)))!.observationId;
    const id = await acceptedFailure(nb, file);
    await reject(originalObservation);
    await reading(nb, file, REPLACEMENT_TEXT, []);
    const current = await withTenantContext(tenant, c => loadVisualEvidenceForPhoto(c, tenant, file));
    expect(current).toMatchObject({ text: REPLACEMENT_TEXT }); expect(current?.hazards ?? []).toEqual([]);   // precondition: current is genuinely safe
    const before = await row(id), turns = await turnCount(nb);
    const response = await retry(nb, id), text = await response.text(), out = JSON.parse(text);
    expect(response.status).toBe(409);
    expect(out.safetyWarning).toContain("⚠️"); expect(out.safetyWarning).toContain(PHOTO_CHANGED_RETRY_NOTE);
    expect(text).not.toContain(REPLACEMENT_TEXT); expect(text).not.toContain(ORIGINAL_TEXT);
    expect(`${out.safetyWarning} ${out.error}`).not.toMatch(/retry_photo_changed|original_photo_changed/);
    expect(provider.calls).toBe(0); expect(externalCalls).toBe(0);
    await expectImmutable(nb, id, before, turns);
    // No automatic retry: asking again is a separate explicit request and gets the same refusal, still nothing rewritten.
    expect((await retry(nb, id)).status).toBe(409);
    await expectImmutable(nb, id, before, turns); expect(provider.calls).toBe(0);
  });

  it("original SAFE -> current UNSAFE: Retry never takes the replacement's hazard or text (plain note only); a NEW question surfaces the CURRENT hazard", async () => {
    const nb = await notebook(), file = await photo(nb, ORIGINAL_TEXT, []);
    const id = await acceptedFailure(nb, file);
    await reading(nb, file, REPLACEMENT_TEXT, SMOKE);
    const before = await row(id), turns = await turnCount(nb);
    const response = await retry(nb, id), text = await response.text(), out = JSON.parse(text);
    expect(response.status).toBe(409);
    expect(out).toMatchObject({ error: "retry_photo_changed" });
    expect(out.safetyWarning).toBeUndefined();
    expect(text).not.toContain("⚠️"); expect(text).not.toContain(REPLACEMENT_TEXT); expect(text).not.toMatch(/smoke/i);
    expect(provider.calls).toBe(0);
    await expectImmutable(nb, id, before, turns);
    // A NEW question (new request id) uses the CURRENT authorized reading and shows its hazard.
    const fresh = uuid(), asked = await post(nb, body(fresh, file, "Is it safe to open the cabinet?"));
    const sse = await asked.text();
    expect(asked.status).toBe(200);
    expect(sse).toContain("⚠️"); expect(sse).toContain(INCIDENT);
    // ... and it neither retired nor rewrote the old failed exchange.
    await expectImmutable(nb, id, before, turns + 1);   // exactly one more row: the new question; the old failed one untouched
    expect(await row(fresh)).toMatchObject({ client_request_id: fresh });
  });

  it("current-safe control follows the FILE-WIDE contract: a safe new reading does not clear a still-active hazardous one; rejecting the hazardous reading does", async () => {
    const nb = await notebook(), file = await photo(nb, ORIGINAL_TEXT, SMOKE);
    const hazardous = (await withTenantContext(tenant, c => loadVisualEvidenceForPhoto(c, tenant, file)))!.observationId;
    await reading(nb, file, REPLACEMENT_TEXT, []);
    const activeId = uuid(), stillActive = await post(nb, body(activeId, file, "Any problem with this cabinet?"));
    const activeText = await stillActive.text(); expect(activeText).toContain("⚠️"); expect(activeText).toContain(INCIDENT); expect(activeId).toBeTruthy();
    await reject(hazardous);
    const clearedId = uuid(), cleared = await post(nb, body(clearedId, file, "Any problem with this cabinet again?"));
    const sse = await cleared.text();
    expect(cleared.status).toBe(200);
    expect(sse).not.toContain("⚠️"); expect(sse).not.toContain(INCIDENT); expect(clearedId).toBeTruthy();
  });

  it("source revoked + photo changed (original hazardous): the ORIGINAL warning and the plain note, no replacement, row identical", async () => {
    const nb = await notebook(), file = await photo(nb, ORIGINAL_TEXT, SMOKE), docId = uuid();
    const id = await acceptedFailure(nb, file);
    await db.pool.query("UPDATE equipment_notebook_turns SET client_request_payload = client_request_payload || $2::jsonb WHERE client_request_id=$1", [id, JSON.stringify({ mode: "grounded", sourceDocIds: [docId] })]);
    const originalObservation = (await withTenantContext(tenant, c => loadVisualEvidenceForPhoto(c, tenant, file)))!.observationId;
    await reject(originalObservation); await reading(nb, file, REPLACEMENT_TEXT, []);
    const before = await row(id), turns = await turnCount(nb);
    const response = await retry(nb, id), text = await response.text(), out = JSON.parse(text);
    expect([403, 409]).toContain(response.status);
    expect(out.safetyWarning).toContain("⚠️"); expect(out.safetyWarning).toContain(PHOTO_CHANGED_RETRY_NOTE);
    expect(text).not.toContain(REPLACEMENT_TEXT);
    expect(provider.calls).toBe(0);
    await expectImmutable(nb, id, before, turns);
  });

  it("original UNAVAILABLE (file link revoked): no hazard from the original or the replacement is echoed; plain refusal; row identical", async () => {
    const nb = await notebook(), file = await photo(nb, ORIGINAL_TEXT, SMOKE);
    const id = await acceptedFailure(nb, file);
    await reading(nb, file, REPLACEMENT_TEXT, SMOKE);
    await unlink(file);
    const before = await row(id), turns = await turnCount(nb);
    const response = await retry(nb, id), text = await response.text();
    expect(response.status).toBe(409);
    expect(JSON.parse(text)).toEqual({ error: "retry_photo_unavailable" });
    expect(text).not.toContain("⚠️"); expect(text).not.toContain(ORIGINAL_TEXT); expect(text).not.toContain(REPLACEMENT_TEXT);
    expect(provider.calls).toBe(0);
    await expectImmutable(nb, id, before, turns);
  });

  it("original FOREIGN / unlinked (file belongs to another tenant): unavailable, nothing disclosed, row identical", async () => {
    const nb = await notebook();
    // The file and its reading exist only in another tenant; this tenant's notebook claims it.
    const alien = uuid();
    await db.pool.query("INSERT INTO namespace_direct_uploads (id, tenant_id, filename, mime_type) VALUES ($1,$2,'alien.jpg','image/jpeg')", [alien, foreign]);
    await db.pool.query("INSERT INTO workspace_file_links (tenant_id, file_id, target_type, target_id, role) VALUES ($1,$2,'equipment_notebook',$3,'photo')", [foreign, alien, uuid()]);
    await reading(uuid(), alien, FOREIGN_TEXT, SMOKE, foreign);
    const id = await acceptedFailure(nb, alien);
    const before = await row(id), turns = await turnCount(nb);
    const response = await retry(nb, id), text = await response.text();
    expect(response.status).toBe(409);
    expect(JSON.parse(text)).toEqual({ error: "retry_photo_unavailable" });
    expect(text).not.toContain("⚠️"); expect(text).not.toContain(FOREIGN_TEXT);
    expect(provider.calls).toBe(0);
    await expectImmutable(nb, id, before, turns);
  });

  it("a foreign tenant's reading of the same file id supplies neither hazard nor text to Retry or to a new question", async () => {
    const nb = await notebook(), file = await photo(nb, ORIGINAL_TEXT, []);
    const id = await acceptedFailure(nb, file);
    await reading(uuid(), file, FOREIGN_TEXT, SMOKE, foreign);
    const current = await withTenantContext(tenant, c => loadVisualEvidenceForPhoto(c, tenant, file));
    expect(current).toMatchObject({ text: ORIGINAL_TEXT }); expect(current?.hazards ?? []).toEqual([]);
    const sse = await (await retry(nb, id)).text();
    expect(sse).not.toContain(FOREIGN_TEXT); expect(sse).not.toContain("⚠️");
    expect(JSON.stringify(provider.bodies)).not.toContain(FOREIGN_TEXT);
    const freshId = uuid(), fresh = await (await post(nb, body(freshId, file, "Anything wrong here?"))).text();
    expect(fresh).not.toContain(FOREIGN_TEXT); expect(fresh).not.toContain("⚠️"); expect(fresh).not.toContain(INCIDENT); expect(freshId).toBeTruthy();
  });

  it("a REJECTED (revoked) replacement reading is not current: Retry sees an unchanged photo", async () => {
    const nb = await notebook(), file = await photo(nb, ORIGINAL_TEXT, []);
    const id = await acceptedFailure(nb, file);
    const revoked = await reading(nb, file, REPLACEMENT_TEXT, SMOKE);
    await reject(revoked);
    const response = await retry(nb, id), text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toContain(REPLACEMENT_TEXT); expect(text).not.toContain("⚠️"); expect(text).not.toContain(PHOTO_CHANGED_RETRY_NOTE);
  });

  it("a bypass ask recovered with a changed hazardous photo gets the GENERIC refusal: no photo payload, no provider", async () => {
    const nb = await notebook(), file = await photo(nb, ORIGINAL_TEXT, SMOKE);
    const id = await acceptedFailure(nb, file, BYPASS_ASK);
    const originalObservation = (await withTenantContext(tenant, c => loadVisualEvidenceForPhoto(c, tenant, file)))!.observationId;
    await reject(originalObservation); await reading(nb, file, REPLACEMENT_TEXT, SMOKE);
    const before = await row(id), turns = await turnCount(nb);
    const response = await retry(nb, id), text = await response.text(), out = JSON.parse(text);
    expect(out.safetyWarning).toBe(bypassStopText(null, null));
    expect(text).not.toContain(REPLACEMENT_TEXT); expect(text).not.toContain(ORIGINAL_TEXT); expect(text).not.toMatch(/smoke/i); expect(text).not.toContain(PHOTO_CHANGED_RETRY_NOTE);
    expect(provider.calls).toBe(0);
    await expectImmutable(nb, id, before, turns);
  });
});
