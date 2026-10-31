// GET/POST /api/equipment-notebooks/[id]/fixes — "plant memory" (095 +
// capabilities/fix-records.ts): a technician records what fixed this
// machine; the next technician on the same machine sees it as a grounding
// source. Append-only.
//
// Run: cd mira-hub && npx vitest run src/app/api/equipment-notebooks/[id]/__tests__/fixes
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/equipment-notebooks", () => ({ getNotebook: vi.fn() }));
vi.mock("@/capabilities/fix-records", () => ({
  insertFixRecord: vi.fn(),
  listFixRecords: vi.fn(),
  validateFixInput: vi.fn(),
  // Same shape as the real isUuid (unit-tested in fix-records.test.ts).
  isUuid: (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
}));

// #5020: the route reads delivery state through the dispatch module; mock it so
// the GET tests stay DB-free and pin the additive `delivery` field.
const dispatchMock = vi.hoisted(() => ({ deliveryStatusForFixRecords: vi.fn(async () => new Map()) }));
vi.mock("@/capabilities/cmms-dispatch", () => dispatchMock);

import { GET, POST } from "../fixes/route";
import { sessionOr401 } from "@/lib/session";
import { getNotebook } from "@/lib/equipment-notebooks";
import { insertFixRecord, listFixRecords, validateFixInput } from "@/capabilities/fix-records";

const NB = "11111111-2222-3333-4444-555555555555";
const TENANT = "00000000-0000-0000-0000-0000000000d1";

function req(body?: unknown, query = ""): NextRequest {
  return {
    url: `http://test/api/equipment-notebooks/${NB}/fixes/${query}`,
    json: async () => {
      if (body === undefined) throw new SyntaxError("Unexpected end of JSON input");
      return body;
    },
  } as unknown as NextRequest;
}

const params = { params: Promise.resolve({ id: NB }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sessionOr401).mockResolvedValue({
    userId: "u_1",
    tenantId: TENANT,
    email: "tech@example.com",
    status: "trial",
    trialExpiresAt: null,
    role: "owner",
  } as never);
});

describe("GET /api/equipment-notebooks/[id]/fixes", () => {
  it("401s without a session", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(sessionOr401).mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }) as never);
    const res = await GET(req(), params);
    expect(res.status).toBe(401);
    expect(getNotebook).not.toHaveBeenCalled();
  });

  it("404s notebook_not_found when the notebook isn't the caller's", async () => {
    vi.mocked(getNotebook).mockResolvedValue(null as never);
    const res = await GET(req(), params);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "notebook_not_found" });
    expect(listFixRecords).not.toHaveBeenCalled();
  });

  it("returns one page and the cursor for the next", async () => {
    vi.mocked(getNotebook).mockResolvedValue({ id: NB, asset: null } as never);
    const fixes = [{ id: "f1", notebookId: NB, symptom: "s", fix: "f" }];
    vi.mocked(listFixRecords).mockResolvedValue({ fixes, nextCursor: "f1" } as never);
    const res = await GET(req(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      fixes: fixes.map((f: Record<string, unknown>) => ({ ...f, delivery: null })),
      nextCursor: "f1",
      assetConfirmed: null,
    });
    expect(listFixRecords).toHaveBeenCalledWith(TENANT, NB, { limit: undefined, before: null });
  });

  it("passes a valid cursor and limit through (the machine scope is read in the same query)", async () => {
    const asset = { entityId: "e1", selectedVia: "qr", confirmedBy: "u1", confirmedAt: "2026-09-01T00:00:00Z" };
    vi.mocked(getNotebook).mockResolvedValue({ id: NB, asset } as never);
    vi.mocked(listFixRecords).mockResolvedValue({ fixes: [], nextCursor: null } as never);
    const before = "99999999-9999-4999-8999-999999999999";
    const res = await GET(req(undefined, `?before=${before}&limit=5`), params);
    expect(await res.json()).toEqual({ fixes: [], nextCursor: null, assetConfirmed: true });
    expect(listFixRecords).toHaveBeenCalledWith(TENANT, NB, { limit: 5, before });
  });

  it("GET attaches the per-record delivery state when the outbox has one (#5020)", async () => {
    vi.mocked(getNotebook).mockResolvedValue({ id: NB, asset: null } as never);
    const fixes = [{ id: "f9", symptom: "s", fix: "f" }];
    vi.mocked(listFixRecords).mockResolvedValue({ fixes, nextCursor: null } as never);
    const state = { eventId: "ev9", state: "verified_by_readback", externalRef: "4711", attempts: 1, updatedAt: "2026-10-31T06:00:00Z" };
    dispatchMock.deliveryStatusForFixRecords.mockResolvedValueOnce(new Map([["f9", state]]) as never);
    const res = await GET(req(), params);
    expect(await res.json()).toEqual({ fixes: [{ ...fixes[0], delivery: state }], nextCursor: null, assetConfirmed: null });
    expect(dispatchMock.deliveryStatusForFixRecords).toHaveBeenCalledWith(TENANT, ["f9"]);
  });

  it("GET still lists fixes when the delivery lookup fails (never fails the list because of the outbox)", async () => {
    vi.mocked(getNotebook).mockResolvedValue({ id: NB, asset: null } as never);
    const fixes = [{ id: "f8", symptom: "s", fix: "f" }];
    vi.mocked(listFixRecords).mockResolvedValue({ fixes, nextCursor: null } as never);
    dispatchMock.deliveryStatusForFixRecords.mockRejectedValueOnce(new Error("outbox down"));
    const res = await GET(req(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ fixes: [{ ...fixes[0], delivery: null }], nextCursor: null, assetConfirmed: null });
  });

  it("400s a malformed cursor instead of passing it to the database", async () => {
    vi.mocked(getNotebook).mockResolvedValue({ id: NB, asset: null } as never);
    const res = await GET(req(undefined, "?before=not-a-uuid"), params);
    expect(res.status).toBe(400);
    expect(listFixRecords).not.toHaveBeenCalled();
  });

  it("404s a malformed notebook id without querying (post-split F4)", async () => {
    const res = await GET(req(), { params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "notebook_not_found" });
    expect(getNotebook).not.toHaveBeenCalled();
  });

  it("exposes no repair history for a selected-but-unconfirmed machine (QR)", async () => {
    const asset = { entityId: "e1", selectedVia: "qr", confirmedBy: null, confirmedAt: null };
    vi.mocked(getNotebook).mockResolvedValue({ id: NB, asset } as never);
    vi.mocked(listFixRecords).mockClear();
    const res = await GET(req(), params);
    expect(await res.json()).toEqual({ fixes: [], assetConfirmed: false });
    expect(listFixRecords).not.toHaveBeenCalled();
  });
});

