/**
 * PUT /api/equipment-notebooks/[id]/components/selection — the optional `expectedRevision`
 * (#5625 r1 F4): passed to the store only when sent, refused when malformed or sent with a
 * whole-machine clear, and a stale record answers 409 stale_revision.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const COMPONENT = "44444444-4444-4444-8444-444444444444";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })) }));
const { setSelection } = vi.hoisted(() => ({ setSelection: vi.fn() }));
vi.mock("@/capabilities/bench-components/store", () => ({ setSelection }));

import { PUT } from "@/app/api/equipment-notebooks/[id]/components/selection/route";

const put = (body: Record<string, unknown>) =>
  PUT(
    new NextRequest(`http://hub.test/api/equipment-notebooks/${NB}/components/selection`, { method: "PUT", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: NB }) },
  );
const pick = (over: Record<string, unknown> = {}) => ({
  threadId: "t1",
  componentId: COMPONENT,
  via: "picker",
  expectedVersion: null,
  clientRequestId: "55555555-5555-4555-8555-555555555555",
  ...over,
});

beforeEach(() => {
  process.env.NEON_DATABASE_URL = "postgres://test";
  setSelection.mockReset();
  setSelection.mockResolvedValue({ status: "set", selection: { componentId: COMPONENT, revision: 3, version: 1 } });
});

describe("selection PUT expectedRevision", () => {
  it("is passed to the store when sent", async () => {
    expect((await put(pick({ expectedRevision: 3 }))).status).toBe(200);
    expect(setSelection.mock.calls[0][4]).toMatchObject({ componentId: COMPONENT, expectedRevision: 3 });
  });

  it("is not invented when absent (an ordinary checklist tap is unchanged)", async () => {
    expect((await put(pick())).status).toBe(200);
    expect(setSelection.mock.calls[0][4]).not.toHaveProperty("expectedRevision");
  });

  it.each([["3"], [-1], [1.5], [null]])("a malformed value (%j) is refused before the store", async (value) => {
    const res = await put(pick({ expectedRevision: value }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_expected_revision");
    expect(setSelection).not.toHaveBeenCalled();
  });

  it("is refused with a whole-machine clear (there is no record to check)", async () => {
    const res = await put(pick({ componentId: null, expectedRevision: 3 }));
    expect(res.status).toBe(400);
    expect(setSelection).not.toHaveBeenCalled();
  });

  it("a record corrected since answers 409 stale_revision", async () => {
    setSelection.mockResolvedValue({ status: "stale_revision", selection: null });
    const res = await put(pick({ expectedRevision: 2 }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("stale_revision");
  });
});
