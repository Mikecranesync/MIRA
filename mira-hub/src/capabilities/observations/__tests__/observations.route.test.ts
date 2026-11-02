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
  listProjectionRows: vi.fn(),
  listConflictPage: vi.fn(),
  listObservationHistory: vi.fn(),
  getObservationForAsset: vi.fn(),
  HISTORY_PAGE_DEFAULT: 50,
  HISTORY_PAGE_MAX: 100,
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
  store.listProjectionRows.mockResolvedValue({ rows: [], contests: {} });
  store.listObservationHistory.mockResolvedValue({ status: "ok", rows: [], nextCursor: null });
  store.getObservationForAsset.mockResolvedValue(null);
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
    store.listProjectionRows.mockRejectedValue(Object.assign(new Error("missing"), { code: "42P01" }));

    const post = await POST_OBS(req(`/api/equipment-notebooks/${NB}/observations`, "POST", validBody()), params);
    expect(post.status).toBe(503);
    expect(await post.json()).toEqual({ error: "observations_unavailable" });

    const get = await GET_OBS(req(`/api/equipment-notebooks/${NB}/observations`, "GET"), params);
    expect(get.status).toBe(503);
    expect(await get.json()).toEqual({ error: "observations_unavailable" });
  });
});

// #5098: GET serves a bounded history page; the state comes from the bounded projection read.
describe("observation routes: GET is bounded", () => {
  const get = (qs = "") => GET_OBS(req(`/api/equipment-notebooks/${NB}/observations/${qs}`, "GET"), params);
  const row = (id: string) => ({ id, factKey: "seal_leak", factValue: "present", observedAt: "2026-06-15T09:10:00.000Z", recordedAt: "2026-06-15T09:11:00.000Z", recordedBy: "tech-1", verificationMethod: "self_reported", uncertainty: "unverified", supersedesId: null });

  it("returns the state from the projection rows, one history page and its cursor — never a full history", async () => {
    store.listProjectionRows.mockResolvedValue({ rows: [row("o1")], contests: {} });
    store.listObservationHistory.mockResolvedValue({ status: "ok", rows: [{ ...row("o1"), rawReport: "seal leaking", superseded: false }], nextCursor: "o1" });
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(store.listProjectionRows).toHaveBeenCalledWith(TENANT, ENTITY);
    expect(store.listObservationHistory).toHaveBeenCalledWith(TENANT, ENTITY, { cursor: null, limit: 50 });
    expect(body.state.facts[0]).toMatchObject({ factKey: "seal_leak", state: "leak_reported" });
    expect(body.state).not.toHaveProperty("history");
    expect(body.history.map((h: { id: string }) => h.id)).toEqual(["o1"]);
    expect(body.nextCursor).toBe("o1");
  });

  it("clamps the page size, passes the cursor, and refuses a malformed or unknown cursor", async () => {
    const CURSOR = "44444444-4444-4444-8444-444444444444";
    await get(`?limit=5000&cursor=${CURSOR}`);
    expect(store.listObservationHistory).toHaveBeenLastCalledWith(TENANT, ENTITY, { cursor: CURSOR, limit: 100 });
    await get("?limit=0");
    expect(store.listObservationHistory).toHaveBeenLastCalledWith(TENANT, ENTITY, { cursor: null, limit: 50 });

    const bad = await get("?cursor=not-a-uuid");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_cursor" });

    store.listObservationHistory.mockResolvedValue({ status: "invalid_cursor" });
    const unknown = await get(`?cursor=${CURSOR}`);
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "invalid_cursor" });
  });

  it("?observation=<id> reads back that one row on this machine, wherever it sits in history", async () => {
    const ID = "55555555-5555-4555-8555-555555555555";
    store.getObservationForAsset.mockResolvedValue({ ...row(ID), rawReport: "seal leaking", superseded: false });
    const body = await (await get(`?observation=${ID}`)).json();
    expect(store.getObservationForAsset).toHaveBeenCalledWith(TENANT, ENTITY, ID);
    expect(body.observation.id).toBe(ID);

    const res = await get("?observation=nope");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_observation_id" });
  });
});

