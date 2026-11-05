/**
 * Mocked route tests for POST/GET .../sheets/[jobId]/work-order: explicit
 * confirmation is required, the actor comes from the session, a replayed
 * request maps to 200 (not a second 202), policy-off is reported rather than
 * hidden, and job/notebook/flag gating matches the other sheet routes.
 * Pattern copied from sheets.route.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";
const EVENT_ID = "55555555-5555-4555-8555-555555555555";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "tech-1", email: "tech1@example.com" })),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));

const nb = vi.hoisted(() => ({ getNotebook: vi.fn() }));
vi.mock("@/lib/equipment-notebooks", () => nb);

const store = vi.hoisted(() => ({
  requestWorkOrder: vi.fn(),
  livingSheetStorageUnavailable: vi.fn((err: unknown) => {
    if ((err as { code?: string } | null)?.code === "42P01") {
      return { status: 503, json: async () => ({ error: "living_sheet_unavailable" }) };
    }
    return null;
  }),
}));
vi.mock("@/capabilities/living-sheet/store", () => store);

const dispatch = vi.hoisted(() => ({ deliveryStatusForWorkOrderRequest: vi.fn() }));
vi.mock("@/capabilities/cmms-dispatch", () => dispatch);

import { GET, POST } from "../../../app/api/equipment-notebooks/[id]/sheets/[jobId]/work-order/route";

const jobParams = { params: Promise.resolve({ id: NB, jobId: JOB_ID }) };

function req(method: string, body?: unknown) {
  return new NextRequest(`http://test/api/equipment-notebooks/${NB}/sheets/${JOB_ID}/work-order`, {
    method,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTEBOOK_LIVING_SHEET = "true";
  nb.getNotebook.mockResolvedValue({ id: NB });
});

describe("POST work-order", () => {
  it("requires an explicit confirm:true and never enqueues without it", async () => {
    for (const body of [{}, { confirm: "true" }, { confirm: 1 }, null]) {
      const res = await POST(req("POST", body), jobParams);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "confirmation_required" });
    }
    const bad = await POST(req("POST", "{not json"), jobParams);
    expect(bad.status).toBe(400);
    expect(store.requestWorkOrder).not.toHaveBeenCalled();
  });

  it("first request → 202 with the queued delivery; actor comes from the session", async () => {
    store.requestWorkOrder.mockResolvedValue({
      status: "enqueued",
      result: { eventId: EVENT_ID, sequence: 4, replayed: false, delivery: { deliveryId: "d-1", state: "queued" } },
    });
    const res = await POST(req("POST", { confirm: true, actorUserId: "someone-else" }), jobParams);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ eventId: EVENT_ID, replayed: false, delivery: { deliveryId: "d-1", state: "queued" } });
    expect(store.requestWorkOrder).toHaveBeenCalledWith(TENANT, NB, JOB_ID, { userId: "tech-1", label: "tech1@example.com" });
  });

  it("double tap → 200 replayed with the SAME event, not a second 202", async () => {
    store.requestWorkOrder.mockResolvedValue({
      status: "enqueued",
      result: { eventId: EVENT_ID, sequence: 4, replayed: true, delivery: { deliveryId: "d-1", state: "queued" } },
    });
    const res = await POST(req("POST", { confirm: true }), jobParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ eventId: EVENT_ID, replayed: true });
  });

  it("policy off is reported (deliveryId null + reason), not presented as sent", async () => {
    store.requestWorkOrder.mockResolvedValue({
      status: "enqueued",
      result: { eventId: EVENT_ID, sequence: 4, replayed: false, delivery: { deliveryId: null, reason: "policy_disabled" } },
    });
    const res = await POST(req("POST", { confirm: true }), jobParams);
    expect(res.status).toBe(202);
    expect((await res.json()).delivery).toEqual({ deliveryId: null, reason: "policy_disabled" });
  });

  it("unknown job → 404; unknown notebook → 404 without touching the store", async () => {
    store.requestWorkOrder.mockResolvedValue({ status: "job_not_found" });
    expect((await POST(req("POST", { confirm: true }), jobParams)).status).toBe(404);
    nb.getNotebook.mockResolvedValue(null);
    store.requestWorkOrder.mockClear();
    expect((await POST(req("POST", { confirm: true }), jobParams)).status).toBe(404);
    expect(store.requestWorkOrder).not.toHaveBeenCalled();
  });

  it("flag off → 404", async () => {
    process.env.NOTEBOOK_LIVING_SHEET = "false";
    expect((await POST(req("POST", { confirm: true }), jobParams)).status).toBe(404);
    expect(store.requestWorkOrder).not.toHaveBeenCalled();
  });

  it("storage unavailable → 503", async () => {
    store.requestWorkOrder.mockRejectedValue(Object.assign(new Error("missing"), { code: "42P01" }));
    expect((await POST(req("POST", { confirm: true }), jobParams)).status).toBe(503);
  });
});

describe("GET work-order", () => {
  it("returns null when nothing was requested, else the delivery status for this tenant + job", async () => {
    dispatch.deliveryStatusForWorkOrderRequest.mockResolvedValueOnce(null);
    expect(await (await GET(req("GET"), jobParams)).json()).toEqual({ request: null });

    const status = { eventId: EVENT_ID, requestedAt: "t0", state: "verified_by_readback", externalRef: "812", attempts: 1, updatedAt: "t1" };
    dispatch.deliveryStatusForWorkOrderRequest.mockResolvedValueOnce(status);
    expect(await (await GET(req("GET"), jobParams)).json()).toEqual({ request: status });
    expect(dispatch.deliveryStatusForWorkOrderRequest).toHaveBeenLastCalledWith(TENANT, JOB_ID);
  });
});
