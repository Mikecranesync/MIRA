/** Mission 001 observation routes: flag, storage-missing, preview-only, and input rules. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const ENTITY = "cmms-pump07";
const UNS = "enterprise.lw.line1.pump07";
const REQ_ID = "33333333-3333-4333-8333-333333333333";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "tech-1" })),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));

const nb = vi.hoisted(() => ({
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(),
}));
vi.mock("@/lib/equipment-notebooks", () => nb);

const store = vi.hoisted(() => ({
  insertObservation: vi.fn(),
  listObservationsForAsset: vi.fn(),
}));
vi.mock("@/capabilities/observations/store", () => store);

import { POST as POST_OBS, GET as GET_OBS } from "../../../app/api/equipment-notebooks/[id]/observations/route";
import { POST as POST_PREVIEW } from "../../../app/api/equipment-notebooks/[id]/observations/preview/route";

const params = { params: Promise.resolve({ id: NB }) };
const confirmed = { state: "resolved", entityId: ENTITY, name: "Pump 07", unsPath: UNS, selectedVia: "manual", confirmedAt: "2026-06-15T09:00:00.000Z" };

function req(url: string, method: string, body?: unknown) {
  return new NextRequest(`http://test${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function validBody(over: Record<string, unknown> = {}) {
  return {
    confirmed: true,
    factKey: "seal_leak",
    factValue: "present",
    observedAt: new Date(Date.now() - 60_000).toISOString(),
    rawReport: "seal leaking",
    clientRequestId: REQ_ID,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MIRA_OBSERVATION_STATE = "1";
  nb.getNotebook.mockResolvedValue({ id: NB, displayName: "Pump 07" });
  nb.resolveBoundAsset.mockResolvedValue(confirmed);
  store.listObservationsForAsset.mockResolvedValue([]);
  store.insertObservation.mockResolvedValue({
    status: "created",
    observation: { id: "o1", factKey: "seal_leak", factValue: "present", observedAt: "x", recordedAt: "y", recordedBy: "tech-1", verificationMethod: "self_reported", uncertainty: "unverified", supersedesId: null, rawReport: "seal leaking", equipmentEntityId: ENTITY, assetUnsPath: UNS },
    eventId: "e1",
    sequence: 1,
  });
});

describe("observation routes: flag", () => {
  it("flag off ⇒ 404 observations_disabled on POST, GET and preview", async () => {
    delete process.env.MIRA_OBSERVATION_STATE;
    for (const res of [
      await POST_OBS(req(`/api/equipment-notebooks/${NB}/observations`, "POST", validBody()), params),
      await GET_OBS(req(`/api/equipment-notebooks/${NB}/observations`, "GET"), params),
      await POST_PREVIEW(req(`/api/equipment-notebooks/${NB}/observations/preview`, "POST", { text: "seal leaking" }), params),
    ]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "observations_disabled" });
    }
    expect(store.insertObservation).not.toHaveBeenCalled();
  });
});

describe("observation routes: storage missing", () => {
  it("flag on + table missing (42P01) ⇒ 503 observations_unavailable", async () => {
    store.insertObservation.mockRejectedValue(Object.assign(new Error('relation "asset_observations" does not exist'), { code: "42P01" }));
    store.listObservationsForAsset.mockRejectedValue(Object.assign(new Error("missing"), { code: "42P01" }));

    const post = await POST_OBS(req(`/api/equipment-notebooks/${NB}/observations`, "POST", validBody()), params);
    expect(post.status).toBe(503);
    expect(await post.json()).toEqual({ error: "observations_unavailable" });

    const get = await GET_OBS(req(`/api/equipment-notebooks/${NB}/observations`, "GET"), params);
    expect(get.status).toBe(503);
    expect(await get.json()).toEqual({ error: "observations_unavailable" });
  });
});

describe("observation routes: preview never writes", () => {
  it("returns the preview and the server binding, and writes nothing", async () => {
    const res = await POST_PREVIEW(
      req(`/api/equipment-notebooks/${NB}/observations/preview`, "POST", { text: "seal leaking at 09:10" }),
      params,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preview).toMatchObject({ factKey: "seal_leak", factValue: "present" });
    expect(body.preview.observedAt).toEqual(expect.any(String));
    expect(body.asset).toEqual({ equipmentEntityId: ENTITY, displayName: "Pump 07", unsPath: UNS });
    expect(store.insertObservation).not.toHaveBeenCalled();
  });

  it("an unconfirmed binding is refused with 409 asset_not_confirmed", async () => {
    nb.resolveBoundAsset.mockResolvedValue({ ...confirmed, confirmedAt: null });
    const res = await POST_PREVIEW(
      req(`/api/equipment-notebooks/${NB}/observations/preview`, "POST", { text: "seal leaking" }),
      params,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "asset_not_confirmed" });
  });
});

describe("observation routes: input rules", () => {
  it("missing confirmed → 400 confirmation_required (complete except the field under test)", async () => {
    const body = validBody();
    delete (body as Record<string, unknown>).confirmed;
    const res = await POST_OBS(req(`/api/equipment-notebooks/${NB}/observations`, "POST", body), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "confirmation_required" });
    expect(store.insertObservation).not.toHaveBeenCalled();
  });

  it("future observed time → 400 observed_at_in_future (complete except the field under test)", async () => {
    const res = await POST_OBS(
      req(`/api/equipment-notebooks/${NB}/observations`, "POST", validBody({ observedAt: new Date(Date.now() + 3_600_000).toISOString() })),
      params,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "observed_at_in_future" });
  });

  it("a control: the complete, valid body is recorded (201) against the server binding", async () => {
    const res = await POST_OBS(req(`/api/equipment-notebooks/${NB}/observations`, "POST", validBody()), params);
    expect(res.status).toBe(201);
    expect(store.insertObservation).toHaveBeenCalledWith(TENANT, NB, ENTITY, UNS, expect.objectContaining({ factKey: "seal_leak", verificationMethod: "self_reported" }), "tech-1");
  });

  it("a client-claimed machine that differs from the binding → 409 asset_mismatch", async () => {
    const res = await POST_OBS(
      req(`/api/equipment-notebooks/${NB}/observations`, "POST", validBody({ equipmentEntityId: "cmms-other" })),
      params,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "asset_mismatch" });
    expect(store.insertObservation).not.toHaveBeenCalled();
  });
});