describe("observation routes: preview never writes", () => {
  it("returns the preview and the server binding, and writes nothing", async () => {
    const res = await POST_PREVIEW(
      req(`/api/equipment-notebooks/${NB}/observations/preview`, "POST", { text: "seal leaking at 09:10", timeZone: "America/New_York" }),
      params,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preview).toMatchObject({ factKey: "seal_leak", factValue: "present" });
    expect(body.preview.observedAt).toEqual(expect.any(String));
    expect(body.asset).toEqual({ equipmentEntityId: ENTITY, displayName: "Pump 07", unsPath: UNS });
    expect(store.insertObservation).not.toHaveBeenCalled();
  });

  // #5091 Codex r2 F2: the bare time is read in the caller's zone, never a hard-coded plant zone.
  it("reads a bare time in the caller's IANA zone; no or invalid zone leaves the time for the technician", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-15T20:00:00.000Z"));
    try {
      const at = async (timeZone: unknown) => {
        const res = await POST_PREVIEW(
          req(`/api/equipment-notebooks/${NB}/observations/preview`, "POST", { text: "seal leaking at 09:10", timeZone }),
          params,
        );
        expect(res.status).toBe(200);
        return (await res.json()).preview as { observedAt: string | null; needs: string[] };
      };
      expect((await at("America/New_York")).observedAt).toBe("2026-06-15T13:10:00.000Z");
      expect((await at("America/Los_Angeles")).observedAt).toBe("2026-06-15T16:10:00.000Z");
      for (const bad of [undefined, "Mars/Base", 7]) {
        const p = await at(bad);
        expect(p.observedAt).toBeNull();
        expect(p.needs).toContain("observed_at");
      }
    } finally {
      vi.useRealTimers();
    }
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

// #5106: the conflicts a state does not list continue on GET, one bounded page at a time.
describe("observation routes: conflict continuation", () => {
  const get = (qs = "") => GET_OBS(req(`/api/equipment-notebooks/${NB}/observations/${qs}`, "GET"), params);
  const CURSOR = "55555555-5555-4555-8555-555555555555";
  const entry = { observationId: CURSOR, factValue: "absent", source: "technician", author: "tech-2", observedAt: "2026-06-15T09:00:00.000Z", recordedAt: "2026-06-15T09:01:00.000Z", verificationMethod: "self_reported", uncertainty: "unverified" };

  it("returns one page for the named fact with its own cursor, clamped like history", async () => {
    store.listObservationHistory.mockResolvedValue({ status: "ok", rows: [], nextCursor: null });
    store.listConflictPage.mockResolvedValue({ status: "ok", rows: [entry], nextCursor: CURSOR });
    const res = await get(`?conflicts=seal_leak&conflictCursor=${CURSOR}&limit=5000`);
    expect(res.status).toBe(200);
    expect(store.listConflictPage).toHaveBeenCalledWith(TENANT, ENTITY, "seal_leak", { cursor: CURSOR, limit: 100 });
    expect((await res.json()).conflicts).toEqual({ factKey: "seal_leak", rows: [entry], nextCursor: CURSOR });
  });

  it("does not page conflicts unless asked", async () => {
    store.listObservationHistory.mockResolvedValue({ status: "ok", rows: [], nextCursor: null });
    const res = await get();
    expect(store.listConflictPage).not.toHaveBeenCalled();
    expect(await res.json()).not.toHaveProperty("conflicts");
  });

  it("refuses an unknown fact, a cursor without a fact, a malformed cursor and a cursor the store rejects", async () => {
    store.listObservationHistory.mockResolvedValue({ status: "ok", rows: [], nextCursor: null });
    expect((await get("?conflicts=vibes")).status).toBe(400);
    expect((await get(`?conflictCursor=${CURSOR}`)).status).toBe(400);
    expect((await get("?conflicts=seal_leak&conflictCursor=nope")).status).toBe(400);
    expect(store.listConflictPage).not.toHaveBeenCalled();
    store.listConflictPage.mockResolvedValue({ status: "invalid_cursor" });
    const res = await get(`?conflicts=seal_leak&conflictCursor=${CURSOR}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_conflict_cursor" });
  });
});