describe("POST /api/equipment-notebooks/[id]/fixes", () => {
  it("409s a machine-scoped fix while the machine is only selected, not confirmed", async () => {
    const asset = { entityId: "e1", selectedVia: "qr", confirmedBy: null, confirmedAt: null };
    vi.mocked(getNotebook).mockResolvedValue({ id: NB, asset } as never);
    vi.mocked(insertFixRecord).mockClear();
    const res = await POST(req({ symptom: "trips oC", fix: "raised accel" }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("asset_not_confirmed");
    expect(insertFixRecord).not.toHaveBeenCalled();
  });

  it("401s without a session", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(sessionOr401).mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }) as never);
    const res = await POST(req({ symptom: "s", fix: "f" }), params);
    expect(res.status).toBe(401);
    expect(getNotebook).not.toHaveBeenCalled();
  });

  it("404s notebook_not_found when the notebook isn't the caller's", async () => {
    vi.mocked(getNotebook).mockResolvedValue(null as never);
    const res = await POST(req({ symptom: "s", fix: "f" }), params);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "notebook_not_found" });
    expect(validateFixInput).not.toHaveBeenCalled();
  });

  it("400s invalid_json on unparsable body", async () => {
    vi.mocked(getNotebook).mockResolvedValue({ id: NB, asset: null } as never);
    const res = await POST(req(undefined), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
    expect(validateFixInput).not.toHaveBeenCalled();
  });

  it("400s with the validator's error when the body is invalid", async () => {
    vi.mocked(getNotebook).mockResolvedValue({ id: NB, asset: null } as never);
    vi.mocked(validateFixInput).mockReturnValue({ ok: false, error: "symptom_required" });
    const res = await POST(req({ fix: "f" }), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "symptom_required" });
    expect(insertFixRecord).not.toHaveBeenCalled();
  });

  const VALUE = { symptom: "s", fix: "f", faultCode: null, sourceTurnId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", clientRequestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
  const CONFIRMED_NB = {
    id: NB,
    asset: { entityId: "asset-123", name: "Conveyor 1", confirmedAt: "2026-09-01T00:00:00Z" },
  };
  // #5020: the enqueue outcome insertFixRecord returns for a created record
  // when no CMMS connection has opted in.
  const SAVED_EVENT = { eventId: "ev1", sequence: 1, replayed: false, delivery: { deliveryId: null, reason: "no_connection" } };

  it("201s and inserts atomically against the notebook's current binding", async () => {
    vi.mocked(getNotebook).mockResolvedValue(CONFIRMED_NB as never);
    vi.mocked(validateFixInput).mockReturnValue({ ok: true, value: VALUE });
    const created = { id: "f1", notebookId: NB, equipmentEntityId: "asset-123", symptom: "s", fix: "f" };
    vi.mocked(insertFixRecord).mockResolvedValue({ status: "created", fix: created, event: SAVED_EVENT } as never);
    const res = await POST(req({ symptom: "s", fix: "f" }), params);
    expect(res.status).toBe(201);
    // #5020: no CMMS connection opted in → the record is saved, nothing leaves.
    expect(await res.json()).toEqual({ fix: created, delivery: { state: "saved", eventId: "ev1", reason: "no_connection" } });
    expect(insertFixRecord).toHaveBeenCalledWith(TENANT, NB, "asset-123", VALUE, "u_1");
  });

  it("200s with the stored record for an idempotent retry (post-split F2)", async () => {
    vi.mocked(getNotebook).mockResolvedValue(CONFIRMED_NB as never);
    vi.mocked(validateFixInput).mockReturnValue({ ok: true, value: VALUE });
    const stored = { id: "f1", notebookId: NB, symptom: "s", fix: "f" };
    vi.mocked(insertFixRecord).mockResolvedValue({ status: "existing", fix: stored } as never);
    const res = await POST(req({ symptom: "s", fix: "f" }), params);
    expect(res.status).toBe(200);
    // A replayed save reports no new delivery: its event already exists.
    expect(await res.json()).toEqual({ fix: stored, delivery: null });
  });

  it("201s with delivery=queued when the tenant's CMMS connection opted in (#5020)", async () => {
    vi.mocked(getNotebook).mockResolvedValue(CONFIRMED_NB as never);
    vi.mocked(validateFixInput).mockReturnValue({ ok: true, value: VALUE });
    const created = { id: "f2", notebookId: NB, equipmentEntityId: "asset-123", symptom: "s", fix: "f" };
    vi.mocked(insertFixRecord).mockResolvedValue({
      status: "created",
      fix: created,
      event: { eventId: "ev2", sequence: 2, replayed: false, delivery: { deliveryId: "d1", state: "queued" } },
    } as never);
    const res = await POST(req({ symptom: "s", fix: "f" }), params);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ fix: created, delivery: { state: "queued", eventId: "ev2" } });
  });

  it("409s when the binding changed between check and insert (post-split F1)", async () => {
    vi.mocked(getNotebook).mockResolvedValue(CONFIRMED_NB as never);
    vi.mocked(validateFixInput).mockReturnValue({ ok: true, value: VALUE });
    vi.mocked(insertFixRecord).mockResolvedValue({ status: "binding_changed" } as never);
    const res = await POST(req({ symptom: "s", fix: "f" }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("asset_binding_changed");
  });

  it("409s a request id reused for a different fix (post-hardening F2)", async () => {
    vi.mocked(getNotebook).mockResolvedValue(CONFIRMED_NB as never);
    vi.mocked(validateFixInput).mockReturnValue({ ok: true, value: VALUE });
    vi.mocked(insertFixRecord).mockResolvedValue({ status: "request_id_conflict" } as never);
    const res = await POST(req({ symptom: "s", fix: "f" }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("request_id_conflict");
  });

  it("404s an answer turn that is not in this notebook (Codex #4058 post-cap F1)", async () => {
    vi.mocked(getNotebook).mockResolvedValue(CONFIRMED_NB as never);
    vi.mocked(validateFixInput).mockReturnValue({ ok: true, value: VALUE });
    vi.mocked(insertFixRecord).mockResolvedValue({ status: "source_turn_not_found" } as never);
    const res = await POST(req({ symptom: "s", fix: "f" }), params);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("source_turn_not_found");
  });

  it("409s an answer served for a different machine (Codex #4058 post-cap F1)", async () => {
    vi.mocked(getNotebook).mockResolvedValue(CONFIRMED_NB as never);
    vi.mocked(validateFixInput).mockReturnValue({ ok: true, value: VALUE });
    vi.mocked(insertFixRecord).mockResolvedValue({ status: "answer_machine_mismatch" } as never);
    const res = await POST(req({ symptom: "s", fix: "f" }), params);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("answer_machine_mismatch");
    expect(body.message).toMatch(/different machine/);
  });

  it("expects no binding when the notebook has none", async () => {
    vi.mocked(getNotebook).mockResolvedValue({ id: NB, asset: null } as never);
    vi.mocked(validateFixInput).mockReturnValue({ ok: true, value: VALUE });
    vi.mocked(insertFixRecord).mockResolvedValue({ status: "created", fix: { id: "f1" }, event: SAVED_EVENT } as never);
    await POST(req({ symptom: "s", fix: "f" }), params);
    expect(insertFixRecord).toHaveBeenCalledWith(TENANT, NB, null, VALUE, "u_1");
  });

  it("404s a malformed notebook id without querying (post-split F4)", async () => {
    const res = await POST(req({ symptom: "s", fix: "f" }), { params: Promise.resolve({ id: "../x" }) });
    expect(res.status).toBe(404);
    expect(getNotebook).not.toHaveBeenCalled();
  });
});
